import express, { type Request, type Response } from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import { chromium, type Browser, type Page } from "playwright";
import { resolveSelfHealingLocator } from "./healing/selfHealingLocator";
import { requestSelectorCandidates } from "./healing/llmLocatorHealer";
import { getAllStringLocatorKeyPaths, resolveLocatorKeyPath, getLocatorValue } from "./healing/locatorStore";
import { appLocators } from "./pages/locators";
import { getExpectedPageScope } from "./healing/pageContext";

dotenv.config();
process.env.AI_HEALING_MCP_FALLBACK_ENABLED = "false";

const PORT = Number(process.env.MCP_PORT ?? 8080);

const app = express();
app.use(bodyParser.json());

let browser: Browser | null = null;
let page: Page | null = null;

async function ensureBrowser() {
	if (browser && page && !page.isClosed()) return;
	if (!browser) {
		browser = await chromium.launch({ headless: process.env.HEADLESS !== "false" });
	}
	const context = await browser.newContext();
	page = await context.newPage();
}

function getSauceCredentials() {
	return {
		username: process.env.SAUCE_USERNAME ?? "standard_user",
		password: process.env.SAUCE_PASSWORD ?? "secret_sauce",
	};
}

function isSauceDemoUrl(url: string) {
	return /(^https?:\/\/)?(www\.)?saucedemo\.com/i.test(url);
}

async function loginSauceDemo(targetPage: Page) {
	const loginVisible =
		(await targetPage
			.locator("#user-name")
			.count()
			.catch(() => 0)) > 0;
	if (!loginVisible) {
		return;
	}

	const { username, password } = getSauceCredentials();
	await targetPage.locator("#user-name").first().fill(username);
	await targetPage.locator("#password").first().fill(password);
	await targetPage.locator("#login-button").first().click();
	await targetPage.waitForLoadState("domcontentloaded");
}

async function openSauceDemoLoginPage(targetPage: Page) {
	await targetPage.goto(appLocators.app.baseUrl, { waitUntil: "domcontentloaded" });
}

async function ensureSauceDemoAuthenticated(targetPage: Page) {
	await openSauceDemoLoginPage(targetPage);
	await loginSauceDemo(targetPage);
}

async function ensureCartHasAtLeastOneItem(targetPage: Page) {
	const cartBadgeCount = await targetPage
		.locator('[data-test="shopping-cart-badge"]')
		.count()
		.catch(() => 0);
	if (cartBadgeCount > 0) {
		return;
	}

	const firstAddButton = targetPage.locator('button[data-test^="add-to-cart"]').first();
	const addCount = await firstAddButton.count().catch(() => 0);
	if (addCount > 0) {
		await firstAddButton.click();
	}
}

async function ensureSauceDemoStateForKeyPath(targetPage: Page, keyPath: string, authenticated = false) {
	const expectedScope = getExpectedPageScope(keyPath);

	if (expectedScope === "login") {
		await openSauceDemoLoginPage(targetPage);
		return;
	}

	if (!authenticated) {
		await ensureSauceDemoAuthenticated(targetPage);
	}

	if (expectedScope === "inventory" || expectedScope === "global-nav") {
		return;
	}

	await ensureCartHasAtLeastOneItem(targetPage);
	await targetPage.locator('[data-test="shopping-cart-link"]').first().click();
	await targetPage.waitForLoadState("domcontentloaded");

	if (expectedScope === "cart") {
		return;
	}

	if (expectedScope === "checkout-info") {
		await targetPage.locator("#checkout").first().click();
		await targetPage.waitForLoadState("domcontentloaded");
		return;
	}

	if (expectedScope === "checkout-overview" || expectedScope === "checkout-complete") {
		await targetPage.locator("#checkout").first().click();
		await targetPage.waitForLoadState("domcontentloaded");
		await targetPage.locator("#first-name").first().fill("MCP");
		await targetPage.locator("#last-name").first().fill("Healer");
		await targetPage.locator("#postal-code").first().fill("12345");
		await targetPage.locator("#continue").first().click();
		await targetPage.waitForLoadState("domcontentloaded");
	}

	if (expectedScope === "checkout-complete") {
		const finishCount = await targetPage
			.locator("#finish")
			.count()
			.catch(() => 0);
		if (finishCount > 0) {
			await targetPage.locator("#finish").first().click();
			await targetPage.waitForLoadState("domcontentloaded");
		}
	}
}

