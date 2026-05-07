# MCP Server (AI healing)

Quick start:

1. Install dependencies (uses yarn or npm):

```bash
yarn install
# or
npm install
```

2. Start the local MCP server (it launches a Playwright browser):

```bash
yarn mcp:start
# or
npm run mcp:start
```

3. Endpoints:

- `POST /navigate` JSON body `{ "url": "https://example.com" }` — navigates the internal page.
- `POST /login` JSON body `{ "url": "https://www.saucedemo.com/" }` — opens SauceDemo, logs in with `SAUCE_USERNAME` and `SAUCE_PASSWORD`, and leaves the browser authenticated.
- `POST /heal-locator` JSON body `{ "keyPath": "login.loginButton", "failedSelector": "#login-btn", "pageHtmlSnippet": "...", "uiTextSnippet": "..." }` — heals from the live page snapshot already captured by Playwright. Snapshot fields are required.
- `POST /heal-locator` can also accept `currentPage`, `currentPageReason`, `currentUrl`, `pageTitle`, and `errorMessage` to improve prompt quality.
- `POST /scan-locators` JSON body `{ "url": "https://www.saucedemo.com/" }` — logs in and runs the healing flow across every string locator key path, returning a list of resolved selectors and whether each one healed.

Notes:

- The server uses the existing healing logic in `src/healing` and writes overrides to `src/pages/locator-overrides.json` when a healed selector is persisted.
- Ensure `AI_HEALING_ENABLED=true` (the npm script sets this) and an Ollama-compatible local LLM is reachable if you want LLM-driven suggestions.

Automated test rerun (until stable):

You can run the repository's automated healing loop which reruns Playwright tests until they pass or no new fixes are produced. This uses `scripts/healUntilStable.js` and will persist locator overrides.

```bash
# default: will run up to 12 reruns
yarn test
# or, to run playwright directly without the rerun loop:
yarn test:raw
```

Environment variables that affect healing:

- `AI_HEALING_ENABLED` (true/false) — enables the LLM & healing flow.
- `AI_HEALING_BASE_URL` — URL for Ollama-compatible LLM (default `http://127.0.0.1:11434`).
- `AI_HEALING_MODEL` — model name to request from the LLM (default `deepseek-coder:latest`).
- `AI_HEALING_VERBOSE` and `AI_HEALING_LIVE_LLM_LOG` — enable extra logs.
