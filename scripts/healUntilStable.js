const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const overridesPath = path.resolve(process.cwd(), "src/pages/locator-overrides.json");

function readOverridesSnapshot() {
	if (!fs.existsSync(overridesPath)) {
		return "{}\n";
	}

	try {
		return fs.readFileSync(overridesPath, "utf-8");
	} catch {
		return "{}\n";
	}
}

function parseMaxRuns() {
	const raw = process.env.AI_HEALING_MAX_RERUNS ?? "12";
	const parsed = Number.parseInt(raw, 10);
	if (Number.isNaN(parsed) || parsed < 1) {
		return 12;
	}

	return parsed;
}

function shellEscape(arg) {
	if (!/[\s"]/g.test(arg)) {
		return arg;
	}

	return `"${arg.replace(/"/g, '\\"')}"`;
}

function parseOverridesSnapshot(raw) {
	try {
		return JSON.parse(raw);
	} catch {
		return {};
	}
}

function countChangedOverrides(previousRaw, currentRaw) {
	const previous = parseOverridesSnapshot(previousRaw);
	const current = parseOverridesSnapshot(currentRaw);
	const keys = new Set([...Object.keys(previous), ...Object.keys(current)]);
	let changed = 0;

	for (const key of keys) {
		if (previous[key] !== current[key]) {
			changed += 1;
		}
	}

	return changed;
}

function runPlaywright(args) {
	const command = ["npx", "playwright", "test", ...args].map(shellEscape).join(" ");
	const env = {
		...process.env,
		AI_HEALING_ENABLED: process.env.AI_HEALING_ENABLED ?? "true",
		PLAYWRIGHT_HTML_OPEN: process.env.PLAYWRIGHT_HTML_OPEN ?? "never",
	};
	const result = spawnSync(command, {
		stdio: "inherit",
		env,
		shell: true,
	});

	if (result.error) {
		console.error("[AI-Heal] Failed to launch Playwright command.", result.error);
	}

	return result;
}

const maxRuns = parseMaxRuns();
const playwrightArgs = process.argv.slice(2);
let previousOverrides = readOverridesSnapshot();
let lastStatus = 1;
let totalLocatorFixes = 0;

for (let attempt = 1; attempt <= maxRuns; attempt += 1) {
	console.info(`[AI-Heal] Run ${attempt}/${maxRuns}`);
	const result = runPlaywright(playwrightArgs);
	const currentOverrides = readOverridesSnapshot();
	const locatorOverridesChanged = currentOverrides !== previousOverrides;
	const changedOverrideCount = countChangedOverrides(previousOverrides, currentOverrides);
	lastStatus = result.status ?? 1;

	if (lastStatus === 0) {
		if (changedOverrideCount > 0) {
			totalLocatorFixes += changedOverrideCount;
		}
		console.info(
			`[AI-Heal] Test run passed on attempt ${attempt}. Total locator fixes saved: ${totalLocatorFixes}.`,
		);
		process.exit(0);
	}

	if (!locatorOverridesChanged) {
		console.error("[AI-Heal] Test run failed and no new locator fixes were saved. Stopping reruns.");
		process.exit(lastStatus);
	}

	totalLocatorFixes += changedOverrideCount;
	console.info(
		`[AI-Heal] Saved ${changedOverrideCount} locator fix(es) on attempt ${attempt}. Rerunning to find and repair the next broken locator...`,
	);
	previousOverrides = currentOverrides;
}

console.error(
	`[AI-Heal] Reached max reruns (${maxRuns}) before tests passed. Locator fixes saved so far: ${totalLocatorFixes}.`,
);
process.exit(lastStatus || 1);