async function healLocatorForKeyPath(
	targetPage: Page,
	keyPath: string,
	options?: {
		authenticated?: boolean;
		description?: string;
		requireVisible?: boolean;
	},
) {
	const resolvedKey = resolveLocatorKeyPath(keyPath);
	const base = getBaseLocatorValue(resolvedKey);
	if (base === null) {
		return {
			keyPathResolved: resolvedKey,
			baseSelector: null,
			effectiveSelector: null,
			healed: false,
		};
	}

	if (isSauceDemoUrl(targetPage.url() || appLocators.app.baseUrl)) {
		await ensureSauceDemoStateForKeyPath(targetPage, resolvedKey, options?.authenticated ?? false);
	}

	await resolveSelfHealingLocator(targetPage, resolvedKey, {
		description: options?.description ?? resolvedKey,
		requireVisible: options?.requireVisible ?? true,
		validateOnResolve: true,
	});

	const effective = getLocatorValue(resolvedKey);
	return {
		keyPathResolved: resolvedKey,
		baseSelector: base,
		effectiveSelector: effective,
		healed: effective !== base,
	};
}

async function healLocatorFromSnapshot(request: {
	keyPath: string;
	failedSelector: string;
	description?: string;
	requireVisible?: boolean;
	expectedPage?: string;
	currentPage?: string;
	currentPageReason?: string;
	currentUrl?: string;
	pageTitle?: string;
	errorMessage?: string;
	uiTextSnippet?: string;
	pageHtmlSnippet?: string;
}) {
	const resolvedKey = resolveLocatorKeyPath(request.keyPath);
	const baseSelector = getBaseLocatorValue(resolvedKey);
	if (baseSelector === null) {
		return {
			keyPathResolved: resolvedKey,
			baseSelector: null,
			effectiveSelector: null,
			healed: false,
		};
	}

	const selectors = await requestSelectorCandidates({
		keyPath: resolvedKey,
		failedSelector: request.failedSelector,
		expectedPage: request.expectedPage ?? getExpectedPageScope(resolvedKey),
		currentPage: request.currentPage ?? "unknown",
		currentPageReason: request.currentPageReason ?? "snapshot from active Playwright page",
		currentUrl: request.currentUrl ?? appLocators.app.baseUrl,
		pageTitle: request.pageTitle ?? "",
		errorMessage: request.errorMessage ?? "Locator action failed",
		uiTextSnippet: request.uiTextSnippet ?? "",
		pageHtmlSnippet: request.pageHtmlSnippet ?? "",
	});

	const effectiveSelector = selectors[0] ?? baseSelector;
	return {
		keyPathResolved: resolvedKey,
		baseSelector,
		effectiveSelector,
		healed: effectiveSelector !== baseSelector,
	};
}

async function scanAllSauceDemoLocators(targetPage: Page, url?: string) {
	const baseUrl = url ?? appLocators.app.baseUrl;
	await targetPage.goto(baseUrl, { waitUntil: "domcontentloaded" });
	await loginSauceDemo(targetPage);

	const keyPaths = getAllStringLocatorKeyPaths().sort((left, right) => left.localeCompare(right));
	const results = [] as Array<{
		keyPathResolved: string;
		baseSelector: string | null;
		effectiveSelector: string | null;
		healed: boolean;
	}>;

	for (const keyPath of keyPaths) {
		results.push(
			await healLocatorForKeyPath(targetPage, keyPath, {
				authenticated: true,
				description: keyPath,
				requireVisible: true,
			}),
		);
	}

	return {
		baseUrl,
		keyPathCount: keyPaths.length,
		results,
	};
}

