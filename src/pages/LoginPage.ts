import { Page, Locator } from "@playwright/test";

export class LoginPage {
	private page: Page;
	private usernameInput: Locator;
	private passwordInput: Locator;
	private submitBtn: Locator;

	constructor(page: Page) {
		this.page = page;
		this.usernameInput = page.locator("#user-name");
		this.passwordInput = page.locator("#password");
		this.submitBtn = page.locator("#login-button");
	}

	async login(username: string, password: string): Promise<void> {
		await this.usernameInput.fill(username);
		await this.passwordInput.fill(password);
		await this.submitBtn.click();

		// Wait until inventory page loads
		await this.page.waitForSelector(".inventory_list");
	}
}
