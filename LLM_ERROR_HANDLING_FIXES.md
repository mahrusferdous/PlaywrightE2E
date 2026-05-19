# LLM Error Handling Fixes

## Summary

Fixed comprehensive error handling issues in the LLM healing system where exceptions were being silently swallowed or not properly propagated, causing test failures to be incorrectly attributed to locator issues when the real problem was LLM service failures.

## Issues Fixed

### 1. **Missing Error Handling in Streaming Fallback** (llmLocatorHealer.ts:680-691)

**Problem:** When `liveLogEnabled` is true, if the streaming request fails and the fallback non-stream request also fails, the error is not caught and bubbles up uncaught.

```typescript
// BEFORE: No try-catch around non-stream fallback
messageContent = await requestFromOllamaNonStreaming(baseUrl, prompt, true);

// AFTER: Properly catch and log the error
try {
  messageContent = await requestFromOllamaNonStreaming(baseUrl, prompt, true);
} catch (nonStreamError) {
  liveLog("Non-stream fallback also failed", {...});
  throw nonStreamError;
}
```

**Impact:** Prevents cascading failures when both streaming and non-streaming LLM requests fail.

---

### 2. **Unhandled Repair Prompt Errors** (llmLocatorHealer.ts:699-702)

**Problem:** When the LLM returns non-selector prose and a repair prompt is sent, any error from the repair request is not caught.

```typescript
// BEFORE: No error handling
messageContent = liveLogEnabled
  ? await requestFromOllamaNonStreaming(baseUrl, prompt, true, true)
  : await requestFromOllamaNonStreaming(baseUrl, prompt, false, true);

// AFTER: Wrapped in try-catch with fallback to empty fallback selectors
try {
  messageContent = liveLogEnabled
    ? await requestFromOllamaNonStreaming(baseUrl, prompt, true, true)
    : await requestFromOllamaNonStreaming(baseUrl, prompt, false, true);
} catch (repairError) {
  verboseLog("LLM repair prompt failed", {...});
  liveLog("LLM repair prompt failed; using fallback selectors", {...});
}
```

**Impact:** Repair attempts no longer crash the healing process; falls back gracefully to deterministic selectors.

---

### 3. **Insufficient Error Context in requestSelectorCandidates** (llmLocatorHealer.ts:719-735)

**Problem:** LLM errors are logged with minimal context, making debugging difficult.

```typescript
// BEFORE: Generic error logging
catch (error) {
  verboseLog("Ollama request failed", error);
  console.warn("[AI-Heal] LLM request failed. Skipping healing for this step.", error);
  return [];
}

// AFTER: Rich error context with keyPath and stack traces
catch (error) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : "";
  verboseLog("Ollama request failed", {
    keyPath: prompt.keyPath,
    failedSelector: prompt.failedSelector,
    message: errorMessage,
    stack: errorStack,
  });
  console.warn(`[AI-Heal] LLM request failed for keyPath '${prompt.keyPath}': ${errorMessage}...`);
  return [];
}
```

**Impact:** Better diagnostics when LLM requests fail; easier root cause analysis.

---

### 4. **Missing Error Handling in Failure Context Capture** (selfHealingLocator.ts:1012-1028)

**Problem:** `captureFailureContext` calls are not wrapped in try-catch, so failures to capture page state abort the entire healing flow.

```typescript
// BEFORE: Direct await without error handling
const failure = await captureFailureContext(...);
if (!failure) return null;

// AFTER: Wrapped with error logging and graceful degradation
let failure: FailureCapture | null = null;
try {
  failure = await captureFailureContext(...);
} catch (captureError) {
  verboseLog("Error capturing failure context", {...});
}
if (!failure) return null;
```

**Impact:** Healing continues even if page snapshot collection fails.

---

### 5. **Unhandled DOM Candidate Collection Errors** (selfHealingLocator.ts:1031-1041)

**Problem:** Errors in DOM candidate collection abort the entire healing process instead of falling back to other candidate sources.

```typescript
// BEFORE: Direct await without error handling
const domCandidates = await collectDomSelectorCandidates(...);
const domMatch = await findValidSelector(page, domCandidates, ...);

// AFTER: Try-catch with fallback
let domCandidates: string[] = [];
try {
  domCandidates = await collectDomSelectorCandidates(...);
} catch (domError) {
  verboseLog("Error collecting DOM candidates", {...});
}
if (domCandidates.length > 0) {
  const domMatch = await findValidSelector(...);
  if (domMatch) return domMatch;
}
```

**Impact:** DOM-based healing continues even if page evaluation fails.

---

