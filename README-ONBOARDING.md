# Playwright E2E Onboarding Guide

This guide explains what this project is, how to run it, and how the AI locator self-healing works.

## What this project does

- Runs end-to-end UI tests with Playwright and TypeScript.
- Uses a Page Object Model structure under `src/pages`.
- Adds an AI healing layer that can recover from broken selectors during test execution.

Main test location:

- `src/tests`

Main healing modules:

- `src/healing/selfHealingLocator.ts`
- `src/healing/llmLocatorHealer.ts`
- `src/healing/locatorStore.ts`

## Prerequisites

- Node.js 18+
- npm (or yarn)
- Playwright browsers
- Ollama running locally (for AI healing)

## Install

From the `Playwright E2E` folder:

```bash
npm install
npx playwright install
```

## Required environment setup

Configure `.env` (typical defaults):

```env
AI_HEALING_ENABLED=true
AI_HEALING_BASE_URL=http://127.0.0.1:11434
AI_HEALING_MODEL=deepseek-coder:latest
AI_HEALING_VERBOSE=false
AI_HEALING_LIVE_LLM_LOG=false
AI_HEALING_USE_PROJECT_CONTEXT=true
AI_HEALING_PROJECT_CONTEXT_DIR=../sample-app-web/src
```

Optional timeout tuning:

```env
PLAYWRIGHT_TEST_TIMEOUT_MS=90000
PLAYWRIGHT_ACTION_TIMEOUT_MS=15000
PLAYWRIGHT_EXPECT_TIMEOUT_MS=10000
```

## How to run tests

Run all tests:

```bash
npm run test
```

Run tests with automatic reruns until healing stabilizes:

```bash
npm run test:heal
```

Run a filtered test through healing runner:

```bash
npm run test:heal -- -g "Checkout Flow" --workers=1
```

Run in headed mode:

```bash
npm run test:headed
```

Open HTML report:

```bash
npm run test:report
```

## How the self-healing works

When a locator action fails, the flow is:

1. **Initial action fails** for a selector from `src/pages/locators.ts` (or current override).
2. **Context is collected** from the current page (URL, title, DOM snippet).
3. **LLM is queried** via Ollama (`/api/chat`) for replacement selector candidates.
4. **Fallback candidates are generated** deterministically (for example removing `-broken`/`_broken`).
5. **Candidates are validated** in the live page DOM (count/visibility/intent checks).
6. **Best selector is applied** and the action is retried.
7. **Successful selector is persisted** to `src/pages/locator-overrides.json`.

If the page is already closed or timing out, healing now safely skips snapshot collection instead of crashing.

## Locator persistence model

- Base locator definitions: `src/pages/locators.ts`
- Healed overrides: `src/pages/locator-overrides.json`

At runtime, overrides take precedence over base locators.

Disable writing overrides if needed:

```env
AI_LOCATOR_AUTO_SAVE=false
```

## Useful debugging flags

Verbose healing logs:

```env
AI_HEALING_VERBOSE=true
```

Live LLM request/response logs:

```env
AI_HEALING_LIVE_LLM_LOG=true
```

Limit rerun attempts for `test:heal`:

```env
AI_HEALING_MAX_RERUNS=6
```

## Typical workflow

1. Run `npm run test:heal -- --workers=1`.
2. Let failing selectors auto-heal and persist.
3. Re-run `npm run test` to confirm stability.
4. Review `src/pages/locator-overrides.json` before committing changes.

## Troubleshooting

- **"No tests found"**: ensure command is run from the `Playwright E2E` folder.
- **LLM healing not triggering**: check `AI_HEALING_ENABLED=true` and Ollama availability.
- **Slow/failing tests**: increase `PLAYWRIGHT_TEST_TIMEOUT_MS`.
- **Noisy LLM responses**: fallback selector generation still attempts deterministic fixes.
