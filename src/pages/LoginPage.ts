import { Page, Locator } from "@playwright/test";
import { appLocators } from "./locators";

export class LoginPage {
	private page: Page;
	private username: Locator;
	private password: Locator;
	private btnLogin: Locator;
	private errorMsg: Locator;

	constructor(page: Page) {
		this.page = page;
		this.username = page.locator(appLocators.login.username);
		this.password = page.locator(appLocators.login.password);
		this.btnLogin = page.locator(appLocators.login.loginButton);
		this.errorMsg = page.locator(appLocators.login.errorMessage);
	}

	async goto() {
		await this.page.goto(appLocators.app.baseUrl);
	}

	async login(username: string, password: string) {
		await this.username.fill(username);
		await this.password.fill(password);
		await this.btnLogin.click();
	}

	async getErrorMessage() {
		return this.errorMsg.textContent();
	}
}
