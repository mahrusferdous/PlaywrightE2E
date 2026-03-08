import axios from "axios";
import type { Readable } from "node:stream";
import { getProjectContextSnippet } from "./projectContextReader";

export interface LocatorHealingPrompt {
	keyPath: string;
	failedSelector: string;
	currentUrl: string;
	pageTitle: string;
	errorMessage: string;
	pageHtmlSnippet: string;
	projectContextSnippet?: string;
}

const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_OLLAMA_MODEL = "deepseek-coder:latest";
const DEFAULT_OLLAMA_TIMEOUT_MS = 30000;

export function isAiHealingEnabled() {
	return process.env.AI_HEALING_ENABLED === "true";
}

/**
 * Indicates if verbose healing logs are enabled.
 */
export function isAiHealingVerbose() {
	return process.env.AI_HEALING_VERBOSE === "true";
}

/**
 * Indicates if live LLM communication logs are enabled.
 */
export function isAiHealingLiveLogEnabled() {
	return process.env.AI_HEALING_LIVE_LLM_LOG === "true";
}

/**
 * Emits verbose logs when AI_HEALING_VERBOSE is enabled.
 */
function verboseLog(message: string, data?: unknown) {
	if (!isAiHealingVerbose()) {
		return;
	}

	if (data === undefined) {
		console.info(`[AI-Heal][Verbose] ${message}`);
		return;
	}

	console.info(`[AI-Heal][Verbose] ${message}`, data);
}

/**
 * Emits live logs when AI_HEALING_LIVE_LLM_LOG is enabled.
 */
function liveLog(message: string, data?: unknown) {
	if (!isAiHealingLiveLogEnabled()) {
		return;
	}

	if (data === undefined) {
		console.info(`[AI-Heal][Live] ${message}`);
		return;
	}

	console.info(`[AI-Heal][Live] ${message}`, data);
}

/**
 * Truncates long text for safer console output.
 */
function truncateForLog(value: string, maxLength = 2500): string {
	if (value.length <= maxLength) {
		return value;
	}

	return `${value.slice(0, maxLength)}\n...<truncated ${value.length - maxLength} chars>`;
}

/**
 * Extracts text content from various Ollama message content shapes.
 */
function extractMessageContent(raw: unknown): string {
	if (typeof raw === "string") {
		return raw;
	}

	if (Array.isArray(raw)) {
		return raw
			.map((part) => {
				if (typeof part === "string") {
					return part;
				}

				if (typeof part === "object" && part !== null && "text" in part) {
					const value = (part as { text?: unknown }).text;
					return typeof value === "string" ? value : "";
				}

				return "";
			})
			.join("\n");
	}

	return "";
}

/**
 * Checks whether a string looks like a valid selector candidate.
 */
