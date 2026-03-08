# Playwright E2E Automation (with AI Locator Self-Healing)

This project runs Playwright + TypeScript tests with Page Objects and includes an **AI-powered self-healing locator layer**.

When a selector fails:

1. The framework asks an LLM for replacement selectors.
2. It validates candidates against the current page DOM.
3. It auto-saves the winning selector to `src/pages/locator-overrides.json`.
4. If LLM output is noisy/non-JSON, the framework applies deterministic fallback candidates (for example removing `-broken`/`_broken`) before failing.

## Prerequisites

- Node.js 18+
- npm or yarn
- Playwright browsers (`npx playwright install`)

## Install

```bash
npm install
npx playwright install
```

## AI Self-Healing Setup (Local Ollama)

1. Make sure Ollama is running and your model exists:

```bash
ollama list
```

2. Keep `.env` on Ollama defaults:

```env
AI_HEALING_BASE_URL=http://127.0.0.1:11434
AI_HEALING_MODEL=deepseek-coder:latest
AI_HEALING_VERBOSE=false
AI_HEALING_LIVE_LLM_LOG=false
AI_HEALING_USE_PROJECT_CONTEXT=true
AI_HEALING_PROJECT_CONTEXT_DIR=../sample-app-web/src
```

To see detailed healing activity in terminal logs, set:

```env
AI_HEALING_VERBOSE=true
```

To see live request/response communication with Ollama while healing is happening, set:

```env
AI_HEALING_LIVE_LLM_LOG=true
```

When this is enabled, console logs also show whether LLM healing was triggered or skipped (for example when the current selector already works from `locator-overrides.json`).

`AI_HEALING_USE_PROJECT_CONTEXT=true` lets healing read source hints from `sample-app-web` (or any path set in `AI_HEALING_PROJECT_CONTEXT_DIR`) and combine them with the live DOM before asking Ollama.

## Run Tests

Run commands from the `Playwright E2E` folder.

```bash
npm run test
```

Headed mode:

```bash
npm run test:headed
```

Open report:

```bash
npm run test:report
```

To see healing in action, run with a single worker:

```bash
npx playwright test --workers=1
```

```bash
npx playwright test -g "Cart Flow" --workers=1
```

## How locator updates are persisted

- Base locators: `src/pages/locators.ts`
- Auto-healed overrides: `src/pages/locator-overrides.json`

Set `AI_LOCATOR_AUTO_SAVE=false` if you want healing without file writes.

## Docker (optional)

```bash
docker build -t playwright-ts -f docker/Dockerfile .
docker run playwright-ts
```
