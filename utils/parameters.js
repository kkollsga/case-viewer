// utils/parameters.js — Calculated volumetric parameters
// Derives NTG, Por, So, Sg, 1/Bo, 1/Bg from raw volumes.

import { getUnitMultiplier } from './units.js';

/**
 * Calculate derived parameters from a row of raw volumetric data.
 * Used for both individual rows and group summaries (sum raw volumes first,
 * then derive ratios from the sums — not average of ratios).
 *
 * @param {Object} row - Data row with raw volumetric values
 * @param {Object} units - Map of column name → unit code
 * @returns {Object} Calculated parameters
 */
export function calculateParameters(row, units) {
  const get = (key) => (parseFloat(row[key]) || 0) * (getUnitMultiplier(units[key]) || 1);

  const bulkVolume = get('Bulk volume');
  const netVolume  = get('Net volume');
  const poreVolume = get('Pore volume');
  const hcpvOil    = get('HCPV oil');
  const hcpvGas    = get('HCPV gas');
  const stoiip     = get('STOIIP');
  const giip       = get('GIIP');

  return {
    GRV:    parseFloat(row['Bulk volume']) || 0,
    NTG:    bulkVolume > 0 ? netVolume / bulkVolume : 0,
    Por:    netVolume > 0  ? poreVolume / netVolume : 0,
    So:     poreVolume > 0 ? hcpvOil / poreVolume : 0,
    Sg:     poreVolume > 0 ? hcpvGas / poreVolume : 0,
    '1/Bo': hcpvOil > 0    ? stoiip / hcpvOil : 0,
    '1/Bg': hcpvGas > 0    ? giip / hcpvGas : 0,
    STOIIP: parseFloat(row['STOIIP']) || 0,
    GIIP:   parseFloat(row['GIIP']) || 0,
  };
}

/** The display columns when "Show Parameters" is active */
export const PARAMETER_COLUMNS = [
  'GRV', 'NTG', 'Por', 'So', 'Sg', '1/Bo', '1/Bg', 'STOIIP', 'GIIP'
];

/** Parameter-specific units for display */
export function getParameterUnits(volumeUnits) {
  return {
    GRV:    volumeUnits['Bulk volume'] || '',
    NTG:    'frac',
    Por:    'frac',
    So:     'frac',
    Sg:     'frac',
    '1/Bo': '',
    '1/Bg': '',
    STOIIP: volumeUnits['STOIIP'] || '',
    GIIP:   volumeUnits['GIIP'] || '',
  };
}

/**
 * Format a parameter value for display.
 * Fractions shown as percentage, volumes as standard numbers.
 */
export function formatParameterValue(key, value) {
  if (['NTG', 'Por', 'So', 'Sg'].includes(key)) {
    return (value * 100).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + '%';
  }
  if (['1/Bo', '1/Bg'].includes(key)) {
    return value.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Sum raw volumetric values across multiple rows, then calculate parameters.
 * This is the correct approach for group/total summaries.
 */
export function calculateGroupParameters(rows, groupColumns, units) {
  const totals = {};

  // Sum all numeric columns
  for (const row of rows) {
    for (const [key, val] of Object.entries(row)) {
      if (groupColumns.includes(key) || key.startsWith('__')) continue;
      const num = parseFloat(val);
      if (!isNaN(num)) {
        totals[key] = (totals[key] || 0) + num;
      }
    }
  }

  return calculateParameters(totals, units);
}
