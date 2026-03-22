import type { Page } from "@playwright/test";

export type PageScope =
	| "login"
	| "inventory"
	| "cart"
	| "checkout-info"
	| "checkout-overview"
	| "checkout-complete"
	| "global-nav"
	| "unknown";

export interface PageDetectionResult {
	scope: PageScope;
	reason: string;
}

interface PageRule {
	scope: Exclude<PageScope, "global-nav" | "unknown">;
	urlIncludes?: string[];
	selectors?: string[];
	textIncludes?: string[];
}

const PAGE_RULES: PageRule[] = [
	{
		scope: "login",
		selectors: ["#login-button", "#user-name", "#password"],
		textIncludes: ["Accepted usernames are:", "Password for all users:"],
	},
	{
		scope: "inventory",
		urlIncludes: ["inventory"],
		selectors: [".inventory_list", ".inventory_item"],
		textIncludes: ["Products"],
	},
	{
		scope: "cart",
		urlIncludes: ["cart"],
		selectors: ["#checkout", ".cart_item"],
		textIncludes: ["Your Cart"],
	},
	{
		scope: "checkout-info",
		urlIncludes: ["checkout-step-one"],
		selectors: ["#continue", "#first-name", "#last-name", "#postal-code"],
		textIncludes: ["Checkout: Your Information"],
	},
	{
		scope: "checkout-overview",
		urlIncludes: ["checkout-step-two"],
		selectors: ["#finish"],
		textIncludes: ["Checkout: Overview"],
	},
	{
		scope: "checkout-complete",
		urlIncludes: ["checkout-complete"],
		selectors: ["#back-to-products", ".complete-header", ".complete-text"],
		textIncludes: ["Checkout: Complete!", "Thank you for your order!"],
	},
];

/**
 * Maps locator key paths to the page scope where healing should occur.
 */
export function getExpectedPageScope(keyPath: string): PageScope {
	if (keyPath === "cart.cartLink") {
		return "global-nav";
	}

	if (keyPath.startsWith("login.")) {
		return "login";
	}

	if (keyPath.startsWith("inventory.")) {
		return "inventory";
	}

	if (keyPath.startsWith("cart.")) {
		return "cart";
	}

	if (keyPath === "checkout.finishButton") {
		return "checkout-overview";
	}

	if (
		keyPath === "checkout.backToProductsButton" ||
		keyPath === "checkout.completeHeader" ||
		keyPath === "checkout.completeText"
	) {
		return "checkout-complete";
	}

	if (keyPath.startsWith("checkout.")) {
		return "checkout-info";
	}

	return "unknown";
}

/**
 * Checks whether the current page is compatible with the expected locator scope.
 */
export function isPageScopeCompatible(expected: PageScope, actual: PageScope): boolean {
	if (expected === "unknown" || actual === "unknown") {
		return true;
	}

	if (expected === "global-nav") {
		return actual !== "login";
	}

	return expected === actual;
}

/**
 * Detects the current page scope from URL, landmark selectors, and visible text.
 */
export async function detectCurrentPageScope(page: Page): Promise<PageDetectionResult> {
	const url = page.url().toLowerCase();
	const bodyText = (await page.locator("body").innerText().catch(() => "")).trim();
	const normalizedBodyText = bodyText.toLowerCase();

	for (const rule of PAGE_RULES) {
		const hasUrlMatch = (rule.urlIncludes ?? []).some((fragment) => url.includes(fragment.toLowerCase()));
		if (hasUrlMatch) {
			return { scope: rule.scope, reason: `matched URL fragment for ${rule.scope}` };
		}

		for (const selector of rule.selectors ?? []) {
			const count = await page.locator(selector).count().catch(() => 0);
			if (count > 0) {
				return { scope: rule.scope, reason: `matched selector '${selector}' for ${rule.scope}` };
			}
		}

		for (const text of rule.textIncludes ?? []) {
			if (normalizedBodyText.includes(text.toLowerCase())) {
				return { scope: rule.scope, reason: `matched visible text '${text}' for ${rule.scope}` };
			}
		}
	}

	return { scope: "unknown", reason: "no page rule matched current URL, landmarks, or visible text" };
}