function isLikelySelector(value: string): boolean {
	const candidate = value.trim();
	if (!candidate) {
		return false;
	}

	if (candidate.length > 180) {
		return false;
	}

	const selectorStart =
		/^(css=|xpath=|id=|text=|data-test=|data-testid=|role=|[.#\[]|[a-zA-Z][\w-]*(?=\s|[.#:[>+~]|$))/;
	if (!selectorStart.test(candidate)) {
		return false;
	}

	const plainWordCount = candidate
		.replace(/[\[\]#.:()='"`>+~*]/g, " ")
		.trim()
		.split(/\s+/)
		.filter(Boolean).length;

	if (!/[#.[\]=:'"()]/.test(candidate) && plainWordCount > 4) {
		return false;
	}

	if (/[.!?]$/.test(candidate) && plainWordCount > 3) {
		return false;
	}

	return true;
}

/**
 * Normalizes selector strings for consistent parsing and deduplication.
 */
function normalizeSelector(value: string): string {
	return value
		.trim()
		.replace(/^['"`]+/, "")
		.replace(/['"`]+$/, "")
		.replace(/;+$/, "")
		.replace(/[-_]+$/, "");
}

/**
 * Extracts selector candidates from backtick-wrapped segments.
 */
function collectSelectorsFromBackticks(content: string): string[] {
	const matches = content.match(/`([^`]+)`/g) ?? [];
	return matches
		.map((match) => normalizeSelector(match.slice(1, -1)))
		.filter((candidate) => isLikelySelector(candidate));
}

/**
 * Generates deterministic fallback selectors from failed selector text.
 */
function generateFallbackSelectors(prompt: LocatorHealingPrompt): string[] {
	const candidates = new Set<string>();
	const trimmed = prompt.failedSelector.trim();

	if (trimmed) {
		candidates.add(trimmed);
		candidates.add(trimmed.replace(/([-_])broken\b/gi, ""));
		candidates.add(trimmed.replace(/broken\b/gi, ""));
	}

	if (trimmed.startsWith("#") || trimmed.startsWith(".")) {
		const core = trimmed.slice(1);
		candidates.add(`#${core.replace(/([-_])broken\b/gi, "")}`);
		candidates.add(`.${core.replace(/([-_])broken\b/gi, "")}`);
	}

	const sanitized = Array.from(candidates)
		.map((candidate) => normalizeSelector(candidate))
		.filter(Boolean)
		.filter((candidate) => candidate !== "#" && candidate !== ".")
		.filter((candidate) => isLikelySelector(candidate));

	verboseLog("Generated fallback selector candidates", { keyPath: prompt.keyPath, sanitized });
	return sanitized;
}

/**
 * Parses selector candidates from LLM output content.
 */
function parseSelectors(content: string): string[] {
	const trimmed = content.trim();
	if (!trimmed) {
		return [];
	}

	const tryParse = (value: string): string[] => {
		const parsed = JSON.parse(value) as unknown;
		if (Array.isArray(parsed)) {
			return parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
		}

		if (typeof parsed === "object" && parsed !== null && "selectors" in parsed) {
			const selectors = (parsed as { selectors?: unknown }).selectors;
			if (Array.isArray(selectors)) {
				return selectors.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
			}
		}

		return [];
	};

	try {
		const parsed = tryParse(trimmed);
		if (parsed.length > 0) {
			return parsed;
		}
	} catch {
		// Intentionally ignored; will attempt extraction below.
	}

	const objectLike = trimmed.match(/\{[\s\S]*\}/);
	if (objectLike) {
		try {
			const parsed = tryParse(objectLike[0]);
			if (parsed.length > 0) {
				return parsed;
			}
		} catch {
			// Intentionally ignored.
		}
	}

	const arrayLike = trimmed.match(/\[[\s\S]*\]/);
	if (arrayLike) {
		try {
			const parsed = tryParse(arrayLike[0]);
			if (parsed.length > 0) {
				return parsed;
			}
		} catch {
			// Intentionally ignored.
		}
	}

	const lines = trimmed
		.split(/\r?\n/)
		.map((line) =>
			line
				.replace(/^[-*\d.)\s`"]+/, "")
				.replace(/[`"]+$/g, "")
				.trim(),
		)
		.filter(Boolean)
		.map((line) => normalizeSelector(line))
		.filter((line) => isLikelySelector(line));

	const fromBackticks = collectSelectorsFromBackticks(trimmed);

	return Array.from(new Set([...lines, ...fromBackticks]));
}

/**
 * Returns the system prompt used for selector healing.
 */
function getSystemPrompt() {
	return 'You repair broken Playwright selectors. Return ONLY valid JSON in this shape: {"selectors":["selector1","selector2"]}. Do not include markdown or explanations.';
}

/**
 * Builds the user prompt for a locator healing request.
 */
function getUserPrompt(prompt: LocatorHealingPrompt) {
	const sections = [
		"Generate replacement selector candidates for this broken Playwright locator.",
		`keyPath: ${prompt.keyPath}`,
		`failedSelector: ${prompt.failedSelector}`,
		`currentUrl: ${prompt.currentUrl}`,
		`pageTitle: ${prompt.pageTitle}`,
		`errorMessage: ${prompt.errorMessage}`,
		"Constraints:",
		"- Prefer stable attributes (data-test, data-testid, id, name, aria-label).",
		"- Avoid nth-child and fragile positional selectors.",
		"- Return 3 to 6 candidates in best-first order.",
		'No prose. Return JSON ONLY using exactly: {"selectors":["..."]}',
	] as string[];

	if (prompt.projectContextSnippet) {
		sections.push("Project source context:");
		sections.push(prompt.projectContextSnippet);
	}

	sections.push("DOM snippet:", prompt.pageHtmlSnippet);

	return sections.join("\n");
}

/**
 * Builds Ollama chat payload for streaming or non-streaming requests.
 */
function buildOllamaPayload(prompt: LocatorHealingPrompt, stream: boolean) {
	return {
		model: process.env.AI_HEALING_MODEL ?? DEFAULT_OLLAMA_MODEL,
		stream,
		options: {
			temperature: 0,
		},
		messages: [
			{ role: "system", content: getSystemPrompt() },
			{ role: "user", content: getUserPrompt(prompt) },
		],
	};
}

/**
 * Logs request metadata and prompt previews for live debugging.
 */
function logLiveRequestPreview(baseUrl: string, payload: ReturnType<typeof buildOllamaPayload>, stream: boolean) {
	liveLog("Request dispatch", {
		endpoint: `${baseUrl}/api/chat`,
		model: payload.model,
		stream,
	});
	liveLog("TX system prompt", truncateForLog(payload.messages[0].content));
	liveLog("TX user prompt", truncateForLog(payload.messages[1].content));
}

/**
 * Sends a streaming request to Ollama and collects streamed content.
 */
async function requestFromOllamaStreaming(baseUrl: string, prompt: LocatorHealingPrompt): Promise<string> {
	const payload = buildOllamaPayload(prompt, true);
	logLiveRequestPreview(baseUrl, payload, true);
	liveLog("RX stream start");

	const response = await axios.post(`${baseUrl}/api/chat`, payload, {
		headers: {
			"Content-Type": "application/json",
		},
		responseType: "stream",
		timeout: DEFAULT_OLLAMA_TIMEOUT_MS,
	});

	const stream = response.data as Readable;
	let buffer = "";
	let fullContent = "";

	const flushLine = (line: string) => {
		if (!line.trim()) {
			return;
		}

		try {
			const parsed = JSON.parse(line) as {
				message?: { content?: unknown };
				done?: boolean;
				error?: unknown;
			};

			if (parsed.error) {
				liveLog("RX error", parsed.error);
			}

			const token = extractMessageContent(parsed.message?.content);
			if (token) {
				fullContent += token;
				process.stdout.write(token);
			}

			if (parsed.done) {
				process.stdout.write("\n");
				liveLog("RX stream complete");
			}
		} catch {
			liveLog("RX non-json chunk", truncateForLog(line, 600));
		}
	};

	for await (const chunk of stream) {
		buffer += chunk.toString("utf8");
		let newLineIndex = buffer.indexOf("\n");
		while (newLineIndex !== -1) {
			const line = buffer.slice(0, newLineIndex);
			buffer = buffer.slice(newLineIndex + 1);
			flushLine(line);
			newLineIndex = buffer.indexOf("\n");
		}
	}

	if (buffer.trim()) {
		flushLine(buffer);
	}

	return fullContent;
}

/**
 * Sends a standard (non-streaming) request to Ollama.
 */
async function requestFromOllamaNonStreaming(
	baseUrl: string,
	prompt: LocatorHealingPrompt,
	enableLiveLogs: boolean,
): Promise<string> {
	const payload = buildOllamaPayload(prompt, false);
	if (enableLiveLogs) {
		logLiveRequestPreview(baseUrl, payload, false);
	}

	const response = await axios.post(`${baseUrl}/api/chat`, payload, {
		headers: {
			"Content-Type": "application/json",
		},
		timeout: DEFAULT_OLLAMA_TIMEOUT_MS,
	});

	const messageContent = extractMessageContent(response.data?.message?.content);
	if (enableLiveLogs) {
		liveLog("RX non-stream response", truncateForLog(messageContent, 4000));
	}

	return messageContent;
}

/**
 * Requests selector candidates from Ollama, with live-stream fallback handling.
 */
async function requestFromOllama(prompt: LocatorHealingPrompt): Promise<string[]> {
	const baseUrl = (process.env.AI_HEALING_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL).replace(/\/$/, "");
	const model = process.env.AI_HEALING_MODEL ?? DEFAULT_OLLAMA_MODEL;
	const liveLogEnabled = isAiHealingLiveLogEnabled();
	verboseLog("Dispatching Ollama request", {
		keyPath: prompt.keyPath,
		failedSelector: prompt.failedSelector,
		baseUrl,
		model,
		currentUrl: prompt.currentUrl,
		htmlSnippetLength: prompt.pageHtmlSnippet.length,
		projectContextLength: prompt.projectContextSnippet?.length ?? 0,
	});

	let messageContent = "";
	if (liveLogEnabled) {
		try {
			messageContent = await requestFromOllamaStreaming(baseUrl, prompt);
		} catch (streamError) {
			liveLog("Streaming request failed; retrying in non-stream mode", {
				error: streamError instanceof Error ? streamError.message : String(streamError),
			});
			messageContent = await requestFromOllamaNonStreaming(baseUrl, prompt, true);
		}
	} else {
		messageContent = await requestFromOllamaNonStreaming(baseUrl, prompt, false);
	}

	verboseLog("Raw Ollama response content", messageContent.slice(0, 1200));
	const selectors = parseSelectors(messageContent);
	const fallbackSelectors = generateFallbackSelectors(prompt);
	const merged = Array.from(
		new Set([...fallbackSelectors, ...selectors].map((selector) => normalizeSelector(selector)).filter(Boolean)),
	);
	verboseLog("Parsed selector candidates", { selectors, fallbackSelectors, merged });
	return merged;
}

/**
 * Requests selector candidates for a failed locator action.
 *
 * This function enriches the prompt with optional project source context,
 * sends it to Ollama, and returns deduplicated candidate selectors.
 */
export async function requestSelectorCandidates(prompt: LocatorHealingPrompt): Promise<string[]> {
	if (!isAiHealingEnabled()) {
		return [];
	}

	try {
		const projectContextSnippet = getProjectContextSnippet(prompt.keyPath, prompt.failedSelector);
		return await requestFromOllama({
			...prompt,
			projectContextSnippet,
		});
	} catch (error) {
		verboseLog("Ollama request failed", error);
		console.warn("[AI-Heal] LLM request failed. Skipping healing for this step.", error);
		return [];
	}
}
