import { Page } from "@playwright/test";
import { appLocators } from "./locators";
import { withSelfHealingLocator } from "../healing/selfHealingLocator";

/**
 * Encapsulates checkout form, overview, and completion screen interactions.
 */
export class CheckoutPage {
	private page: Page;

	/**
	 * Initializes the CheckoutPage with the given Playwright Page object.
	 *
	 * @param page The Playwright Page object used to interact with checkout UI.
	 */
	constructor(page: Page) {
		this.page = page;
	}

	/**
	 * Fills the checkout form and continues to order summary.
	 *
	 * @param first The customer's first name.
	 * @param last The customer's last name.
	 * @param zip The customer's postal code.
	 * @returns A promise that resolves when form submission is complete.
	 */
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

	/**
	 * Finishes the order on the checkout summary screen.
	 *
	 * @returns A promise that resolves when order completion is triggered.
	 */
	async finishOrder() {
		await withSelfHealingLocator(this.page, "checkout.finishButton", (locator) => locator.click(), {
			description: "Checkout finish button",
		});
	}

	/**
	 * Navigates back to the inventory page from the checkout complete screen.
	 *
	 * @returns A promise that resolves when navigation action is complete.
	 */
	async backHome() {
		await withSelfHealingLocator(this.page, "checkout.backToProductsButton", (locator) => locator.click(), {
			description: "Back to products button",
		});
	}

	/**
	 * Returns the order completion header text.
	 *
	 * @returns A promise that resolves to completion header text or null.
	 */
	async getCompleteHeaderText() {
		return withSelfHealingLocator(this.page, "checkout.completeHeader", (locator) => locator.textContent(), {
			description: "Checkout complete header",
			requireVisible: false,
		});
	}

	/**
	 * Returns the order completion body text.
	 *
	 * @returns A promise that resolves to completion body text or null.
	 */
	async getCompleteText() {
		return withSelfHealingLocator(this.page, "checkout.completeText", (locator) => locator.textContent(), {
			description: "Checkout complete text",
			requireVisible: false,
		});
	}
}
