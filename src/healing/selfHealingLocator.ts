import type { Locator, Page } from "@playwright/test";
import { getLocatorOverridesPath, getLocatorValue, setLocatorValue } from "./locatorStore";
import {
	isAiHealingEnabled,
	isAiHealingLiveLogEnabled,
	isAiHealingVerbose,
	requestSelectorCandidates,
} from "./llmLocatorHealer";

interface HealingActionOptions {
	description?: string;
	requireVisible?: boolean;
	maxCandidates?: number;
}

interface ResolveLocatorOptions extends HealingActionOptions {
	validateOnResolve?: boolean;
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
	const fromKeyPath = keyParts.flatMap((part) => splitWords(part));
	const fromSelector = failedSelector
		.toLowerCase()
		.replace(/[-_]broken\b/g, "")
		.split(/[^a-z0-9]+/)
		.map((token) => token.trim())
		.filter((token) => token.length >= 3);

	return Array.from(new Set([...fromKeyPath, ...fromSelector]));
}

/**
 * Ensures candidate selector is semantically related to expected target.
 */
function candidateMatchesIntent(candidate: string, tokens: string[]): boolean {
	if (tokens.length === 0) {
		return true;
	}

	const normalizedCandidate = candidate.toLowerCase();
	return tokens.some((token) => normalizedCandidate.includes(token));
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
): Promise<string | null> {
	if (page.isClosed()) {
		verboseLog("Skipping selector healing because page is already closed", { keyPath, selector });
		return null;
	}

	let html = "";
	let currentUrl = "";
	let pageTitle = "";

	try {
		html = await page.content();
		currentUrl = page.url();
		pageTitle = await page.title();
	} catch (snapshotError) {
		verboseLog("Failed to collect page snapshot for healing; skipping LLM request", {
			keyPath,
			selector,
			error: snapshotError instanceof Error ? snapshotError.message : String(snapshotError),
			pageClosed: page.isClosed(),
		});
		return null;
	}

	const prompt = {
		keyPath,
		failedSelector: selector,
		currentUrl,
		pageTitle,
		errorMessage: `Selector not found or not actionable: ${selector}`,
		pageHtmlSnippet: buildFocusedHtmlSnippet(html, selector),
	};

	const candidates = await requestSelectorCandidates(prompt);
	verboseLog("LLM candidates received", { keyPath, candidates });
	if (candidates.length === 0) {
		verboseLog("LLM returned no candidates", { keyPath });
		return null;
	}

	const intentTokens = getIntentTokens(keyPath, selector);
	return findValidSelector(
		page,
		candidates.slice(0, options.maxCandidates ?? 6),
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
		});

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
