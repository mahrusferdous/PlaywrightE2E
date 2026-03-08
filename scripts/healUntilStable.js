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
	const raw = process.env.AI_HEALING_MAX_RERUNS ?? "6";
	const parsed = Number.parseInt(raw, 10);
	if (Number.isNaN(parsed) || parsed < 1) {
		return 6;
	}

	return parsed;
}

function shellEscape(arg) {
	if (!/[\s"]/g.test(arg)) {
		return arg;
	}

	return `"${arg.replace(/"/g, '\\"')}"`;
}

function runPlaywright(args) {
	const command = ["npx", "playwright", "test", ...args].map(shellEscape).join(" ");
	const env = {
		...process.env,
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

for (let attempt = 1; attempt <= maxRuns; attempt += 1) {
	console.info(`[AI-Heal] Run ${attempt}/${maxRuns}`);
	const result = runPlaywright(playwrightArgs);
	const currentOverrides = readOverridesSnapshot();
	const locatorOverridesChanged = currentOverrides !== previousOverrides;
	lastStatus = result.status ?? 1;

	if (lastStatus === 0) {
		console.info(`[AI-Heal] Test run passed on attempt ${attempt}.`);
		process.exit(0);
	}

	if (!locatorOverridesChanged) {
		console.error("[AI-Heal] Test run failed and no new locator fixes were saved. Stopping reruns.");
		process.exit(lastStatus);
	}

	console.info("[AI-Heal] New locator fixes detected. Rerunning tests...");
	previousOverrides = currentOverrides;
}

console.error(`[AI-Heal] Reached max reruns (${maxRuns}) before tests passed.`);
process.exit(lastStatus || 1);
