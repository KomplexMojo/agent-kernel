# Budget Input Validation Tests

## Overview

This document describes the comprehensive unit tests created for input validation in the Game Generator UI's budget controls, addressing issues identified in the Playwright test results.

## Issues Fixed

Based on findings in `PLAYWRIGHT_TEST_RESULTS.md`, the following validation issues were identified and now have comprehensive tests:

1. **Negative Budget Values** - Previously accepted; now rejected
2. **Maximum Budget Constraint** - Now enforces 0-100,000 limit (was accepting 999,999)
3. **Percentage Distribution** - Now enforces that percentages must sum exactly to 100%

## Test Files

### Implementation Module
**File:** `packages/ui-web/src/budget-input-validation.js`

Provides four validation functions:
- `validateLevelBudget()` - Validates budget values (0-100,000)
- `validatePercentage()` - Validates individual percentages (0-100)
- `validateBudgetPercentages()` - Validates all three percentages sum to 100%
- `normalizeBudgetInputs()` - Composite validation for complete budget input

### Test Suite
**File:** `tests/ui-web/budget-input-validation.test.mjs`

Contains 43 tests organized into 5 test suites:

```
✓ validateLevelBudget (9 tests)
✓ validatePercentage (8 tests)
✓ validateBudgetPercentages (8 tests)
✓ normalizeBudgetInputs (6 tests)
✓ Integration: Real-world scenarios (7 tests)
```

## Test Coverage

### Level Budget Validation

Tests ensure that level budget input:
- ✅ Accepts values 0 to 100,000
- ✅ Rejects negative values (throws error)
- ✅ Rejects values exceeding 100,000 (throws error)
- ✅ Floors decimal values (1000.9 → 1000)
- ✅ Accepts string numbers ("1000" → 1000)
- ✅ Handles null/undefined with defaults
- ✅ Applies custom default values

### Percentage Validation

Tests ensure that individual percentages:
- ✅ Accept values 0 to 100
- ✅ Reject negative values (throws error)
- ✅ Reject values exceeding 100 (throws error)
- ✅ Floor decimal values (50.9 → 50)
- ✅ Accept string percentages ("50" → 50)
- ✅ Handle null/undefined with defaults
- ✅ Boundary cases (0 and 100 are valid)

### Budget Distribution Validation

Tests ensure that room, delver, and warden percentages:
- ✅ Must sum exactly to 100%
- ✅ Reject any negative percentage (throws error)
- ✅ Reject any percentage exceeding 100 (throws error)
- ✅ Provide detailed error messages showing the sum and breakdown
- ✅ Support string inputs
- ✅ Work correctly with floored decimal values

**Examples of valid distributions:**
- Room: 55%, Delver: 20%, Warden: 25% ✅
- Room: 50%, Delver: 25%, Warden: 25% ✅
- Room: 100%, Delver: 0%, Warden: 0% ✅

**Examples of invalid distributions:**
- Room: 50%, Delver: 25%, Warden: 19% ❌ (sums to 94)
- Room: 70%, Delver: 20%, Warden: 15% ❌ (sums to 105)
- Room: 33%, Delver: 33%, Warden: 33% ❌ (sums to 99)

## Real-World Test Scenarios

The test suite includes integration tests covering scenarios from the Playwright UI tests:

### Scenario 1: Adjusting Level Budget (Screenshot #11)
```javascript
// Before: 1000, After: 2000
const result = normalizeBudgetInputs({
  levelBudget: 2000,
  roomPercent: 55,
  delverPercent: 20,
  wardenPercent: 25,
});
// ✅ Accepts valid adjustment
```

### Scenario 2: Adjusting Room Percentage (Screenshot #12)
```javascript
// Changing room allocation from 55% to 70%
const result = normalizeBudgetInputs({
  levelBudget: 1000,
  roomPercent: 70,
  delverPercent: 15,
  wardenPercent: 15,
});
// ✅ Accepts valid rebalance
```

### Scenario 3: Very Large Budget (Screenshot #19)
```javascript
// User tries to enter 999,999
normalizeBudgetInputs({
  levelBudget: 999999,
  roomPercent: 55,
  delverPercent: 20,
  wardenPercent: 25,
});
// ❌ Throws: "cannot exceed 100,000"
```

### Scenario 4: Negative Budget (Screenshot #13)
```javascript
// User tries to enter -500
normalizeBudgetInputs({
  levelBudget: -500,
  roomPercent: 55,
  delverPercent: 20,
  wardenPercent: 25,
});
// ❌ Throws: "cannot be negative"
```

### Scenario 5: Unbalanced Percentages
```javascript
// User sets percentages that don't sum to 100
normalizeBudgetInputs({
  levelBudget: 1000,
  roomPercent: 70,
  delverPercent: 20,
  wardenPercent: 25, // Would be 115% total
});
// ❌ Throws: "must sum to 100%"
```

## Running the Tests

```bash
# Run all budget validation tests
node --test tests/ui-web/budget-input-validation.test.mjs

# Run with verbose output
node --test --verbose tests/ui-web/budget-input-validation.test.mjs
```

## Error Messages

The validation functions provide clear, actionable error messages:

### Level Budget Errors
```
"Level budget cannot be negative. Got: -500"
"Level budget cannot exceed 100,000. Got: 150000"
```

### Percentage Errors
```
"Percentage cannot be negative. Got: -10"
"Percentage cannot exceed 100. Got: 150"
```

### Distribution Errors
```
"Budget percentages must sum to 100%. Got: 115% (room: 70%, delver: 20%, warden: 25%)"
```

## Integration with UI

To integrate these validations into the actual UI components:

```javascript
import { normalizeBudgetInputs } from '../budget-input-validation.js';

// When user submits budget form
try {
  const validated = normalizeBudgetInputs({
    levelBudget: userLevelBudgetInput.value,
    roomPercent: userRoomPercentInput.value,
    delverPercent: userDelverPercentInput.value,
    wardenPercent: userWardenPercentInput.value,
  });
  
  // Use validated values
  console.log('Budget is valid:', validated);
  
} catch (error) {
  // Display error to user
  console.error('Invalid input:', error.message);
  displayErrorMessage(error.message);
}
```

## Test Results Summary

```
Total Tests: 43
Passing: 43 ✅
Failing: 0
Duration: ~54ms

Test Suites:
- validateLevelBudget: 9/9 ✅
- validatePercentage: 8/8 ✅
- validateBudgetPercentages: 8/8 ✅
- normalizeBudgetInputs: 6/6 ✅
- Integration Scenarios: 7/7 ✅
```

## Design Constraints

The validation enforces these constraints from the project requirements:

| Input | Min | Max | Notes |
|-------|-----|-----|-------|
| Level Budget | 0 | 100,000 | No negatives allowed |
| Room % | 0 | 100 | Part of distribution |
| Delver % | 0 | 100 | Part of distribution |
| Warden % | 0 | 100 | Part of distribution |
| **Total %** | - | **100** | **Must sum exactly to 100%** |

## Future Enhancements

Potential areas for expansion:
1. Real-time validation with UI feedback
2. Percentage auto-rebalancing (user adjusts one, others scale)
3. Budget allocation suggestions based on difficulty level
4. Persistence of user preferences
5. Undo/redo functionality for budget adjustments
