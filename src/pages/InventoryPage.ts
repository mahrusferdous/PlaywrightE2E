import { Page } from "@playwright/test";
import { appLocators } from "./locators";
import { withSelfHealingLocator } from "../healing/selfHealingLocator";

/**
 * Encapsulates user interactions on the product inventory screen.
 */
export class InventoryPage {
	private page: Page;

	/**
	 * Initializes the InventoryPage with the given Playwright Page object.
	 *
	 * @param page The Playwright Page object used to interact with inventory UI.
	 */
	constructor(page: Page) {
		this.page = page;
	}

	/**
	 * Adds a product to the cart by product name.
	 *
	 * @param name The product name to match in the inventory list.
	 * @returns A promise that resolves when the item has been added.
	 */
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

	/**
	 * Returns the current cart badge count from the inventory header.
	 *
	 * @returns A promise that resolves to the numeric cart item count.
	 */
	async itemCount() {
		const text = await withSelfHealingLocator(
			this.page,
			"inventory.cartBadge",
			(locator) => locator.textContent(),
			{ description: "Inventory cart badge", requireVisible: false },
		);
		return text ? parseInt(text) : 0;
	}

	/**
	 * Removes a product from the cart by product name.
	 *
	 * @param name The product name to match in the inventory list.
	 * @returns A promise that resolves when the item has been removed.
	 */
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