function getBaseLocatorValue(resolvedKeyPath: string): string | null {
	const parts = resolvedKeyPath.split(".");
	let cur: any = appLocators as any;
	for (const p of parts) {
		if (typeof cur === "object" && cur !== null && p in cur) {
			cur = cur[p];
		} else {
			return null;
		}
	}
	return typeof cur === "string" ? cur : null;
}

app.get("/status", (_req: Request, res: Response) => {
	res.json({ ok: true, aiHealingEnabled: process.env.AI_HEALING_ENABLED === "true" });
});

app.post("/navigate", async (req: Request, res: Response) => {
	try {
		const { url } = req.body;
		if (!url) return res.status(400).json({ error: "missing url" });
		await ensureBrowser();
		if (!page) throw new Error("page not available");
		const nav = await page.goto(url, { waitUntil: "domcontentloaded" });
		const title = await page.title().catch(() => "");
		res.json({ url: page.url(), title, status: nav?.status() ?? 0 });
	} catch (error) {
		res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
	}
});

app.post("/login", async (req: Request, res: Response) => {
	try {
		const { url } = req.body as { url?: string };
		await ensureBrowser();
		if (!page) throw new Error("page not available");

		await openSauceDemoLoginPage(page);
		if (url && isSauceDemoUrl(url)) {
			await page.goto(url, { waitUntil: "domcontentloaded" });
		}
		await loginSauceDemo(page);

		const title = await page.title().catch(() => "");
		res.json({ url: page.url(), title, loggedIn: true });
	} catch (error) {
		res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
	}
});

app.post("/heal-locator", async (req: Request, res: Response) => {
	try {
		const { url, keyPath, failedSelector, description, requireVisible } = req.body as {
			url?: string;
			keyPath: string;
			failedSelector?: string;
			description?: string;
			requireVisible?: boolean;
			expectedPage?: string;
			currentPage?: string;
			currentPageReason?: string;
			currentUrl?: string;
			pageTitle?: string;
			errorMessage?: string;
			uiTextSnippet?: string;
			pageHtmlSnippet?: string;
		};

		if (!keyPath) return res.status(400).json({ error: "missing keyPath" });
		if (!req.body?.pageHtmlSnippet && !req.body?.uiTextSnippet) {
			return res
				.status(400)
				.json({
					error: "snapshot fields are required; send the current Playwright page snapshot instead of asking the server to navigate",
				});
		}

		const resolvedKey = resolveLocatorKeyPath(keyPath);
		const healed = await healLocatorFromSnapshot({
			keyPath: resolvedKey,
			failedSelector: failedSelector ?? getLocatorValue(resolvedKey),
			description,
			requireVisible,
			expectedPage: req.body?.expectedPage,
			currentPage: req.body?.currentPage,
			currentPageReason: req.body?.currentPageReason,
			currentUrl: req.body?.currentUrl ?? url,
			pageTitle: req.body?.pageTitle,
			errorMessage: req.body?.errorMessage,
			uiTextSnippet: req.body?.uiTextSnippet,
			pageHtmlSnippet: req.body?.pageHtmlSnippet,
		});

		if (healed.baseSelector === null) {
			return res.status(400).json({ error: `unknown locator key path '${resolvedKey}'` });
		}

		res.json({
			keyPathResolved: healed.keyPathResolved,
			baseSelector: healed.baseSelector,
			effectiveSelector: healed.effectiveSelector,
			healed: healed.healed,
		});
	} catch (error) {
		res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
	}
});

app.post("/scan-locators", async (req: Request, res: Response) => {
	try {
		const { url } = req.body as { url?: string };
		await ensureBrowser();
		if (!page) throw new Error("page not available");

		const scan = await scanAllSauceDemoLocators(page, url);
		res.json(scan);
	} catch (error) {
		res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
	}
});

const server = app.listen(PORT, () => {
	// eslint-disable-next-line no-console
	console.info(`[MCP] Server listening on http://localhost:${PORT}`);
});

process.on("SIGINT", async () => {
	// eslint-disable-next-line no-console
	console.info("[MCP] Shutting down...");
	try {
		await server.close();
		if (browser) await browser.close();
	} catch {}
	process.exit(0);
});

export {};
