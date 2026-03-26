// core/parser.js — Petrel Output Sheet parsing
// Handles: standard table format, single line totals, format detection

import { standardizeUnit, getScaledUnit } from '../utils/units.js';

// Known numeric volume columns (used to distinguish grouping vs data columns)
const STANDARD_NUMERIC_COLUMNS = [
  'Bulk volume', 'Net volume', 'Pore volume',
  'HCPV oil', 'HCPV gas', 'STOIIP', 'GIIP',
];

/**
 * Input format types.
 */
export const FORMAT = {
  STANDARD_TABLE: 'standard_table',    // One row per zone/segment
  SINGLE_LINE_TOTALS: 'single_totals', // One row, field totals only
  SINGLE_LINE_GROUPED: 'single_grouped', // Hierarchy in column names — unsupported
};

/**
 * Parse header line: extract clean labels, units, and column mapping.
 * Handles: "STOIIP [1e6 Sm3]" → { label: "STOIIP", unit: "MCM" }
 */
export function parseHeaders(headerLine) {
  const rawHeaders = headerLine.split('\t');
  const headers = [];
  const units = {};
  const columnMap = {};

  for (const header of rawHeaders) {
    if (!header || !header.trim()) {
      headers.push('');
      continue;
    }

    const match = header.match(/^(.+?)\s*\[\s*(.*?)\s*\]$/);
    if (match) {
      const cleanLabel = match[1].trim();
      const rawUnit = match[2].trim();
      headers.push(cleanLabel);
      units[cleanLabel] = standardizeUnit(rawUnit);
      columnMap[cleanLabel] = header;
    } else {
      const cleanLabel = header.trim();
      headers.push(cleanLabel);
      units[cleanLabel] = '';
      columnMap[cleanLabel] = header;
    }
  }

  return { headers, units, columnMap };
}

/**
 * Detect the input format from headers and first data row.
 */
export function detectFormat(headers, firstDataRow) {
  if (!firstDataRow || firstDataRow.length === 0) {
    return { format: FORMAT.STANDARD_TABLE, error: null };
  }

  // Count non-numeric cells in the first data row
  let nonNumericCount = 0;
  const nonNumericIndices = [];

  for (let i = 0; i < firstDataRow.length; i++) {
    const val = firstDataRow[i].trim();
    // Check if value is numeric (handle both comma and dot decimals)
    const normalised = val.replace(',', '.');
    if (val === '' || isNaN(parseFloat(normalised))) {
      nonNumericCount++;
      nonNumericIndices.push(i);
    }
  }

  // Multiple non-numeric cells → standard table format (Zone, Segment, etc.)
  if (nonNumericCount > 1) {
    return { format: FORMAT.STANDARD_TABLE, error: null };
  }

  // Exactly 1 non-numeric cell — check if columns encode hierarchy
  if (nonNumericCount <= 1) {
    // Check for parenthesised group names: "STOIIP (North)" or "STOIIP (North/Main)"
    const hasGroupedColumns = headers.some(h =>
      /^.+\s*\(.+\)/.test(h) && !/^\s*\[/.test(h)
    );

    if (hasGroupedColumns) {
      return {
        format: FORMAT.SINGLE_LINE_GROUPED,
        error: 'This looks like a single line format export with zone/segment grouping. ' +
               'Please re-export from Petrel using the standard table format ' +
               '(uncheck "Single line format" in the Report tab).',
      };
    }

    // Single line totals — valid
    return { format: FORMAT.SINGLE_LINE_TOTALS, error: null };
  }

  return { format: FORMAT.STANDARD_TABLE, error: null };
}

/**
 * Identify which columns are grouping keys (non-numeric, low cardinality).
 */
export function detectGroupColumns(headers, units) {
  return headers.filter(h => {
    if (!h || h.trim() === '') return false;
    if (STANDARD_NUMERIC_COLUMNS.includes(h)) return false;
    if (units[h] && units[h] !== '') return false; // Has unit → numeric
    if (h.startsWith('__')) return false;
    return true;
  });
}

/**
 * Full parse: take raw pasted text and return structured data.
 *
 * @param {string} rawText - Tab-separated text from Petrel
 * @param {Object} options - { divideBy1000: boolean }
 * @returns {Object} { data, headers, units, format, groupColumns, error }
 */
export function parseOutputSheet(rawText, options = {}) {
  const { divideBy1000 = true } = options;

  // Strip BOM
  let text = rawText;
  if (text.charCodeAt(0) === 0xFEFF) {
    text = text.slice(1);
  }

  // Split into lines, filter blanks
  const lines = text.split('\n').filter(line => line.trim() !== '');
  if (lines.length === 0) {
    return { error: 'No data found. Please paste tab-separated data from Petrel.' };
  }

  // Parse headers
  const headerLine = lines[0];
  const headerInfo = parseHeaders(headerLine);
  let headers = [...headerInfo.headers];
  const rawUnits = { ...headerInfo.units };

  // Need at least one data row
  if (lines.length < 2) {
    return { error: 'No data rows found. The input contains only a header line.' };
  }

  // Check first data row for column count mismatch
  const firstRowCells = lines[1].split('\t');

  // If data has one more column than headers, add "Zones" as first column
  if (firstRowCells.length === headers.length + 1) {
    headers.unshift('Zones');
    rawUnits['Zones'] = '';
  }

  // Detect format
  const formatResult = detectFormat(headers, firstRowCells);
  if (formatResult.error) {
    return { error: formatResult.error, format: formatResult.format };
  }

  // Process units (apply divide-by-1000 scaling)
  const units = {};
  for (const [label, rawUnit] of Object.entries(rawUnits)) {
    units[label] = divideBy1000 && rawUnit ? getScaledUnit(rawUnit) : rawUnit;
  }

  // Detect which columns are grouping keys
  const groupColumns = detectGroupColumns(headers, rawUnits);

  // Parse data rows
  const data = [];
  const errors = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split('\t');
    const row = {};

    // Handle column count mismatch
    const expectedCols = headers.length;
    const actualCells = cells.length;

    // Allow off-by-one (already handled by "Zones" prepend) and exact match
    if (actualCells !== expectedCols && actualCells !== expectedCols - 1) {
      errors.push(`Row ${i}: expected ${expectedCols} columns, got ${actualCells}`);
      continue;
    }

    for (let j = 0; j < headers.length; j++) {
      const header = headers[j];
      if (!header) continue;

      const cellValue = (j < cells.length) ? cells[j] : '';

      // Is this a numeric column? (has a unit or is a known numeric column)
      const isNumeric = (rawUnits[header] && rawUnits[header] !== '') ||
                        STANDARD_NUMERIC_COLUMNS.includes(header);

      if (isNumeric) {
        // Parse numeric, handle comma decimals
        const normalised = cellValue.replace(',', '.');
        let num = parseFloat(normalised);
        if (isNaN(num)) num = 0;
        if (divideBy1000) num /= 1000;
        row[header] = num;
      } else {
        row[header] = cellValue.trim();
      }
    }

    data.push(row);
  }

  if (data.length === 0) {
    const msg = errors.length > 0
      ? `No valid data rows. Errors:\n${errors.join('\n')}`
      : 'No data rows could be parsed.';
    return { error: msg };
  }

  return {
    data,
    headers,
    units,
    format: formatResult.format,
    groupColumns,
    errors: errors.length > 0 ? errors : null,
    columnMap: headerInfo.columnMap,
  };
}
