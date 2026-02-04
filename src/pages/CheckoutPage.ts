import { Page, Locator } from "@playwright/test";

export class CheckoutPage {
	private page: Page;
	private firstName: Locator;
	private lastName: Locator;
	private postalCode: Locator;
	private continueBtn: Locator;
	private finishBtn: Locator;

	constructor(page: Page) {
		this.page = page;
		this.firstName = page.locator("#first-name");
		this.lastName = page.locator("#last-name");
		this.postalCode = page.locator("#postal-code");
		this.continueBtn = page.locator("#continue");
		this.finishBtn = page.locator("#finish");
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
		await this.page.locator("#back-to-products").click();
	}
}
