import { Page } from "@playwright/test";
import { appLocators } from "./locators";
import { withSelfHealingLocator } from "../healing/selfHealingLocator";

export class LoginPage {
	private page: Page;

	constructor(page: Page) {
		this.page = page;
	}

	async goto() {
		await this.page.goto(appLocators.app.baseUrl);
	}

	async login(username: string, password: string) {
		await withSelfHealingLocator(this.page, "login.username", (locator) => locator.fill(username), {
			description: "Login username field",
		});
		await withSelfHealingLocator(this.page, "login.password", (locator) => locator.fill(password), {
			description: "Login password field",
		});
		await withSelfHealingLocator(this.page, "login.loginButton", (locator) => locator.click(), {
			description: "Login button",
		});
	}

	async getErrorMessage() {
		return withSelfHealingLocator(this.page, "login.errorMessage", (locator) => locator.textContent(), {
			description: "Login error message",
			requireVisible: false,
		});
	}
}
