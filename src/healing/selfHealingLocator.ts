import type { Locator, Page } from "@playwright/test";
import { getLocatorOverridesPath, getLocatorValue, setLocatorValue } from "./locatorStore";
import {
	type LocatorHealingPrompt,
	isAiHealingEnabled,
	isAiHealingLiveLogEnabled,
	isAiHealingVerbose,
	requestSelectorCandidates,
} from "./llmLocatorHealer";
import { detectCurrentPageScope, getExpectedPageScope, isPageScopeCompatible } from "./pageContext";

interface HealingActionOptions {
	description?: string;
	requireVisible?: boolean;
	maxCandidates?: number;
}

interface ResolveLocatorOptions extends HealingActionOptions {
	validateOnResolve?: boolean;
}

interface FailureCapture {
	expectedPage: string;
	currentPage: string;
	currentPageReason: string;
	currentUrl: string;
	pageTitle: string;
	errorMessage: string;
	uiTextSnippet: string;
	pageHtmlSnippet: string;
}

interface DomCandidate {
	selector: string;
	score: number;
	reason: string;
}

const DEFAULT_MAX_VALIDATION_CANDIDATES = 3;
const DEFAULT_MAX_DOM_CANDIDATES = 12;
const GENERIC_INTENT_TOKENS = new Set([
	"button",
	"link",
	"field",
	"input",
	"text",
	"message",
	"label",
	"badge",
	"card",
	"item",
	"container",
	"icon",
	"title",
	"page",
]);

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
 * Checks whether an error likely represents a locator failure.
 */
function looksLikeLocatorFailure(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}

	const message = error.message.toLowerCase();
	return (
		message.includes("waiting for locator") ||
		message.includes("strict mode violation") ||
		message.includes("timeout") ||
		message.includes("not visible") ||
		message.includes("not found")
	);
}

/**
 * Splits text into normalized tokens for intent matching.
 */
function splitWords(value: string): string[] {
	return value
		.replace(/([a-z])([A-Z])/g, "$1 $2")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.split(/\s+/)
		.map((token) => token.trim())
		.filter((token) => token.length >= 3);
}

/**
 * Builds intent tokens from key path and failed selector text.
 */
function getIntentTokens(keyPath: string, failedSelector: string): string[] {
	const keyParts = keyPath.split(".");
	const fromKeyPath = keyParts.slice(-1).flatMap((part) => splitWords(part));
	const fromSelector = failedSelector
		.toLowerCase()
		.replace(/[-_]broken\b/g, "")
		.split(/[^a-z0-9]+/)
		.map((token) => token.trim())
		.filter((token) => token.length >= 3);

	const combined = Array.from(new Set([...fromKeyPath, ...fromSelector]));
	const specificTokens = combined.filter((token) => !GENERIC_INTENT_TOKENS.has(token));

	return specificTokens.length > 0 ? specificTokens : combined;
}

/**
 * Ensures candidate selector is semantically related to expected target.
 */
function candidateMatchesIntent(candidate: string, tokens: string[]): boolean {
	if (tokens.length === 0) {
		return true;
	}

	const normalizedCandidate = candidate.toLowerCase();
	const matchCount = tokens.filter((token) => normalizedCandidate.includes(token)).length;
	if (tokens.length === 1) {
		return matchCount >= 1;
	}

	return matchCount >= 2;
}

/**
 * Escapes arbitrary text for safe CSS attribute selectors.
 */