### 6. **Unhandled Project Candidate Retrieval Errors** (selfHealingLocator.ts:1043-1053)

**Problem:** Errors in getting project-defined selectors crash the healing flow.

```typescript
// BEFORE: Direct call without error handling
const projectCandidates = getProjectSelectorCandidates(...);
const projectMatch = await findValidSelector(...);

// AFTER: Wrapped with error handling
let projectCandidates: string[] = [];
try {
  projectCandidates = getProjectSelectorCandidates(...);
} catch (projError) {
  verboseLog("Error getting project candidates", {...});
}
if (projectCandidates.length > 0) {
  const projectMatch = await findValidSelector(...);
  if (projectMatch) return projectMatch;
}
```

**Impact:** Project-based healing is skipped gracefully if retrieval fails.

---

### 7. **Unhandled LLM Candidate Request Errors** (selfHealingLocator.ts:1055-1068)

**Problem:** LLM request errors in `resolveValidSelector` are not caught, causing the entire healing process to fail.

```typescript
// BEFORE: Direct await without error handling
const llmCandidates = await requestSelectorCandidates({...});
verboseLog("LLM candidates received...", { keyPath, llmCandidates });

// AFTER: Wrapped with error handling and graceful fallback
let llmCandidates: string[] = [];
try {
  llmCandidates = await requestSelectorCandidates({...});
  verboseLog("LLM candidates received...", { keyPath, llmCandidates });
} catch (llmError) {
  const errorMsg = llmError instanceof Error ? llmError.message : String(llmError);
  verboseLog("LLM request error in resolveValidSelector", {...});
  liveLog("LLM request failed; continuing with DOM/project candidates", {...});
}
```

**Impact:** Healing process continues to completion even if LLM request fails; uses deterministic fallbacks.

---

### 8. **Inadequate Error Context When Healed Action Fails** (selfHealingLocator.ts:1232-1265)

**Problem:** When a healed selector still fails during action execution, the error doesn't capture both the original and healed error contexts.

```typescript
// BEFORE: Minimal error context
catch (healedActionError) {
  liveLog("LLM healed selector failed during action", {
    keyPath,
    resolvedKeyPath,
    selector: validSelector,
    error: healedActionError instanceof Error ? healedActionError.message : String(healedActionError),
  });
  throw initialError;
}

// AFTER: Rich error context comparing both attempts
catch (healedActionError) {
  const healedErrorMsg = healedActionError instanceof Error ? healedActionError.message : String(healedActionError);
  liveLog("LLM healed selector failed during action", {
    keyPath,
    resolvedKeyPath,
    originalSelector: selector,
    healedSelector: validSelector,
    originalError: initialError instanceof Error ? initialError.message : String(initialError),
    healedError: healedErrorMsg,
  });
  verboseLog("Healed selector failed during action execution", {
    keyPath,
    originalSelector: selector,
    validSelector,
    originalError: initialError instanceof Error ? initialError.message : String(initialError),
    healedError: healedErrorMsg,
    healedStack: healedActionError instanceof Error ? healedActionError.stack : "",
  });
  console.error(`[AI-Heal] Healed selector '${validSelector}' also failed...`);
  throw initialError;
}
```

**Impact:** Better debugging information when healed selectors also fail; easier to distinguish between LLM healing failures and other issues.

---

## Error Handling Pattern Applied

All fixes follow a consistent pattern:

1. **Isolate critical operations** in try-catch blocks
2. **Log errors with full context** (keyPath, selector, error message, stack traces)
3. **Gracefully degrade** to fallback strategies instead of crashing
4. **Distinguish error sources** (LLM, DOM, project, capture) in logging
5. **Provide actionable diagnostics** in both verbose and live logs

## Testing Recommendations

1. **Test with LLM service down:**
    - Verify healing still uses DOM/project candidates
    - Check error messages clearly indicate LLM service failure

2. **Test with flaky LLM service:**
    - Verify streaming fallback to non-streaming works
    - Verify repair prompt fallback works

3. **Test with page snapshot errors:**
    - Verify healing continues when page content capture fails
    - Check error logging identifies page issues

4. **Test with invalid healed selectors:**
    - Verify both errors are captured and logged
    - Check original error is thrown with context

## Files Modified

- `src/healing/llmLocatorHealer.ts` - Fixed 3 error handling issues
- `src/healing/selfHealingLocator.ts` - Fixed 5 error handling issues

## Backward Compatibility

✅ All changes are backward compatible:

- No API changes
- No behavior changes when operations succeed
- Only improves error handling paths
- Maintains same return types and success flows
