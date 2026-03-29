# Known Issues

## Icon Rendering in RUN COMPANION Panel

**Status**: Open
**Date Reported**: 2026-03-29
**Severity**: Medium (Visual/UX issue)

### Issue Description

The RUN COMPANION panel (actor inspector on the RUN screen) displays gray broken image boxes instead of unicode glyph fallbacks for type, affinity, expression, and motivation icons.

### Expected Behavior

When resource bundle has missing or invalid `dataUri` values:
- Should display legacy unicode glyphs (⚔️ 🔥 ⬆️ ⬇️ 📡 🎲 🧱 🧭 etc.)
- Should NOT show gray broken image boxes

### Actual Behavior

- Gray broken image boxes appear in place of icons
- Occurs in multiple browsers (Chrome, Firefox, Safari tested)
- Test page (`packages/ui-web/icon-test.html`) shows correct behavior with glyphs
- Main UI does not show glyphs despite identical code

### Investigation Summary

1. **Code is correct**: `icon-resolver.js` includes validation via `isValidDataUri()`
2. **Tests pass**: All 138 UI tests pass including validation scenarios
3. **Test page works**: Standalone test page correctly shows glyphs for invalid dataUri
4. **Cache-busting added**: `index.html` includes `?v=timestamp` to force module reload
5. **Linting applied**: All files formatted by project linters

### Attempted Fixes

- ✅ Added `isValidDataUri()` validation (commit 284f1b0)
- ✅ Restored legacy glyphs (commit f2fd6b2)
- ✅ Fixed empty fallbacks (commit 9858adc)
- ✅ Added cache-busting (commit bcea718)
- ✅ Created test page for validation
- ❌ Issue persists across multiple browsers

### Affected Files

- `packages/ui-web/src/icon-resolver.js` - Icon resolution with validation
- `packages/ui-web/src/actor-inspector.js` - Actor inspector rendering
- `packages/ui-web/index.html` - Cache-busting added
- `tests/ui-web/icon-resolver-invalid-data-uri.test.mjs` - Validation tests
- `tests/ui-web/actor-inspector-icons.test.mjs` - Rendering tests
- `tests/ui-web/populate-ui-icons.test.mjs` - Static placeholder tests

### Test Coverage

- 9 tests for invalid dataUri validation (all pass)
- 4 tests for actor inspector rendering (all pass)
- 3 tests for static icon population (all pass)
- Total: 138 UI tests passing

### Possible Root Causes

1. **Bundle structure issue**: Resource bundle may have format that passes validation but fails in browser
2. **Module loading timing**: Icons may be rendered before validation code loads
3. **CSS interference**: Styles may be hiding the fallback spans
4. **Event timing**: Bundle may be set after initial render, causing stale icon elements

### Next Steps (Future Investigation)

1. Add console logging to track actual bundle content and validation results
2. Inspect network tab to verify module loading order
3. Check if CSS is hiding `.icon-fallback-text` spans
4. Verify `setResourceBundle()` timing relative to render calls
5. Consider adding error event handlers to img elements to retry with glyphs
6. Test with a known-good resource bundle with valid image dataUris

### Workaround

None available. Icons will appear as gray boxes until underlying issue is identified.

### Related Commits

- f2fd6b2: feat(ui-web): restore legacy expression/motivation glyphs
- 9858adc: fix(ui-web): correct empty expression/motivation fallbacks
- 284f1b0: fix(ui-web): validate dataUri before rendering to prevent broken image fallback
- 446c691: test(ui-web): add tests for static icon placeholder population
- efc9fe3: test(ui-web): add comprehensive actor inspector icon rendering tests
- bcea718: fix(ui-web): add cache-busting to module loading to force browser refresh

---

## Future Investigation Required

This issue requires deeper investigation into:
- Actual resource bundle format and content in production
- Browser developer tools inspection during icon rendering
- Timing of bundle loading vs. icon rendering
- Potential CSS conflicts with fallback elements
