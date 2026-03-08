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

const ALLOWED_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".html"]);
const LINE_MARKER_REGEX =
	/(id|className|class|data-test|data-testid|aria-label|name)\s*=|getByRole|getByText|locator\(/i;
const DEFAULT_PROJECT_CONTEXT_DIR = path.resolve(process.cwd(), "../sample-app-web/src");
const MAX_FILE_COUNT = 500;
const MAX_FILE_SIZE_BYTES = 300_000;
const MAX_RETURN_LINES = 20;
const MAX_RETURN_CHARS = 4200;

let cache: ContextIndexCache | null = null;

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

function isProjectContextEnabled(): boolean {
	return process.env.AI_HEALING_USE_PROJECT_CONTEXT !== "false";
}

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
