# Playwright E2E Automation with AI Locator Self-Healing

This project is a Playwright + TypeScript end-to-end automation framework built around the Page Object Model and an LLM-assisted locator healing layer.

The suite targets SauceDemo and demonstrates how broken selectors can be detected, repaired, validated against the live page, and persisted for later runs. The project is set up so you can intentionally keep broken selectors in `src/pages/locators.ts`, let the healing workflow repair them at runtime, and store the working replacements in `src/pages/locator-overrides.json`.

## Project Overview

At a high level, the project has four main parts:

- `src/pages`: Page Object classes and the base locator map.
- `src/tests`: The Playwright test suite that exercises login, inventory, cart, and checkout flows.
- `src/healing`: The self-healing engine, page-scope detection, prompt construction, override persistence, and project-context lookup.
- `scripts/healUntilStable.js`: The healing runner that reruns failing tests after new locator fixes are saved.

The main execution model looks like this:

1. A test calls a Page Object method such as `login()` or `checkout()`.
2. The Page Object action runs through `withSelfHealingLocator(...)`.
3. If the current selector works, the test continues normally.
4. If the selector fails, the framework tries deterministic repairs, DOM-based candidate discovery, and then LLM-generated candidates.
5. The best validated selector is saved to `src/pages/locator-overrides.json`.
6. The healing runner can rerun the same test to discover and fix the next broken locator until the test becomes stable.

## Project Structure

```text
src/
  healing/
    llmLocatorHealer.ts
    locatorStore.ts
    pageContext.ts
    projectContextReader.ts
    selfHealingLocator.ts
  pages/
    CartPage.ts
    CheckoutPage.ts
    InventoryPage.ts
    LoginPage.ts
    locators.ts
    locator-overrides.json
  tests/
    cart.spec.ts
    checkout.spec.ts
    inventory.spec.ts
    login.spec.ts
scripts/
  healUntilStable.js
playwright.config.ts
```

## Prerequisites

- Node.js 18+
- npm or yarn
- Playwright browsers installed with `npx playwright install`
- Ollama running locally if you want LLM healing enabled

## Installation

Run these commands from the project root:

```bash
npm install
npx playwright install
```

## Environment Setup

The project reads settings from `.env`. Typical values look like this:

```env
E2E_BASE_URL=https://www.saucedemo.com/

AI_HEALING_ENABLED=true
AI_LOCATOR_AUTO_SAVE=true
AI_HEALING_VERBOSE=false
AI_HEALING_LIVE_LLM_LOG=false
AI_HEALING_BASE_URL=http://127.0.0.1:11434
AI_HEALING_MODEL=deepseek-coder:latest
AI_HEALING_USE_PROJECT_CONTEXT=true
AI_HEALING_PROJECT_CONTEXT_DIR=../sample-app-web/src
AI_HEALING_ACTION_TIMEOUT_MS=15000
AI_HEALING_TEST_TIMEOUT_EXTENSION_MS=60000
AI_HEALING_MAX_RERUNS=12

PLAYWRIGHT_TEST_TIMEOUT_MS=90000
PLAYWRIGHT_ACTION_TIMEOUT_MS=0
PLAYWRIGHT_EXPECT_TIMEOUT_MS=10000
```

Important settings:

- `AI_HEALING_ENABLED`: Turns LLM-assisted healing on or off.
- `AI_LOCATOR_AUTO_SAVE`: Persists successful healed selectors to `locator-overrides.json`.
- `AI_HEALING_VERBOSE`: Enables detailed internal healing logs.
- `AI_HEALING_LIVE_LLM_LOG`: Shows LLM request and response activity in real time.
- `AI_HEALING_ACTION_TIMEOUT_MS`: Timeout budget for a single locator action before healing starts.
- `AI_HEALING_TEST_TIMEOUT_EXTENSION_MS`: Extra time added to the current test when healing is triggered.
- `AI_HEALING_MAX_RERUNS`: Max reruns for the healing loop.
- `PLAYWRIGHT_ACTION_TIMEOUT_MS=0`: Lets the healing layer manage action budgets rather than enforcing a global Playwright action timeout.

