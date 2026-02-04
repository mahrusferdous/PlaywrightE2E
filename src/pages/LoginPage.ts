import { Page, Locator } from "@playwright/test";

export class LoginPage {
	private page: Page;
	private username: Locator;
	private password: Locator;
	private btnLogin: Locator;
	private errorMsg: Locator;

	constructor(page: Page) {
		this.page = page;
		this.username = page.locator("#user-name");
		this.password = page.locator("#password");
		this.btnLogin = page.locator("#login-button");
		this.errorMsg = page.locator("data-test=error");
	}

	async goto() {
		await this.page.goto("https://www.saucedemo.com/");
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
