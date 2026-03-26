// utils/format.js — Number formatting and display helpers

/**
 * Format a number with 2 decimal places and locale-aware separators.
 */
export function formatNumber(value) {
  const num = parseFloat(value);
  if (isNaN(num)) return '0.00';
  return num.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Format a compact total (e.g. "1.23M", "456k").
 */
export function formatCompact(value) {
  const num = parseFloat(value);
  if (isNaN(num)) return '0';
  if (Math.abs(num) >= 1e6) {
    return (num / 1e6).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + 'M';
  }
  if (Math.abs(num) >= 1e3) {
    return (num / 1e3).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + 'k';
  }
  return formatNumber(num);
}

/**
 * Format a value as percentage with 2 decimals.
 */
export function formatPercent(value) {
  return (value * 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + '%';
}

/**
 * Format a date for display: "Mar 20, 2026"
 */
export function formatDate(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Format a short date: "Mar 20"
 */
export function formatDateShort(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const month = date.toLocaleString('en-US', { month: 'short' });
  return `${month} ${date.getDate()}`;
}

/**
 * Format a date for datetime-local input: "2026-03-20T14:30"
 */
export function formatDateTimeForInput(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}T${h}:${min}`;
}

/**
 * Format a date with time for display: "Mar 20, 2026 14:30"
 */
export function formatDateTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return formatDate(timestamp) + ' ' +
    date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/**
 * Format a metric name for display (camelCase → readable).
 */
export function formatMetricName(metric) {
  const nameMap = {
    bulkVolume: 'Bulk Volume',
    netVolume: 'Net Volume',
    poreVolume: 'Pore Volume',
    hcpvOil: 'HCPV Oil',
    hcpvGas: 'HCPV Gas',
    stoiip: 'STOIIP',
    giip: 'GIIP',
    ntg: 'NTG',
    porosity: 'Porosity',
    soOil: 'So',
    sgGas: 'Sg',
    boOil: '1/Bo',
    bgGas: '1/Bg',
  };
  return nameMap[metric] || metric;
}