function escapeAttributeValue(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Generates deterministic repairs directly from the broken selector string.
 */
function generateDirectRepairCandidates(selector: string): string[] {
	const candidates = new Set<string>();
	const trimmed = selector.trim();
	if (!trimmed) {
		return [];
	}

	candidates.add(trimmed.replace(/([-_])broken\b/gi, ""));
	candidates.add(trimmed.replace(/broken\b/gi, ""));

	if (trimmed.startsWith(".") || trimmed.startsWith("#")) {
		const core = trimmed.slice(1).replace(/([-_])broken\b/gi, "").replace(/broken\b/gi, "");
		if (core) {
			candidates.add(`${trimmed[0]}${core}`);
			candidates.add(`[class="${escapeAttributeValue(core)}"]`);
			candidates.add(`[id="${escapeAttributeValue(core)}"]`);
		}
	}

	return Array.from(candidates).map((candidate) => candidate.trim()).filter(Boolean);
}

/**
 * Detects whether a locator likely targets an interactive control.
 */
function isInteractiveTarget(keyPath: string, selector: string, description?: string): boolean {
	const source = `${keyPath} ${selector} ${description ?? ""}`.toLowerCase();
	return (
		source.includes("button") ||
		source.includes("link") ||
		source.includes("checkout") ||
		source.includes("continue") ||
		source.includes("finish") ||
		source.includes("back") ||
		source.includes("login")
	);
}

/**
 * Detects whether a locator likely targets a text input control.
 */
function isTextInputTarget(keyPath: string, selector: string, description?: string): boolean {
	const source = `${keyPath} ${selector} ${description ?? ""}`.toLowerCase();
	return (
		source.includes("input") ||
		source.includes("field") ||
		source.includes("username") ||
		source.includes("password") ||
		source.includes("first") ||
		source.includes("last") ||
		source.includes("postal") ||
		source.includes("zip")
	);
}

/**
 * Builds deterministic selector candidates directly from live DOM state.
 */
async function collectDomSelectorCandidates(
	page: Page,
	keyPath: string,
	selector: string,
	options: ResolveLocatorOptions,
): Promise<string[]> {
	const intentTokens = getIntentTokens(keyPath, selector);
	const interactiveTarget = isInteractiveTarget(keyPath, selector, options.description);
	const textInputTarget = isTextInputTarget(keyPath, selector, options.description);
	const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_DOM_CANDIDATES;

	const domCandidates = await page
		.evaluate(
			({
				intentTokens,
				failedSelector,
				interactiveTarget,
				textInputTarget,
				maxCandidates,
			}: {
				intentTokens: string[];
				failedSelector: string;
				interactiveTarget: boolean;
				textInputTarget: boolean;
				maxCandidates: number;
			}) => {
				interface Candidate {
					selector: string;
					score: number;
					reason: string;
				}

				const normalize = (value: string) =>
					value
						.replace(/([a-z])([A-Z])/g, "$1 $2")
						.toLowerCase()
						.replace(/[^a-z0-9]+/g, " ")
						.trim();

				const escapeAttribute = (value: string) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
				const escapeText = (value: string) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
				const addCandidate = (store: Map<string, Candidate>, candidate: Candidate) => {
					const existing = store.get(candidate.selector);
					if (!existing || existing.score < candidate.score) {
						store.set(candidate.selector, candidate);
					}
				};

				const failedTagMatch = failedSelector.trim().match(/^[a-z][\w-]*/i);
				const failedTag = failedTagMatch ? failedTagMatch[0].toLowerCase() : "";
				const results = new Map<string, Candidate>();
				const elements = Array.from(document.querySelectorAll("*")).slice(0, 1200);

				for (const node of elements) {
					if (!(node instanceof HTMLElement)) {
						continue;
					}

					const tagName = node.tagName.toLowerCase();
					if (["html", "body", "script", "style", "meta", "link"].includes(tagName)) {
						continue;
					}

					const text = (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
					const attrValues = [
						node.id,
						node.getAttribute("name") || "",
						node.getAttribute("data-testid") || "",
						node.getAttribute("data-test") || "",
						node.getAttribute("aria-label") || "",
						node.getAttribute("placeholder") || "",
						node.getAttribute("role") || "",
						node.className || "",
					]
						.join(" ")
						.trim();
					const combined = normalize(`${text} ${attrValues}`);
					if (!combined) {
						continue;
					}

					const matchedTokenCount = intentTokens.filter((token) => combined.includes(token)).length;
					if (matchedTokenCount === 0) {
						continue;
					}

					const hidden =
						node.getAttribute("hidden") !== null ||
						node.getAttribute("aria-hidden") === "true" ||
						(node as HTMLElement).style?.display === "none" ||
						(node as HTMLElement).style?.visibility === "hidden";
					if (hidden) {
						continue;
					}

					let score = matchedTokenCount * 8;
					if (failedTag && failedTag === tagName) {
						score += 4;
					}
					if (interactiveTarget && ["button", "a"].includes(tagName)) {
						score += 5;
					}
					if (textInputTarget && ["input", "textarea"].includes(tagName)) {
						score += 5;
					}
					if (node.getAttribute("data-testid") || node.getAttribute("data-test")) {
						score += 7;
					}
					if (node.id) {
						score += 6;
					}
					if (node.getAttribute("name") || node.getAttribute("aria-label") || node.getAttribute("placeholder")) {
						score += 4;
					}
					if (text && text.length <= 80) {
						score += 2;
					}

					const dataTestId = node.getAttribute("data-testid");
					if (dataTestId) {
						addCandidate(results, {
							selector: `[data-testid="${escapeAttribute(dataTestId)}"]`,
							score: score + 10,
							reason: "data-testid",
						});
					}

					const dataTest = node.getAttribute("data-test");
					if (dataTest) {
						addCandidate(results, {
							selector: `[data-test="${escapeAttribute(dataTest)}"]`,
							score: score + 10,
							reason: "data-test",
						});
					}

					if (node.id && !/\s/.test(node.id)) {
						addCandidate(results, {
							selector: `#${CSS.escape(node.id)}`,
							score: score + 9,
							reason: "id",
						});
					}

					const name = node.getAttribute("name");
					if (name) {
						addCandidate(results, {
							selector: `${tagName}[name="${escapeAttribute(name)}"]`,
							score: score + 7,
							reason: "name",
						});
					}

					const ariaLabel = node.getAttribute("aria-label");
					if (ariaLabel) {
						addCandidate(results, {
							selector: `${tagName}[aria-label="${escapeAttribute(ariaLabel)}"]`,
							score: score + 6,
							reason: "aria-label",
						});
					}

					const placeholder = node.getAttribute("placeholder");
					if (placeholder) {
						addCandidate(results, {
							selector: `${tagName}[placeholder="${escapeAttribute(placeholder)}"]`,
							score: score + 6,
							reason: "placeholder",
						});
					}

					if (text && text.length <= 80) {
						if (interactiveTarget && tagName === "button") {
							addCandidate(results, {
								selector: `button:has-text("${escapeText(text)}")`,
								score: score + 8,
								reason: "button text",
							});
						}

						if (interactiveTarget && tagName === "a") {
							addCandidate(results, {
								selector: `a:has-text("${escapeText(text)}")`,
								score: score + 8,
								reason: "link text",
							});
						}

						addCandidate(results, {
							selector: `text="${escapeText(text)}"`,
							score,
							reason: "visible text",
						});
					}

					const classes = Array.from(node.classList).filter(
						(className) => className && !/^\d/.test(className) && className.length <= 40,
					);
					if (classes.length > 0) {
						const classSelector = `${tagName}.${classes.slice(0, 3).join(".")}`;
						addCandidate(results, {
							selector: classSelector,
							score: score + 1,
							reason: "tag and class",
						});
					}
				}

				return Array.from(results.values())
					.sort((left, right) => right.score - left.score)
					.slice(0, maxCandidates);
			},
			{
				intentTokens,
				failedSelector: selector,
				interactiveTarget,
				textInputTarget,
				maxCandidates,
			},
		)
		.catch(() => [] as DomCandidate[]);

	verboseLog("DOM-based selector candidates collected", {
		keyPath,
		selector,
		candidates: domCandidates,
	});

	return domCandidates.map((candidate) => candidate.selector);
}

/**
 * Builds a focused DOM snippet around failed selector tokens.
 */
function buildFocusedHtmlSnippet(pageHtml: string, failedSelector: string): string {
	const html = pageHtml;
	const tokenCandidates = failedSelector
		.toLowerCase()
		.replace(/[#.\[\]:'"=()]/g, " ")
		.split(/\s+/)
		.map((token) => token.trim())
		.filter((token) => token.length >= 3)
		.filter((token) => token !== "broken");

	const windows: string[] = [];
	const lowerHtml = html.toLowerCase();

	for (const token of tokenCandidates) {
		let index = lowerHtml.indexOf(token);
		if (index === -1) {
			continue;
		}

		let hitCount = 0;
		while (index !== -1 && hitCount < 3) {
			const start = Math.max(0, index - 600);
			const end = Math.min(html.length, index + 600);
			windows.push(html.slice(start, end));
			hitCount += 1;
			index = lowerHtml.indexOf(token, index + token.length);
		}
	}

	const focused = windows
		.map((snippet) => snippet.trim())
		.filter(Boolean)
		.join("\n...\n");

	if (focused.length >= 400) {
		return focused.slice(0, 7000);
	}

	return html.slice(0, 7000);
}

/**
 * Builds a visible-text snapshot so the LLM can reason from what a user would see.
 */
function buildUiTextSnippet(pageText: string): string {
	return pageText
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 2500);
}

/**
 * Captures failure context and verifies the page matches the locator's expected scope.
 */
async function captureFailureContext(
	page: Page,
	keyPath: string,
	selector: string,
	error: unknown,
): Promise<FailureCapture | null> {
	if (page.isClosed()) {
		verboseLog("Skipping selector healing because page is already closed", { keyPath, selector });
		return null;
	}

	try {
		const expectedPage = getExpectedPageScope(keyPath);
		const [html, pageTitle, pageText, detectedPage] = await Promise.all([
			page.content(),
			page.title().catch(() => ""),
			page.locator("body").innerText().catch(() => ""),
			detectCurrentPageScope(page),
		]);

		if (!isPageScopeCompatible(expectedPage, detectedPage.scope)) {
			verboseLog("Skipping healing because current page scope does not match locator scope", {
				keyPath,
				selector,
				expectedPage,
				currentPage: detectedPage.scope,
				reason: detectedPage.reason,
			});
			return null;
		}

		return {
			expectedPage,
			currentPage: detectedPage.scope,
			currentPageReason: detectedPage.reason,
			currentUrl: page.url(),
			pageTitle,
			errorMessage: error instanceof Error ? error.message : String(error),
			uiTextSnippet: buildUiTextSnippet(pageText),
			pageHtmlSnippet: buildFocusedHtmlSnippet(html, selector),
		};
	} catch (snapshotError) {
		verboseLog("Failed to collect page snapshot for healing; skipping LLM request", {
			keyPath,
			selector,
			error: snapshotError instanceof Error ? snapshotError.message : String(snapshotError),
			pageClosed: page.isClosed(),
		});
		return null;
	}
}

/**
 * Converts failure capture data into an LLM prompt payload.
 */
function buildHealingPrompt(
	keyPath: string,
	selector: string,
	failure: FailureCapture,
): LocatorHealingPrompt {
	return {
		keyPath,
		failedSelector: selector,
		expectedPage: failure.expectedPage,
		currentPage: failure.currentPage,
		currentPageReason: failure.currentPageReason,
		currentUrl: failure.currentUrl,
		pageTitle: failure.pageTitle,
		errorMessage: failure.errorMessage,
		uiTextSnippet: failure.uiTextSnippet,
		pageHtmlSnippet: failure.pageHtmlSnippet,
	};
}

/**
 * Validates candidate selectors against current page state.
 */
async function findValidSelector(
	page: Page,
	selectors: string[],
	requireVisible: boolean,
	intentTokens: string[],
): Promise<string | null> {
	for (const selector of selectors) {
		const candidate = selector.trim();
		if (!candidate) {
			continue;
		}

		if (!candidateMatchesIntent(candidate, intentTokens)) {
			verboseLog("Candidate skipped by intent matching", { candidate, intentTokens });
			continue;
		}

		try {
			const locator = page.locator(candidate);
			const count = await locator.count();
			verboseLog("Candidate locator count", { candidate, count });
			if (count === 0) {
				continue;
			}

			if (requireVisible) {
				const visible = await locator
					.first()
					.isVisible()
					.catch(() => false);
				verboseLog("Candidate visibility check", { candidate, visible });
				if (!visible) {
					continue;
				}
			}

			verboseLog("Candidate accepted", { candidate });
			return candidate;
		} catch (error) {
			verboseLog("Candidate validation failed", {
				candidate,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	verboseLog("No valid selector candidate found");
	return null;
}

/**
 * Requests, filters, and validates replacement selectors for a failed key path.
 */
async function resolveValidSelector(
	page: Page,
	keyPath: string,
	selector: string,
	options: ResolveLocatorOptions,
	failureError?: unknown,
): Promise<string | null> {
	const failure = await captureFailureContext(page, keyPath, selector, failureError ?? "Locator action failed");
	if (!failure) {
		return null;
	}

	const intentTokens = getIntentTokens(keyPath, selector);
	const directRepairCandidates = generateDirectRepairCandidates(selector);
	const directRepairMatch = await findValidSelector(
		page,
		directRepairCandidates,
		options.requireVisible ?? true,
		intentTokens,
	);
	if (directRepairMatch) {
		return directRepairMatch;
	}

	const domCandidates = await collectDomSelectorCandidates(page, keyPath, selector, options);
	const domMatch = await findValidSelector(
		page,
		domCandidates,
		options.requireVisible ?? true,
		intentTokens,
	);
	if (domMatch) {
		return domMatch;
	}

	const prompt = buildHealingPrompt(keyPath, selector, failure);
	const llmCandidates = await requestSelectorCandidates(prompt);
	verboseLog("LLM candidates received", { keyPath, llmCandidates });
	if (llmCandidates.length === 0) {
		verboseLog("LLM returned no candidates", { keyPath });
		return null;
	}

	const mergedCandidates = Array.from(new Set([...directRepairCandidates, ...domCandidates, ...llmCandidates]));
	return findValidSelector(
		page,
		mergedCandidates.slice(0, Math.max(options.maxCandidates ?? DEFAULT_MAX_VALIDATION_CANDIDATES, DEFAULT_MAX_DOM_CANDIDATES)),
		options.requireVisible ?? true,
		intentTokens,
	);
}

/**
 * Resolves a locator with optional self-healing fallback.
 *
 * @param page Active Playwright page.
 * @param keyPath Locator key path such as `login.username`.
 * @param options Locator resolution options.
 * @returns A Playwright locator using base or healed selector.
 */
export async function resolveSelfHealingLocator(
	page: Page,
	keyPath: string,
	options: ResolveLocatorOptions = {},
): Promise<Locator> {
	const selector = getLocatorValue(keyPath);
	verboseLog("Resolving selector", {
		keyPath,
		selector,
		description: options.description,
	});

	const baseLocator = page.locator(selector);
	const validateOnResolve = options.validateOnResolve ?? true;

	if (!validateOnResolve || !isAiHealingEnabled()) {
		return baseLocator;
	}

	const currentCount = await baseLocator.count().catch(() => 0);
	const isVisible = options.requireVisible
		? await baseLocator
				.first()
				.isVisible()
				.catch(() => false)
		: true;

	if (currentCount > 0 && isVisible) {
		return baseLocator;
	}

	const validSelector = await resolveValidSelector(page, keyPath, selector, options);
	if (!validSelector || validSelector === selector) {
		return baseLocator;
	}

	setLocatorValue(keyPath, validSelector);
	console.info(
		`[AI-Heal] ${options.description ?? keyPath}: '${selector}' -> '${validSelector}' (saved in ${getLocatorOverridesPath()})`,
	);

	return page.locator(validSelector);
}

/**
 * Executes an action using a locator with automatic self-healing retries.
 *
 * @param page Active Playwright page.
 * @param keyPath Locator key path such as `login.username`.
 * @param action Callback that performs action using resolved locator.
 * @param options Healing options controlling validation and behavior.
 * @returns The action result.
 */
export async function withSelfHealingLocator<T>(
	page: Page,
	keyPath: string,
	action: (locator: Locator) => Promise<T>,
	options: HealingActionOptions = {},
): Promise<T> {
	const selector = getLocatorValue(keyPath);
	verboseLog("Executing action with selector", {
		keyPath,
		selector,
		description: options.description,
	});
	liveLog("Action start", { keyPath, selector, description: options.description });

	try {
		const result = await action(page.locator(selector));
		liveLog("Action succeeded without LLM healing", { keyPath, selector });
		return result;
	} catch (initialError) {
		verboseLog("Initial selector action failed", {
			keyPath,
			selector,
			error: initialError instanceof Error ? initialError.message : String(initialError),
		});
		if (!isAiHealingEnabled() || !looksLikeLocatorFailure(initialError)) {
			liveLog("LLM healing skipped", {
				keyPath,
				healingEnabled: isAiHealingEnabled(),
				isLocatorFailure: looksLikeLocatorFailure(initialError),
			});
			verboseLog("Healing not attempted", {
				healingEnabled: isAiHealingEnabled(),
				isLocatorFailure: looksLikeLocatorFailure(initialError),
			});
			throw initialError;
		}

		liveLog("LLM healing triggered", {
			keyPath,
			failedSelector: selector,
			error: initialError instanceof Error ? initialError.message : String(initialError),
		});

		const validSelector = await resolveValidSelector(page, keyPath, selector, {
			...options,
			validateOnResolve: true,
		}, initialError);

		if (!validSelector || validSelector === selector) {
			liveLog("LLM healing produced no better selector", {
				keyPath,
				validSelector,
				originalSelector: selector,
			});
			verboseLog("No improved selector produced", {
				keyPath,
				validSelector,
				originalSelector: selector,
			});
			throw initialError;
		}

		try {
			const healedResult = await action(page.locator(validSelector));
			setLocatorValue(keyPath, validSelector);
			liveLog("LLM healing applied", {
				keyPath,
				from: selector,
				to: validSelector,
			});
			console.info(
				`[AI-Heal] ${options.description ?? keyPath}: '${selector}' -> '${validSelector}' (saved in ${getLocatorOverridesPath()})`,
			);
			return healedResult;
		} catch (healedActionError) {
			liveLog("LLM healed selector failed during action", {
				keyPath,
				selector: validSelector,
				error: healedActionError instanceof Error ? healedActionError.message : String(healedActionError),
			});
			verboseLog("Healed selector failed during action execution", {
				keyPath,
				validSelector,
				error: healedActionError instanceof Error ? healedActionError.message : String(healedActionError),
			});
			throw initialError;
		}
	}
}
