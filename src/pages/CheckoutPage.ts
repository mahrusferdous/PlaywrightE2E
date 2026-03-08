import { Page } from "@playwright/test";
import { appLocators } from "./locators";
import { withSelfHealingLocator } from "../healing/selfHealingLocator";

export class CheckoutPage {
	private page: Page;

	constructor(page: Page) {
		this.page = page;
	}

	async fillCheckoutForm(first: string, last: string, zip: string) {
		await withSelfHealingLocator(this.page, "checkout.firstName", (locator) => locator.fill(first), {
			description: "Checkout first name",
		});
		await withSelfHealingLocator(this.page, "checkout.lastName", (locator) => locator.fill(last), {
			description: "Checkout last name",
		});
		await withSelfHealingLocator(this.page, "checkout.postalCode", (locator) => locator.fill(zip), {
			description: "Checkout postal code",
		});
		await withSelfHealingLocator(this.page, "checkout.continueButton", (locator) => locator.click(), {
			description: "Checkout continue button",
		});
	}

	async finishOrder() {
		await withSelfHealingLocator(this.page, "checkout.finishButton", (locator) => locator.click(), {
			description: "Checkout finish button",
		});
	}

	async backHome() {
		await withSelfHealingLocator(this.page, "checkout.backToProductsButton", (locator) => locator.click(), {
			description: "Back to products button",
		});
	}

	async getCompleteHeaderText() {
		return withSelfHealingLocator(this.page, "checkout.completeHeader", (locator) => locator.textContent(), {
			description: "Checkout complete header",
			requireVisible: false,
		});
	}

	async getCompleteText() {
		return withSelfHealingLocator(this.page, "checkout.completeText", (locator) => locator.textContent(), {
			description: "Checkout complete text",
			requireVisible: false,
		});
	}
}
