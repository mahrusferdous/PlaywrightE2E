import { test, expect } from "@playwright/test";
import { LoginPage } from "../pages/LoginPage";
import { InventoryPage } from "../pages/InventoryPage";
import { CartPage } from "../pages/CartPage";

test("Cart Flow", async ({ page }) => {
	const login = new LoginPage(page);
	const inventory = new InventoryPage(page);
	const cart = new CartPage(page);

	await login.goto();
	await login.login("standard_user", "secret_sauce");

	await inventory.addItemByName("Sauce Labs Backpack");
	await inventory.addItemByName("Sauce Labs Onesie");
	await inventory.addItemByName("Sauce Labs Fleece Jacket");
	await cart.goToCart();

	await expect(inventory.itemCount()).resolves.toEqual(3);

	await cart.removeItem("Sauce Labs Fleece Jacket");
	await expect(inventory.itemCount()).resolves.toEqual(2);
});
