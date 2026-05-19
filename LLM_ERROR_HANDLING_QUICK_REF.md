# LLM Error Handling - Quick Reference

## 🔧 Changes Made

### File: `src/healing/llmLocatorHealer.ts`

**3 Error Handling Improvements:**

1. **Lines 687-694**: Added try-catch for non-stream fallback when streaming fails
    - Catches `nonStreamError` and logs it before throwing
    - Prevents silent failure of the fallback mechanism

2. **Lines 706-718**: Added try-catch for repair prompt retry
    - Catches repair prompt errors and logs them
    - Falls back to deterministic selectors instead of crashing
    - Uses existing `generateFallbackSelectors()` logic

3. **Lines 747-758**: Enhanced error context in `requestSelectorCandidates`
    - Extracts error message and stack trace
    - Logs keyPath and selector context
    - Improved console warning with specific keyPath information

---

### File: `src/healing/selfHealingLocator.ts`

**5 Error Handling Improvements:**

1. **Lines 1014-1024**: Wrapped `captureFailureContext` in try-catch
    - Logs capture errors without aborting healing
    - Returns null gracefully if capture fails

2. **Lines 1031-1043**: Wrapped `generateDirectRepairCandidates` in try-catch
    - Skips direct repair if generation fails
    - Continues to DOM/project/LLM candidate sources

3. **Lines 1045-1067**: Wrapped `collectDomSelectorCandidates` in try-catch
    - Logs DOM collection errors
    - Falls back to project/LLM candidates if DOM collection fails

4. **Lines 1069-1092**: Wrapped `getProjectSelectorCandidates` in try-catch
    - Logs project candidate retrieval errors
    - Continues to LLM candidates if project retrieval fails

5. **Lines 1094-1115**: Wrapped `requestSelectorCandidates` in try-catch
    - Logs LLM request errors with keyPath and selector
    - Returns empty array and continues with DOM/project candidates
    - Added `liveLog` for user visibility of LLM failures

6. **Lines 1266-1297**: Enhanced error context when healed selector fails
    - Captures both original and healed error messages
    - Logs error stack traces for debugging
    - Improved console error message showing both attempts
    - Added `originalSelector` vs `healedSelector` comparison logging

---

## 📊 Impact Summary

| Scenario                           | Before                          | After                                 |
| ---------------------------------- | ------------------------------- | ------------------------------------- |
| Streaming fails + non-stream fails | Crash with unhandled error      | Logged error, propagated cleanly      |
| Repair prompt fails                | Silent failure, empty selectors | Logged error, uses fallback selectors |
| DOM collection fails               | Abort healing                   | Log error, try project/LLM candidates |
| LLM timeout/failure                | Abort healing                   | Log error, continue with DOM/project  |
| Healed selector fails              | Generic error                   | Detailed comparison of both errors    |

---

## ✅ Testing Checklist

- [ ] LLM service unavailable → Healing uses fallback selectors
- [ ] Streaming timeout → Fallback to non-stream succeeds
- [ ] Repair prompt timeout → Uses deterministic fallbacks
- [ ] Page snapshot fails → Healing continues with available candidates
- [ ] Healed selector fails → Both error contexts logged clearly
- [ ] LLM service slow → Timeout caught and handled gracefully
- [ ] Invalid JSON from LLM → Repair prompt catches it

---

## 🔍 Logging Improvements

### New Log Fields:

- `keyPath`: Which locator is being healed
- `selector`: The original/healed selector being attempted
- `error`: Human-readable error message
- `stack`: Full error stack trace (when available)
- `originalError` vs `healedError`: Compare both attempts
- `originalSelector` vs `healedSelector`: See what was tried

### Log Levels:

- **verboseLog**: Detailed debugging info (when `AI_HEALING_VERBOSE=true`)
- **liveLog**: User-visible healing progress (when `AI_HEALING_LIVE_LLM_LOG=true`)
- **console.warn**: Non-blocking failures
- **console.error**: Critical failures in healed selectors

---

## 📝 Configuration Environment Variables

These logs respect existing env vars:

- `AI_HEALING_ENABLED=true/false` - Enable/disable healing
- `AI_HEALING_VERBOSE=true/false` - Verbose logging
- `AI_HEALING_LIVE_LLM_LOG=true/false` - Live LLM communication logs

---

## 🎯 Key Design Decisions

1. **Fail gracefully, not loudly**: Errors in helper functions don't crash the main flow
2. **Try deterministic first**: Direct repair → DOM → Project → LLM
3. **LLM is optional**: Healing works without LLM using DOM/project candidates
4. **Rich error context**: Every failure logs enough info to debug
5. **Backward compatible**: No API changes, only internal error handling

---

## 📚 Related Files

- `src/healing/llmLocatorHealer.ts` - LLM communication and request handling
- `src/healing/selfHealingLocator.ts` - Main healing orchestration
- `src/healing/pageContext.ts` - Page detection helpers
- `src/healing/locatorStore.ts` - Selector storage/override management
- `src/healing/projectContextReader.ts` - Project selector mining
