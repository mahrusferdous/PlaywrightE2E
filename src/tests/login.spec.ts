import { test } from "@playwright/test";
import { LoginPage } from "../pages/LoginPage";

test("User can login successfully", async ({ page }) => {
	await page.goto("https://www.saucedemo.com/");

	const loginPage = new LoginPage(page);
	await loginPage.login("standard_user", "secret_sauce");

	await page.waitForSelector(".inventory_list");
});
