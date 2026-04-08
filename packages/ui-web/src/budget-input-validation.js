/**
 * Budget input validation utilities
 * Enforces constraints:
 * - Level Budget: 0 to 100,000 (no negatives)
 * - Percentages: 0-100, must sum to 100%
 */

/**
 * Validates and normalizes a level budget value
 * @param {number|string} value - The input value
 * @param {number} defaultValue - Default if invalid
 * @returns {number} - Valid budget value (0-100,000)
 * @throws {Error} - If value is negative
 */
export function validateLevelBudget(value, defaultValue = 1000) {
  if (value === null || value === undefined) {
    return defaultValue;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }

  if (parsed < 0) {
    throw new Error(`Level budget cannot be negative. Got: ${parsed}`);
  }

  if (parsed > 100000) {
    throw new Error(`Level budget cannot exceed 100,000. Got: ${parsed}`);
  }

  return Math.floor(parsed);
}

/**
 * Validates a percentage value (0-100)
 * @param {number|string} value - The input value
 * @param {number} defaultValue - Default if invalid
 * @returns {number} - Valid percentage (0-100)
 * @throws {Error} - If value is negative or exceeds 100
 */
export function validatePercentage(value, defaultValue = 0) {
  if (value === null || value === undefined) {
    return defaultValue;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }

  if (parsed < 0) {
    throw new Error(`Percentage cannot be negative. Got: ${parsed}`);
  }

  if (parsed > 100) {
    throw new Error(`Percentage cannot exceed 100. Got: ${parsed}`);
  }

  return Math.floor(parsed);
}

/**
 * Validates that budget percentages sum to 100%
 * @param {Object} percentages - Object with room, delver, warden keys
 * @param {number} percentages.room - Room percentage
 * @param {number} percentages.delver - Delver percentage
 * @param {number} percentages.warden - Warden percentage
 * @returns {Object} - Validated percentages
 * @throws {Error} - If percentages don't sum to 100
 */
export function validateBudgetPercentages({ room = 0, delver = 0, warden = 0 }) {
  const validated = {
    room: validatePercentage(room),
    delver: validatePercentage(delver),
    warden: validatePercentage(warden),
  };

  const total = validated.room + validated.delver + validated.warden;

  if (total !== 100) {
    throw new Error(
      `Budget percentages must sum to 100%. Got: ${total}% (room: ${validated.room}%, delver: ${validated.delver}%, warden: ${validated.warden}%)`
    );
  }

  return validated;
}

/**
 * Normalizes budget input values, applying validation
 * @param {Object} input - Input object
 * @param {number|string} input.levelBudget - Level budget value
 * @param {number|string} input.roomPercent - Room percentage
 * @param {number|string} input.delverPercent - Delver percentage
 * @param {number|string} input.wardenPercent - Warden percentage
 * @returns {Object} - Normalized and validated values
 * @throws {Error} - If any value fails validation
 */
export function normalizeBudgetInputs({
  levelBudget = 1000,
  roomPercent = 55,
  delverPercent = 20,
  wardenPercent = 25,
} = {}) {
  return {
    levelBudget: validateLevelBudget(levelBudget),
    percentages: validateBudgetPercentages({
      room: roomPercent,
      delver: delverPercent,
      warden: wardenPercent,
    }),
  };
}
