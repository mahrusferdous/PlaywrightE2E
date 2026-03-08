import { Page, Locator } from "@playwright/test";
import { appLocators } from "./locators";

export class InventoryPage {
	private page: Page;
	private inventoryItems: Locator;
	private cartBadge: Locator;

	constructor(page: Page) {
		this.page = page;
		this.inventoryItems = page.locator(appLocators.inventory.itemCard);
		this.cartBadge = page.locator(appLocators.inventory.cartBadge);
	}

	async addItemByName(name: string) {
		const item = this.inventoryItems.filter({ hasText: name });
		await item.getByRole("button", { name: appLocators.inventory.addToCartButtonName }).click();
	}

	async itemCount() {
		const text = await this.cartBadge.textContent();
		return text ? parseInt(text) : 0;
	}

	async removeItemByName(name: string) {
		const item = this.inventoryItems.filter({ hasText: name });
		await item.getByRole("button", { name: appLocators.inventory.removeButtonName }).click();
	}
}
