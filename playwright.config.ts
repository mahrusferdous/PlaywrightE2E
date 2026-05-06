/// <reference types="node" />
import "dotenv/config";

// playwright.config.ts
import { defineConfig, devices } from "@playwright/test";

const testTimeout = Number.parseInt(process.env.PLAYWRIGHT_TEST_TIMEOUT_MS ?? "90000", 10);
const actionTimeout = Number.parseInt(process.env.PLAYWRIGHT_ACTION_TIMEOUT_MS ?? "0", 10);
const expectTimeout = Number.parseInt(process.env.PLAYWRIGHT_EXPECT_TIMEOUT_MS ?? "10000", 10);
const isCi = !!process.env.CI;

export default defineConfig({
	testDir: "./src/tests",
	timeout: Number.isFinite(testTimeout) && testTimeout > 0 ? testTimeout : 90000,
	retries: isCi ? 2 : 1,
	reporter: [["html"], ["list"], ["junit", { outputFile: "test-results/junit.xml" }]],
	expect: {
		timeout: Number.isFinite(expectTimeout) && expectTimeout > 0 ? expectTimeout : 10000,
	},
	fullyParallel: true,
	workers: isCi ? 1 : undefined,
	use: {
		headless: true,
		actionTimeout: Number.isFinite(actionTimeout) && actionTimeout >= 0 ? actionTimeout : 0,
		screenshot: "only-on-failure",
		trace: "retain-on-failure",
		video: "retain-on-failure",
	},
	projects: [
		// Desktop browsers
		{
			name: "chromium",
			use: {
				...devices["Desktop Chrome"],
				viewport: { width: 1280, height: 720 },
			},
		},
		{
			name: "firefox",
			use: {
				...devices["Desktop Firefox"],
				viewport: { width: 1280, height: 720 },
			},
		},
		{
			name: "webkit",
			use: {
				...devices["Desktop Safari"],
				viewport: { width: 1280, height: 720 },
			},
		},
		// Mobile browsers
		{
			name: "Mobile Chrome",
			use: {
				...devices["Pixel 5"],
			},
		},
		{
			name: "Mobile Safari",
			use: {
				...devices["iPhone 12"],
			},
		},
	],
	webServer: {
		command: 'echo "Using external test server at ${E2E_BASE_URL}"',
		reuseExistingServer: !isCi,
	},
});
