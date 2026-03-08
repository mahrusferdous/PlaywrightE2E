import fs from "node:fs";
import path from "node:path";
import { appLocators } from "../pages/locators";

const OVERRIDES_PATH = path.resolve(process.cwd(), "src/pages/locator-overrides.json");

let overridesCache: Record<string, string> | null = null;

/**
 * Loads locator overrides from disk and caches them in memory.
 *
 * @returns The current in-memory override map.
 */
function loadOverrides(): Record<string, string> {
	if (overridesCache !== null) {
		return overridesCache;
	}

	if (!fs.existsSync(OVERRIDES_PATH)) {
		overridesCache = {};
		return overridesCache;
	}

	try {
		const raw = fs.readFileSync(OVERRIDES_PATH, "utf-8");
		const parsed = JSON.parse(raw) as Record<string, string>;
		overridesCache = parsed;
		return overridesCache;
	} catch {
		overridesCache = {};
		return overridesCache;
	}
}

/**
 * Persists locator overrides to disk.
 *
 * @param overrides The overrides map to write to JSON file.
 */
function persistOverrides(overrides: Record<string, string>) {
	fs.writeFileSync(OVERRIDES_PATH, `${JSON.stringify(overrides, null, 2)}\n`, "utf-8");
}

/**
 * Resolves a locator value from base locator config by dot path.
 *
 * @param keyPath Dot path such as `login.username`.
 * @returns The raw locator value.
 */
function getBaseLocatorValue(keyPath: string): unknown {
	return keyPath.split(".").reduce<unknown>((current, key) => {
		if (typeof current === "object" && current !== null && key in current) {
			return (current as Record<string, unknown>)[key];
		}

		throw new Error(`[LocatorStore] Unknown locator key path: ${keyPath}`);
	}, appLocators as unknown);
}

/**
 * Gets the active locator for a key path, preferring overrides.
 *
 * @param keyPath Dot path such as `login.username`.
 * @returns The effective selector string.
 */
export function getLocatorValue(keyPath: string): string {
	const overrides = loadOverrides();
	const overrideValue = overrides[keyPath];
	if (overrideValue) {
		return overrideValue;
	}

	const baseValue = getBaseLocatorValue(keyPath);
	if (typeof baseValue !== "string") {
		throw new Error(`[LocatorStore] Locator key path is not a string: ${keyPath}`);
	}

	return baseValue;
}

/**
 * Sets a locator override for the given key path.
 *
 * If selector equals the base value, the override is removed.
 *
 * @param keyPath Dot path such as `login.username`.
 * @param selector The selector to persist as override.
 */
export function setLocatorValue(keyPath: string, selector: string) {
	const baseValue = getBaseLocatorValue(keyPath);
	if (typeof baseValue !== "string") {
		throw new Error(`[LocatorStore] Cannot override non-string locator key path: ${keyPath}`);
	}

	const overrides = loadOverrides();
	if (selector === baseValue) {
		delete overrides[keyPath];
	} else {
		overrides[keyPath] = selector;
	}

	const autoSave = process.env.AI_LOCATOR_AUTO_SAVE !== "false";
	if (autoSave) {
		persistOverrides(overrides);
	}
}

/**
 * Returns absolute path to locator override JSON file.
 */
export function getLocatorOverridesPath() {
	return OVERRIDES_PATH;
}
