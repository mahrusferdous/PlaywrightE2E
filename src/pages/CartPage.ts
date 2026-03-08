import { Page } from "@playwright/test";
import { appLocators } from "./locators";
import { withSelfHealingLocator } from "../healing/selfHealingLocator";

export class CartPage {
	private page: Page;

	constructor(page: Page) {
		this.page = page;
	}

	async goToCart() {
		await withSelfHealingLocator(this.page, "cart.cartLink", (locator) => locator.click(), {
			description: "Cart link",
		});
	}

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

	async checkout() {
		await withSelfHealingLocator(this.page, "cart.checkoutButton", (locator) => locator.click(), {
			description: "Checkout button",
		});
	}
}
