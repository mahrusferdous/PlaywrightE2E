import fs from "node:fs";
import path from "node:path";
import { appLocators } from "../pages/locators";

const OVERRIDES_PATH = path.resolve(__dirname, "../pages/locator-overrides.json");

let overridesCache: Record<string, string> | null = null;
let locatorKeyPathCache: string[] | null = null;

/**
 * Returns all dot-path keys in appLocators that resolve to string selectors.
 */
function collectStringLocatorPaths(value: unknown, prefix = ""): string[] {
	if (typeof value === "string") {
		return prefix ? [prefix] : [];
	}

	if (typeof value !== "object" || value === null) {
		return [];
	}

	const entries = Object.entries(value as Record<string, unknown>);
	const paths: string[] = [];
	for (const [key, child] of entries) {
		const nextPrefix = prefix ? `${prefix}.${key}` : key;
		paths.push(...collectStringLocatorPaths(child, nextPrefix));
	}

	return paths;
}

/**
 * Caches and returns known string locator key paths.
 */
export function getAllStringLocatorKeyPaths(): string[] {
	if (locatorKeyPathCache !== null) {
		return locatorKeyPathCache;
	}

	locatorKeyPathCache = collectStringLocatorPaths(appLocators);
	return locatorKeyPathCache;
}

/**
 * Normalizes key segments for typo-tolerant matching.
 */
function normalizeKeySegment(segment: string): string {
	const underscored = segment
		.replace(/([a-z])([A-Z])/g, "$1_$2")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");

	let singular = underscored;
	if (singular.endsWith("s") && singular.length > 3 && !singular.endsWith("ss")) {
		singular = singular.slice(0, -1);
	}

	return singular.replace(/_/g, "");
}

/**
 * Resolves common typo variants to a known locator key path.
 */
export function resolveLocatorKeyPath(keyPath: string): string {
	try {
		getBaseLocatorValue(keyPath);
		return keyPath;
	} catch {
		// Continue with typo-tolerant matching.
	}

	const parts = keyPath.split(".");
	if (parts.length < 2) {
		return keyPath;
	}

	const scope = normalizeKeySegment(parts[0]);
	const leaf = normalizeKeySegment(parts[parts.length - 1]);
	if (!scope || !leaf) {
		return keyPath;
	}

	for (const candidate of getAllStringLocatorKeyPaths()) {
		const candidateParts = candidate.split(".");
		if (candidateParts.length < 2) {
			continue;
		}

		const candidateScope = normalizeKeySegment(candidateParts[0]);
		const candidateLeaf = normalizeKeySegment(candidateParts[candidateParts.length - 1]);
		if (candidateScope === scope && candidateLeaf === leaf) {
			return candidate;
		}
	}

	return keyPath;
}

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
	const resolvedKeyPath = resolveLocatorKeyPath(keyPath);
	const overrides = loadOverrides();
	const overrideValue = overrides[resolvedKeyPath];
	if (overrideValue) {
		if (resolvedKeyPath !== keyPath) {
			console.warn(
				`[LocatorStore] Auto-corrected locator key path '${keyPath}' -> '${resolvedKeyPath}' from overrides.`,
			);
		}
		return overrideValue;
	}

	const baseValue = getBaseLocatorValue(resolvedKeyPath);
	if (typeof baseValue !== "string") {
		throw new Error(`[LocatorStore] Locator key path is not a string: ${resolvedKeyPath}`);
	}

	if (resolvedKeyPath !== keyPath) {
		console.warn(`[LocatorStore] Auto-corrected locator key path '${keyPath}' -> '${resolvedKeyPath}'.`);
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
	const resolvedKeyPath = resolveLocatorKeyPath(keyPath);
	const baseValue = getBaseLocatorValue(resolvedKeyPath);
	if (typeof baseValue !== "string") {
		throw new Error(`[LocatorStore] Cannot override non-string locator key path: ${resolvedKeyPath}`);
	}

	const overrides = loadOverrides();
	if (selector === baseValue) {
		delete overrides[resolvedKeyPath];
	} else {
		overrides[resolvedKeyPath] = selector;
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
