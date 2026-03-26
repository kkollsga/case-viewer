// utils/units.js — Unit standardisation and scaling pipeline
// Handles Petrel Output Sheet unit annotations: [*10^3 m3], [1e6 Sm3], etc.

const UNIT_MULTIPLIERS = {
  CM:  1,
  KCM: 1e3,
  MCM: 1e6,
  BCM: 1e9,
  TCM: 1e12,
};

const SCALE_UP = {
  CM:  'KCM',
  KCM: 'MCM',
  MCM: 'BCM',
  BCM: 'TCM',
  TCM: 'TCM',
};

/**
 * Convert a raw Petrel unit string to a standard code.
 * Examples:
 *   "[*10^3 m3]"  → "KCM"
 *   "[1e6 Sm3]"   → "MCM"
 *   "MCM"         → "MCM"
 */
export function standardizeUnit(rawUnit) {
  if (!rawUnit) return '';

  const stripped = rawUnit.replace(/\[|\]/g, '').trim();

  // Scientific notation: *10^N or 1eN
  const powerMatch = stripped.match(/(?:\*10\^|1[eE])(\d+)/);
  if (powerMatch) {
    const power = parseInt(powerMatch[1], 10);
    switch (power) {
      case 0:  return 'CM';
      case 3:  return 'KCM';
      case 6:  return 'MCM';
      case 9:  return 'BCM';
      case 12: return 'TCM';
      default: return 'CM';
    }
  }

  // Already a standard code
  if (stripped in UNIT_MULTIPLIERS) return stripped;

  return 'CM';
}

/**
 * Get the numeric multiplier for a standard unit code.
 */
export function getUnitMultiplier(unitStr) {
  return UNIT_MULTIPLIERS[unitStr] || 1;
}

/**
 * When dividing values by 1000, scale the display unit up one tier.
 * KCM → MCM, MCM → BCM, etc.
 */
export function getScaledUnit(unit) {
  if (!unit) return unit;
  return SCALE_UP[unit] || unit;
}

/**
 * Format a unit code for display.
 */
export function formatUnit(unitCode) {
  if (!unitCode) return '';
  return unitCode;
}
