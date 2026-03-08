export const appLocators = {
	app: {
		baseUrl: "https://www.saucedemo.com/",
	},
	login: {
		username: "#user-name",
		password: "#password",
		loginButton: "#login-button_broken",
		errorMessage: "data-test=error",
	},
	inventory: {
		itemCard: ".inventory_item",
		cartBadge: ".shopping_cart_link",
		addToCartButtonName: /add to cart/i,
		removeButtonName: /remove/i,
	},
	cart: {
		cartLink: ".shopping_cart_link",
		cartItem: ".cart_item",
		checkoutButton: "#checkout",
		removeButtonName: /remove/i,
	},
	checkout: {
		firstName: "#first-name",
		lastName: "#last-name",
		postalCode: "#postal-code",
		continueButton: "#continue",
		finishButton: "#finish",
		backToProductsButton: "#back-to-products-broken",
		completeHeader: ".complete-header-broken",
		completeText: ".complete-text-broken",
	},
};
