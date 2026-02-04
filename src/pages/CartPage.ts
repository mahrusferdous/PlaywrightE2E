import { Page, Locator } from "@playwright/test";

export class CartPage {
	private page: Page;
	private cart: Locator;
	private cartItems: Locator;
	private checkoutBtn: Locator;

	constructor(page: Page) {
		this.page = page;
		this.cart = page.locator(".shopping_cart_link");
		this.cartItems = page.locator(".cart_item");
		this.checkoutBtn = page.locator("#checkout");
	}

	async goToCart() {
		await this.cart.click();
	}

	async removeItem(name: string) {
		const item = this.cartItems.filter({ hasText: name });
		await item.getByRole("button", { name: /remove/i }).click();
	}

	async checkout() {
		await this.checkoutBtn.click();
	}
}
