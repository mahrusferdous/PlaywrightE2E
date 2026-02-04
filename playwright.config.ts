// playwright.config.ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./src/tests",
	timeout: 30000,
	retries: 1,
	reporter: [["html"], ["list"]],
	use: {
		headless: true,
		viewport: { width: 1280, height: 720 },
		actionTimeout: 10000,
		screenshot: "only-on-failure",
		trace: "retain-on-failure",
	},
});
