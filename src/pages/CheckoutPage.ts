import { Page, Locator } from "@playwright/test";
import { appLocators } from "./locators";

export class CheckoutPage {
	private page: Page;
	private firstName: Locator;
	private lastName: Locator;
	private postalCode: Locator;
	private continueBtn: Locator;
	private finishBtn: Locator;

	constructor(page: Page) {
		this.page = page;
		this.firstName = page.locator(appLocators.checkout.firstName);
		this.lastName = page.locator(appLocators.checkout.lastName);
		this.postalCode = page.locator(appLocators.checkout.postalCode);
		this.continueBtn = page.locator(appLocators.checkout.continueButton);
		this.finishBtn = page.locator(appLocators.checkout.finishButton);
	}

	async fillCheckoutForm(first: string, last: string, zip: string) {
		await this.firstName.fill(first);
		await this.lastName.fill(last);
		await this.postalCode.fill(zip);
		await this.continueBtn.click();
	}

	async finishOrder() {
		await this.finishBtn.click();
	}

	async backHome() {
		await this.page.locator(appLocators.checkout.backToProductsButton).click();
	}
}
