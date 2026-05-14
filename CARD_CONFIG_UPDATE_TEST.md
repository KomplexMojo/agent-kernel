# Card Configuration Update Test Guide

## Overview
This document describes the manual test scenario for verifying that card configuration updates in the design tab are properly reflected in the gameplay tab.

## Test Scenario: Delver Configuration Update

This test verifies that when a user:
1. Creates/configures a delver card with specific vitals
2. Launches gameplay to see the delver
3. Goes back to design and modifies the delver's configuration
4. Returns to gameplay

The gameplay view correctly shows the **updated** configuration, not the original.

## Manual Test Steps

### Step 1: Initial Setup
1. Open the Agent Kernel UI in your browser
2. Verify you're on the **Design** tab
3. Click "Auto-generate" to populate cards with default configuration

### Step 2: Verify Initial Gameplay
1. Click the **Gameplay** tab
2. Wait for "Run loaded." message
3. Open the **Run Companion** panel on the right
4. Click on a delver (marked with "D") to inspect its vitals
5. Record the delver's initial vitals:
   - **Health (HP)**: current/max
   - **Mana (MP)**: current/max  
   - **Stamina (ST)**: current/max
   - **Durability (DU)**: current/max

### Step 3: Modify Design Configuration
1. Return to the **Design** tab
2. Locate the delver card in the **Shelf Groups** section (right side, Delver group)
3. Click on the delver card to select it
4. Modify the vitals:
   - **Add 10 to Health**: Find the health vital control, increase the max value by 10
   - **Change Mana Regen**: Modify mana regen setting to "R4" (if available) or increase mana regen value
   - (Optional) Modify other parameters like stamina or durability

### Step 4: Verify Updated Gameplay
1. Return to the **Gameplay** tab
2. Observe the status message - it should briefly show "Launching run..." while building
3. Wait for "Run loaded." message
4. Open the **Run Companion** panel again
5. Inspect the same delver (or a new one with the same configuration)
6. **VERIFY** that the vitals reflect your changes:
   - Health should be **10 higher** than before
   - Mana regen should be **R4** or the modified value
   - Other parameters should match your changes

## Expected Behavior

✅ **PASS**: The delver's configuration in gameplay reflects the changes made in the design tab
- Health max is increased by 10
- Mana regen matches the new configuration
- No "cached" or "stale" data is shown

❌ **FAIL**: The delver still shows the original configuration
- Health max is unchanged
- Mana regen is the original value
- This indicates the gameplay is using a cached/old bundle instead of regenerating with the new design

## Technical Details

### What Should Happen
1. When you modify a card in the design tab, the internal `card` object is updated
2. When you switch to the gameplay tab, `launchGameplayRun()` is triggered
3. This function:
   - Calls `publishPreviewSpec()` with the current design state
   - Runs the build with the new specification
   - Triggers a UI regeneration with the updated configuration
4. The gameplay view calls `gameplayView.clear()` which clears the old board rendering
5. Once the new build completes, the updated configuration is loaded and displayed

### Areas to Watch
- **Design State**: Verify that card modifications in `designView` are persisted
- **Spec Publication**: Confirm that `publishPreviewSpec()` includes the updated cards
- **Build Process**: Check that the build uses the new spec, not a cached version
- **UI Clearing**: Verify that `gameplayView.clear()` and `renderer.clearBoard()` properly clear old visual state
- **Bundle Loading**: Confirm that the new bundle with updated configuration is loaded into gameplay

## Debugging

### If Test Fails
1. **Check Browser Console** for JavaScript errors
2. **Inspect Network Requests**:
   - Verify that the build request includes the modified card configuration
   - Check that the response bundle has the updated card data
3. **Check Element State**:
   - Verify that the delver card in shelf groups shows the updated values
   - Check that the Run Companion shows the correct vitals when inspecting
4. **Check Gameplay Status**:
   - Does it show "Launching run..." when switching tabs?
   - Does it eventually show "Run loaded."?
   - Are there any error messages?

## Related Code

- **Design Configuration**: `packages/ui-web/src/design-guidance.js`
- **Gameplay View**: `packages/ui-web/src/views/gameplay-view.js`
- **Phaser Renderer**: `packages/ui-web/src/views/gameplay-phaser-renderer.js`
- **Spec Publishing**: `packages/ui-web/src/views/design-view.js`
- **Main App Flow**: `packages/ui-web/src/main.js` (tab onChange handler)

## Recent Fixes

The following fix was applied to ensure the gameplay view properly clears when switching tabs:
- **Added `clearBoard()` method** to the Phaser renderer to destroy the visual container
- **Updated `gameplayView.clear()`** to call `renderer.clearBoard()` instead of just `clearHighlight()`

This ensures that when you switch back to gameplay with a new design, the old board is cleared before the new run loads.
