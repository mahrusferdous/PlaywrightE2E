import { Page } from "@playwright/test";
import { appLocators } from "./locators";
import { withSelfHealingLocator } from "../healing/selfHealingLocator";

export class InventoryPage {
	private page: Page;

	constructor(page: Page) {
		this.page = page;
	}

	async addItemByName(name: string) {
		await withSelfHealingLocator(
			this.page,
			"inventory.itemCard",
			async (inventoryItems) => {
				const item = inventoryItems.filter({ hasText: name });
				await item.getByRole("button", { name: appLocators.inventory.addToCartButtonName }).click();
			},
			{ description: `Inventory card for '${name}'` },
		);
	}

	async itemCount() {
		const text = await withSelfHealingLocator(
			this.page,
			"inventory.cartBadge",
			(locator) => locator.textContent(),
			{ description: "Inventory cart badge", requireVisible: false },
		);
		return text ? parseInt(text) : 0;
	}

	async removeItemByName(name: string) {
		await withSelfHealingLocator(
			this.page,
			"inventory.itemCard",
			async (inventoryItems) => {
				const item = inventoryItems.filter({ hasText: name });
				await item.getByRole("button", { name: appLocators.inventory.removeButtonName }).click();
			},
			{ description: `Inventory remove card for '${name}'` },
		);
	}
}
