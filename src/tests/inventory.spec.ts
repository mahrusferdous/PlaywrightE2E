import { test, expect } from "@playwright/test";
import { LoginPage } from "../pages/LoginPage";
import { InventoryPage } from "../pages/InventoryPage";

test("Add Items to Cart", async ({ page }) => {
	const login = new LoginPage(page);
	const inventory = new InventoryPage(page);

	await login.goto();
	await login.login("standard_user", "secret_sauce");

	await inventory.addItemByName("Sauce Labs Backpack");
	await inventory.addItemByName("Sauce Labs Bike Light");
	await inventory.addItemByName("Sauce Labs Bolt T-Shirt");
	await inventory.addItemByName("Sauce Labs Fleece Jacket");
	await inventory.addItemByName("Sauce Labs Onesie");
	await inventory.addItemByName("Test.allTheThings() T-Shirt (Red)");

	await expect(inventory.itemCount()).resolves.toEqual(6);

	await inventory.removeItemByName("Sauce Labs Backpack");
	await inventory.removeItemByName("Sauce Labs Bike Light");
	await inventory.removeItemByName("Sauce Labs Bolt T-Shirt");
	await inventory.removeItemByName("Sauce Labs Fleece Jacket");
	await inventory.removeItemByName("Sauce Labs Onesie");
	await inventory.removeItemByName("Test.allTheThings() T-Shirt (Red)");

	await expect(inventory.itemCount()).resolves.toEqual(0);
});
