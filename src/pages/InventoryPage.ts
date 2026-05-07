import { Page } from "@playwright/test";
import { appLocators } from "./locators";
import { withSelfHealingLocator } from "../healing/selfHealingLocator";
import { setLocatorValue } from "../healing/locatorStore";

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
		try {
			const text = await withSelfHealingLocator(
				this.page,
				"inventory.cartBadge",
				async (locator) => {
					const count = await locator.count();
					if (count === 0) {
						throw new Error("[InventoryPage] inventory.cartBadge not found");
					}

					const raw = (
						await locator
							.first()
							.innerText()
							.catch(() => "")
					).trim();
					if (!raw) {
						throw new Error("[InventoryPage] inventory.cartBadge text is empty");
					}

					const numeric = Number.parseInt(raw, 10);
					if (Number.isNaN(numeric)) {
						throw new Error(
							`[InventoryPage] Non-numeric cart badge text for inventory.cartBadge: '${raw}'`,
						);
					}

					return String(numeric);
				},
				{ description: "Inventory cart badge", requireVisible: false },
			);

			const parsed = Number.parseInt((text ?? "0").trim(), 10);
			return Number.isNaN(parsed) ? 0 : parsed;
		} catch (error) {
			const fallbackBadge = this.page.locator('[data-test="shopping-cart-badge"], .shopping_cart_badge').first();
			const fallbackCount = await fallbackBadge.count().catch(() => 0);
			if (fallbackCount === 0) {
				return 0;
			}

			const fallbackText = (await fallbackBadge.innerText().catch(() => "")).trim();
			const fallbackParsed = Number.parseInt(fallbackText, 10);
			if (!Number.isNaN(fallbackParsed)) {
				setLocatorValue("inventory.cartBadge", '[data-test="shopping-cart-badge"]');
				return fallbackParsed;
			}

			throw error;
		}
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
