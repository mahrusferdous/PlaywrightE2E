import axios from "axios";
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

export function isAiHealingEnabled() {
	return process.env.AI_HEALING_ENABLED === "true";
}

export function isAiHealingVerbose() {
	return process.env.AI_HEALING_VERBOSE === "true";
}

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

function normalizeSelector(value: string): string {
	return value
		.trim()
		.replace(/^['"`]+/, "")
		.replace(/['"`]+$/, "")
		.replace(/;+$/, "")
		.replace(/[-_]+$/, "");
}

function collectSelectorsFromBackticks(content: string): string[] {
	const matches = content.match(/`([^`]+)`/g) ?? [];
	return matches
		.map((match) => normalizeSelector(match.slice(1, -1)))
		.filter((candidate) => isLikelySelector(candidate));
}

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

function getSystemPrompt() {
	return 'You repair broken Playwright selectors. Return ONLY valid JSON in this shape: {"selectors":["selector1","selector2"]}. Do not include markdown or explanations.';
}

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

async function requestFromOllama(prompt: LocatorHealingPrompt): Promise<string[]> {
	const baseUrl = (process.env.AI_HEALING_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL).replace(/\/$/, "");
	const model = process.env.AI_HEALING_MODEL ?? DEFAULT_OLLAMA_MODEL;
	verboseLog("Dispatching Ollama request", {
		keyPath: prompt.keyPath,
		failedSelector: prompt.failedSelector,
		baseUrl,
		model,
		currentUrl: prompt.currentUrl,
		htmlSnippetLength: prompt.pageHtmlSnippet.length,
		projectContextLength: prompt.projectContextSnippet?.length ?? 0,
	});

	const response = await axios.post(
		`${baseUrl}/api/chat`,
		{
			model,
			stream: false,
			options: {
				temperature: 0,
			},
			messages: [
				{ role: "system", content: getSystemPrompt() },
				{ role: "user", content: getUserPrompt(prompt) },
			],
		},
		{
			headers: {
				"Content-Type": "application/json",
			},
			timeout: 30000,
		},
	);

	const messageContent = extractMessageContent(response.data?.message?.content);
	verboseLog("Raw Ollama response content", messageContent.slice(0, 1200));
	const selectors = parseSelectors(messageContent);
	const fallbackSelectors = generateFallbackSelectors(prompt);
	const merged = Array.from(
		new Set([...fallbackSelectors, ...selectors].map((selector) => normalizeSelector(selector)).filter(Boolean)),
	);
	verboseLog("Parsed selector candidates", { selectors, fallbackSelectors, merged });
	return merged;
}

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
