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
		itemCard: ".inventory_item_broken",
		cartBadge: ".shopping_cart_link",
		addToCartButtonName: /add to cart/i,
		removeButtonName: /remove/i,
	},
	cart: {
		cartLink: ".shopping_cart_link_broken",
		cartItem: ".cart_item",
		checkoutButton: "#checkout_broken",
		removeButtonName: /remove/i,
	},
	checkout: {
		firstName: "#first-name",
		lastName: "#last-name",
		postalCode: "#postal-code",
		continueButton: "#continue",
		finishButton: "#finish_broken",
		backToProductsButton: "#back-to-products",
		completeHeader: ".complete-header",
		completeText: ".complete-text",
	},
};
