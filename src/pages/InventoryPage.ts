import { Page, Locator } from "@playwright/test";

export class InventoryPage {
	private page: Page;
	private inventoryItems: Locator;
	private cartBadge: Locator;

	constructor(page: Page) {
		this.page = page;
		this.inventoryItems = page.locator(".inventory_item");
		this.cartBadge = page.locator(".shopping_cart_link");
	}

	async addItemByName(name: string) {
		const item = this.inventoryItems.filter({ hasText: name });
		await item.getByRole("button", { name: /add to cart/i }).click();
	}

	async itemCount() {
		const text = await this.cartBadge.textContent();
		return text ? parseInt(text) : 0;
	}

	async removeItemByName(name: string) {
		const item = this.inventoryItems.filter({ hasText: name });
		await item.getByRole("button", { name: /remove/i }).click();
	}
}
