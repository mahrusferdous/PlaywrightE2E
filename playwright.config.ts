import "dotenv/config";

// playwright.config.ts
import { defineConfig } from "@playwright/test";

const testTimeout = Number.parseInt(process.env.PLAYWRIGHT_TEST_TIMEOUT_MS ?? "90000", 10);
const actionTimeout = Number.parseInt(process.env.PLAYWRIGHT_ACTION_TIMEOUT_MS ?? "0", 10);
const expectTimeout = Number.parseInt(process.env.PLAYWRIGHT_EXPECT_TIMEOUT_MS ?? "10000", 10);

export default defineConfig({
	testDir: "./src/tests",
	timeout: Number.isFinite(testTimeout) && testTimeout > 0 ? testTimeout : 90000,
	retries: 1,
	reporter: [["html"], ["list"]],
	expect: {
		timeout: Number.isFinite(expectTimeout) && expectTimeout > 0 ? expectTimeout : 10000,
	},
	use: {
		headless: true,
		viewport: { width: 1280, height: 720 },
		// Let each test's timeout be the main budget so self-healing has time to recover.
		actionTimeout: Number.isFinite(actionTimeout) && actionTimeout >= 0 ? actionTimeout : 0,
		screenshot: "only-on-failure",
		trace: "retain-on-failure",
	},
});
