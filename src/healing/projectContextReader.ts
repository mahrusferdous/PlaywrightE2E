import fs from "node:fs";
import path from "node:path";

interface IndexedLine {
	filePath: string;
	lineNumber: number;
	lineText: string;
	normalized: string;
}

interface ContextIndexCache {
	rootDir: string;
	lines: IndexedLine[];
}

interface ProjectSelectorCandidate {
	selector: string;
	score: number;
}

const ALLOWED_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".html"]);
const LINE_MARKER_REGEX =
	/(id|className|class|data-test|data-testid|aria-label|name)\s*=|getByRole|getByText|locator\(/i;
const DEFAULT_PROJECT_CONTEXT_DIR = path.resolve(process.cwd(), "../sample-app-web/src");
const MAX_FILE_COUNT = 500;
const MAX_FILE_SIZE_BYTES = 300_000;
const MAX_RETURN_LINES = 20;
const MAX_RETURN_CHARS = 4200;
const MAX_SELECTOR_CANDIDATES = 30;

let cache: ContextIndexCache | null = null;

/**
 * Emits verbose logs when AI_HEALING_VERBOSE is enabled.
 */
function verboseLog(message: string, data?: unknown) {
	if (process.env.AI_HEALING_VERBOSE !== "true") {
		return;
	}

	if (data === undefined) {
		console.info(`[AI-Heal][Verbose] ${message}`);
		return;
	}

	console.info(`[AI-Heal][Verbose] ${message}`, data);
}

/**
 * Splits text into normalized search tokens for ranking.
 */
function splitWords(value: string): string[] {
	return value
		.replace(/([a-z])([A-Z])/g, "$1 $2")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.split(/\s+/)
		.map((token) => token.trim())
		.filter((token) => token.length >= 3)
		.filter((token) => token !== "broken");
}

/**
 * Normalizes selector-like text for ranking.
 */
function normalizeSelectorText(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Scores selector text against context tokens.
 */
function scoreSelector(selector: string, tokens: string[]): number {
	const normalized = normalizeSelectorText(selector);
	let score = 0;
	for (const token of tokens) {
		if (normalized.includes(normalizeSelectorText(token))) {
			score += 3;
		}
	}

	if (selector.startsWith("[data-test") || selector.startsWith("[data-testid")) {
		score += 4;
	}
	if (selector.startsWith("#")) {
		score += 3;
	}
	if (selector.startsWith(".")) {
		score += 2;
	}

	return score;
}

/**
 * Extracts selector-like candidates from source lines.
 */
function extractSelectorsFromLine(lineText: string): string[] {
	const selectors = new Set<string>();
	const line = lineText.trim();

	const captureAll = (regex: RegExp, toSelector: (value: string) => string) => {
		for (const match of line.matchAll(regex)) {
			const raw = (match[1] ?? "").trim();
			if (!raw) {
				continue;
			}
			selectors.add(toSelector(raw));
		}
	};

	captureAll(/\bdata-testid\s*=\s*["'`]([^"'`]+)["'`]/gi, (value) => `[data-testid="${value}"]`);
	captureAll(/\bdata-test\s*=\s*["'`]([^"'`]+)["'`]/gi, (value) => `[data-test="${value}"]`);
	captureAll(/\bid\s*=\s*["'`]([^"'`\s]+)["'`]/gi, (value) => `#${value}`);
	captureAll(/\bname\s*=\s*["'`]([^"'`\s]+)["'`]/gi, (value) => `[name="${value}"]`);
	captureAll(/\baria-label\s*=\s*["'`]([^"'`]+)["'`]/gi, (value) => `[aria-label="${value}"]`);

	for (const match of line.matchAll(/\bclass(?:Name)?\s*=\s*["'`]([^"'`]+)["'`]/gi)) {
		const raw = (match[1] ?? "").trim();
		if (!raw) {
			continue;
		}
		const classTokens = raw
			.split(/\s+/)
			.map((token) => token.trim())
			.filter((token) => /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(token));
		for (const className of classTokens) {
			selectors.add(`.${className}`);
		}
	}

	for (const match of line.matchAll(/["'`]([a-z][a-z0-9]*(?:[-_][a-z0-9]+)+)["'`]/gi)) {
		const token = (match[1] ?? "").trim();
		if (!token || token.length < 4) {
			continue;
		}
		selectors.add(`.${token}`);
		selectors.add(`#${token}`);
		selectors.add(`[data-test="${token}"]`);
		selectors.add(`[data-testid="${token}"]`);
	}

	return Array.from(selectors);
}

/**
 * Resolves the configured project context root directory.
 */
function getContextRootDir(): string {
	const configured = process.env.AI_HEALING_PROJECT_CONTEXT_DIR?.trim();
	if (!configured) {
		return DEFAULT_PROJECT_CONTEXT_DIR;
	}

	if (path.isAbsolute(configured)) {
		return configured;
	}

	return path.resolve(process.cwd(), configured);
}

/**
 * Indicates if source-context enrichment is enabled.
 */
function isProjectContextEnabled(): boolean {
	return process.env.AI_HEALING_USE_PROJECT_CONTEXT !== "false";
}

/**
 * Recursively collects source files from the context directory.
 */
function walkFiles(rootDir: string): string[] {
	const queue: string[] = [rootDir];
	const files: string[] = [];

	while (queue.length > 0 && files.length < MAX_FILE_COUNT) {
		const current = queue.shift() as string;
		const entries = fs.readdirSync(current, { withFileTypes: true });

		for (const entry of entries) {
			if (files.length >= MAX_FILE_COUNT) {
				break;
			}

			const absolute = path.join(current, entry.name);
			if (entry.isDirectory()) {
				if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") {
					continue;
				}
				queue.push(absolute);
				continue;
			}

			const ext = path.extname(entry.name).toLowerCase();
			if (!ALLOWED_EXTENSIONS.has(ext)) {
				continue;
			}

			files.push(absolute);
		}
	}

	return files;
}

/**
 * Builds an in-memory index of selector-relevant lines.
 */
function buildIndex(rootDir: string): ContextIndexCache {
	const files = walkFiles(rootDir);
	const lines: IndexedLine[] = [];

	for (const filePath of files) {
		let stats: fs.Stats;
		try {
			stats = fs.statSync(filePath);
		} catch {
			continue;
		}

		if (stats.size > MAX_FILE_SIZE_BYTES) {
			continue;
		}

		let content = "";
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		const fileLines = content.split(/\r?\n/);
		for (let index = 0; index < fileLines.length; index += 1) {
			const lineText = fileLines[index].trim();
			if (!lineText || lineText.length > 240) {
				continue;
			}

			if (!LINE_MARKER_REGEX.test(lineText)) {
				continue;
			}

			lines.push({
				filePath,
				lineNumber: index + 1,
				lineText,
				normalized: lineText.toLowerCase(),
			});
		}
	}

	verboseLog("Project context index built", { rootDir, filesIndexed: files.length, indexedLines: lines.length });
	return { rootDir, lines };
}

/**
 * Returns cached index for the current root, building it when needed.
 */
function ensureIndex(rootDir: string): ContextIndexCache | null {
	if (!fs.existsSync(rootDir)) {
		verboseLog("Project context directory not found", { rootDir });
		return null;
	}

	if (cache && cache.rootDir === rootDir) {
		return cache;
	}

	cache = buildIndex(rootDir);
	return cache;
}

/**
 * Scores how relevant a source line is for the current healing context.
 */
function scoreLine(line: IndexedLine, tokens: string[]): number {
	let score = 0;
	for (const token of tokens) {
		if (line.normalized.includes(token)) {
			score += 3;
		}
	}

	if (/(data-test|data-testid|id=|name=|aria-label)/i.test(line.lineText)) {
		score += 2;
	}

	if (/className=|class=/i.test(line.lineText)) {
		score += 1;
	}

	return score;
}

/**
 * Produces a concise source-context snippet from project files.
 *
 * @param keyPath Locator key path under repair.
 * @param failedSelector Failed selector text.
 * @returns Formatted source hints for LLM prompt, or empty string.
 */
export function getProjectContextSnippet(keyPath: string, failedSelector: string): string {
	if (!isProjectContextEnabled()) {
		return "";
	}

	const rootDir = getContextRootDir();
	const index = ensureIndex(rootDir);
	if (!index || index.lines.length === 0) {
		return "";
	}

	const tokens = Array.from(new Set([...splitWords(keyPath), ...splitWords(failedSelector)]));
	if (tokens.length === 0) {
		return "";
	}

	const ranked = index.lines
		.map((line) => ({ line, score: scoreLine(line, tokens) }))
		.filter((item) => item.score > 0)
		.sort((left, right) => right.score - left.score)
		.slice(0, MAX_RETURN_LINES);

	if (ranked.length === 0) {
		verboseLog("Project context has no matching lines", { keyPath, failedSelector, tokens });
		return "";
	}

	const formattedLines = ranked.map((item) => {
		const relativePath = path.relative(rootDir, item.line.filePath).replace(/\\/g, "/");
		return `${relativePath}:${item.line.lineNumber} | ${item.line.lineText}`;
	});

	const snippet = [`Project source hints from ${rootDir.replace(/\\/g, "/")}:`, ...formattedLines]
		.join("\n")
		.slice(0, MAX_RETURN_CHARS);

	verboseLog("Project context snippet selected", {
		keyPath,
		failedSelector,
		tokens,
		matchCount: ranked.length,
		snippetLength: snippet.length,
	});

	return snippet;
}

/**
 * Returns selector candidates mined from the reference project source.
 */
export function getProjectSelectorCandidates(
	keyPath: string,
	failedSelector: string,
	maxCandidates = MAX_SELECTOR_CANDIDATES,
): string[] {
	if (!isProjectContextEnabled()) {
		return [];
	}

	const rootDir = getContextRootDir();
	const index = ensureIndex(rootDir);
	if (!index || index.lines.length === 0) {
		return [];
	}

	const tokens = Array.from(new Set([...splitWords(keyPath), ...splitWords(failedSelector)]));
	if (tokens.length === 0) {
		return [];
	}

	const rankedLines = index.lines
		.map((line) => ({ line, score: scoreLine(line, tokens) }))
		.filter((item) => item.score > 0)
		.sort((left, right) => right.score - left.score)
		.slice(0, 180);

	const selectorCandidates = new Map<string, ProjectSelectorCandidate>();
	for (const item of rankedLines) {
		for (const selector of extractSelectorsFromLine(item.line.lineText)) {
			const score = item.score + scoreSelector(selector, tokens);
			if (score <= 0) {
				continue;
			}

			const existing = selectorCandidates.get(selector);
			if (!existing || existing.score < score) {
				selectorCandidates.set(selector, { selector, score });
			}
		}
	}

	const rankedSelectors = Array.from(selectorCandidates.values())
		.sort((left, right) => right.score - left.score)
		.slice(0, maxCandidates)
		.map((item) => item.selector);

	verboseLog("Project selector candidates generated", {
		keyPath,
		failedSelector,
		tokens,
		candidateCount: rankedSelectors.length,
		rankedSelectors,
	});

	return rankedSelectors;
}
