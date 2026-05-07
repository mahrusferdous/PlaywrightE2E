/**
 * Central locator map for all Playwright E2E page objects.
 *
 * Intentionally broken selectors are kept in some entries to demonstrate
 * and validate the self-healing workflow.
 */
export const appLocators = {
	app: {
		baseUrl: "https://www.saucedemo.com/",
	},
	login: {
		username: "#user-name",
		password: "#password",
		loginButton: "#login-button",
		errorMessage: "data-test=error",
	},
	inventory: {
		itemCard: ".inventory_item",
		cartBadge: ".shopping_cart_link .shopping_cart_bade",
		addToCartButtonName: /add to cart/i,
		removeButtonName: /remove/i,
	},
	cart: {
		cartLink: ".shopping_cart_link",
		cartItem: ".cart_item",
		checkoutButton: "#check",
		removeButtonName: /remove/i,
	},
	checkout: {
		firstName: "#first-name",
		lastName: "#last-name",
		postalCode: "#postal",
		continueButton: "#continue",
		finishButton: "#finish",
		backToProductsButton: "#back-to-products",
		completeHeader: ".complete-header",
		completeText: ".complete-text",
	},
};