## How To Run Everything

### Standard healing run

This is the default command and the recommended way to run the suite:

```bash
npm test
```

This uses the healing runner in `scripts/healUntilStable.js`, which will:

1. Run the requested tests.
2. Save any new healed locators.
3. Rerun the tests if new fixes were found.
4. Stop when the test passes or no more useful fixes are discovered.

### Explicit healing run

```bash
npm run test:heal
```

### Raw Playwright run without the healing loop

```bash
npm run test:raw
```

### Headed run

```bash
npm run test:headed
```

### HTML report

```bash
npm run test:report
```

### Run a single test or filtered test

```bash
npm test -- src/tests/checkout.spec.ts
```

```bash
npm run test:heal -- -g "Valid Login"
```

### Run with one worker for easier healing observation

```bash
npx playwright test --workers=1
```

```bash
npx playwright test -g "Checkout Flow" --workers=1
```

## How Locator Storage Works

The framework separates original locator definitions from healed replacements:

- Base locators live in `src/pages/locators.ts`
- Healed overrides live in `src/pages/locator-overrides.json`

At runtime, the locator store checks overrides first. If an override exists, it is used instead of the base locator. This lets you keep intentionally broken or outdated selectors in the base file for demonstration or experimentation, while still allowing successful test execution through the override layer.

## How The Healing Flow Works

When a locator action fails, `withSelfHealingLocator(...)` performs the following steps:

1. It detects whether the failure looks like a locator problem.
2. It extends the current test timeout so repair work has enough time to finish.
3. It tries direct repairs such as removing `_broken` or `-broken`.
4. It inspects the live DOM to generate stable selector candidates from attributes, visible text, and structural clues.
5. It collects page scope, URL, title, visible text, and focused HTML snippets.
6. It optionally enriches the prompt with source-code hints from the target application.
7. It asks the LLM for selector candidates.
8. It validates candidates against the actual page and saves the first selector that really works.

This layered design matters because not every failure needs an LLM call. Straightforward breakages are often fixed by deterministic repairs or DOM inspection first, which makes healing faster and more reliable.

## LLM Healing In Detail

The LLM portion is implemented mainly in `src/healing/llmLocatorHealer.ts`.

### What context is sent to the model

The prompt is intentionally constrained and includes:

- The locator key path such as `checkout.finishButton`
- The failed selector
- The expected page scope
- The detected current page scope
- The current URL and page title
- The original error message
- A visible-text snapshot from the page
- A focused DOM snippet around relevant selector tokens
- Optional source-code hints gathered from the application under test

This keeps the model grounded in both the current UI and the project source.

### What the model is asked to return

The model is instructed to return compact JSON only:

```json
{"selectors":["selector1","selector2","selector3"]}
```

The healing layer rejects prose-like answers and can automatically retry with a stricter repair prompt if the model responds with explanations instead of selectors.

### Why the LLM output is still validated

The model never writes a selector directly into the project without verification. Every candidate is validated against the live page before it is accepted. This protects the framework from:

- Hallucinated selectors
- Wrong elements with similar names
- Overly broad selectors
- Prose or malformed responses

Only a candidate that resolves on the page and passes the framework's intent checks is saved.

### What happens if the model is unavailable

If Ollama is down, the model errors out, or the response is unusable, the framework does not crash the entire healing path immediately. Deterministic repairs and DOM-based discovery still run first, and LLM errors are logged while the test either recovers or fails normally.

### Project-context enrichment

If `AI_HEALING_USE_PROJECT_CONTEXT=true`, the framework reads matching lines from the target app source directory and includes them in the prompt. This is useful when stable identifiers exist in the source code but are not obvious from the limited DOM snapshot alone.

## Timeout Strategy

The project uses a healing-aware timeout model:

- Playwright's global action timeout defaults to `0`
- The healing layer applies its own per-action timeout budget
- The current test timeout is extended when healing starts

This prevents a single broken locator from consuming the full test budget before the repair logic gets a chance to run.

## Docker

```bash
docker build -t playwright-ts -f docker/Dockerfile .
docker run playwright-ts
```
