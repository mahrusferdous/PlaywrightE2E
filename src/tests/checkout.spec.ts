import { test, expect } from "@playwright/test";
import { LoginPage } from "../pages/LoginPage";
import { InventoryPage } from "../pages/InventoryPage";
import { CartPage } from "../pages/CartPage";
import { CheckoutPage } from "../pages/CheckoutPage";

test("Checkout Flow", async ({ page }) => {
	const login = new LoginPage(page);
	const inventory = new InventoryPage(page);
	const cart = new CartPage(page);
	const checkout = new CheckoutPage(page);

	await login.goto();
	await login.login("standard_user", "secret_sauce");

	await inventory.addItemByName("Sauce Labs Bike Light");
	await inventory.addItemByName("Sauce Labs Bolt T-Shirt");
	await inventory.addItemByName("Test.allTheThings() T-Shirt (Red)");

	await cart.goToCart();
	await cart.checkout();

	await checkout.fillCheckoutForm("John", "Doe", "12345");
	await checkout.finishOrder();

	await expect(page.locator(".complete-header")).toHaveText("Thank you for your order!");
	await expect(page.locator(".complete-text")).toHaveText(
		"Your order has been dispatched, and will arrive just as fast as the pony can get there!",
	);

	await checkout.backHome();
	await expect(page).toHaveURL(/inventory/);
});
