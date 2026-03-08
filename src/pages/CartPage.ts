import { Page, Locator } from "@playwright/test";
import { appLocators } from "./locators";

export class CartPage {
	private page: Page;
	private cart: Locator;
	private cartItems: Locator;
	private checkoutBtn: Locator;

	constructor(page: Page) {
		this.page = page;
		this.cart = page.locator(appLocators.cart.cartLink);
		this.cartItems = page.locator(appLocators.cart.cartItem);
		this.checkoutBtn = page.locator(appLocators.cart.checkoutButton);
	}

	async goToCart() {
		await this.cart.click();
	}

	async removeItem(name: string) {
		const item = this.cartItems.filter({ hasText: name });
		await item.getByRole("button", { name: appLocators.cart.removeButtonName }).click();
	}

	async checkout() {
		await this.checkoutBtn.click();
	}
}
