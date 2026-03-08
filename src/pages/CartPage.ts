import { Page } from "@playwright/test";
import { appLocators } from "./locators";
import { withSelfHealingLocator } from "../healing/selfHealingLocator";

export class CartPage {
	private page: Page;

	/**
	 * Initializes the CartPage with the given Playwright Page object.
	 *
	 * @param page The Playwright Page object used to interact with cart UI.
	 */
	constructor(page: Page) {
		this.page = page;
	}

	/**
	 * Opens the cart page from the header cart link.
	 *
	 * @returns A promise that resolves when cart navigation is complete.
	 */
	async goToCart() {
		await withSelfHealingLocator(this.page, "cart.cartLink", (locator) => locator.click(), {
			description: "Cart link",
		});
	}

	/**
	 * Removes a cart item by product name.
	 *
	 * @param name The product name to find inside cart rows.
	 * @returns A promise that resolves when the remove action is complete.
	 */
	async removeItem(name: string) {
		await withSelfHealingLocator(
			this.page,
			"cart.cartItem",
			async (cartItems) => {
				const item = cartItems.filter({ hasText: name });
				await item.getByRole("button", { name: appLocators.cart.removeButtonName }).click();
			},
			{ description: `Cart row for '${name}'` },
		);
	}

	/**
	 * Starts checkout from the cart page.
	 *
	 * @returns A promise that resolves when the checkout action is triggered.
	 */
	async checkout() {
		await withSelfHealingLocator(this.page, "cart.checkoutButton", (locator) => locator.click(), {
			description: "Checkout button",
		});
	}
}
