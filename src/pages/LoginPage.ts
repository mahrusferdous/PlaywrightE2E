import { Page } from "@playwright/test";
import { appLocators } from "./locators";
import { withSelfHealingLocator } from "../healing/selfHealingLocator";

export class LoginPage {
	private page: Page;

	/**
	 * Initializes the LoginPage with the given Playwright Page object.
	 *
	 * @param page The Playwright Page object to interact with the login page.
	 */
	constructor(page: Page) {
		this.page = page;
	}

	/**
	 * Navigates to the login page using the base URL defined in the locators.
	 *
	 * @returns A promise that resolves when the navigation is complete.
	 */
	async goto() {
		await this.page.goto(appLocators.app.baseUrl);
	}

	/**
	 * Logs in to the application with the given username and password.
	 *
	 * @param username The username to use for login.
	 * @param password The password to use for login.
	 * @returns A promise that resolves when the login process is complete.
	 */
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

	/**
	 * Retrieves the error message displayed on the login page, if any.
	 * @returns A promise that resolves to the error message text, or null if no error message is present.
	 */
	async getErrorMessage() {
		return withSelfHealingLocator(this.page, "login.errorMessage", (locator) => locator.textContent(), {
			description: "Login error message",
			requireVisible: false,
		});
	}
}
