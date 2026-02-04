import { test, expect } from "@playwright/test";
import { LoginPage } from "../pages/LoginPage";

test.describe("Login Tests", () => {
	test("Valid Login", async ({ page }) => {
		const login = new LoginPage(page);
		await login.goto();
		await login.login("standard_user", "secret_sauce");
		await expect(page).toHaveURL(/inventory/);
	});

	test("Invalid Login Shows Error", async ({ page }) => {
		const login = new LoginPage(page);
		await login.goto();
		await login.login("locked_out_user", "wrong_password");
		await expect(login.getErrorMessage()).resolves.toContain("Epic sadface");
	});
});
