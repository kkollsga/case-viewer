// core/parser.js — Petrel Output Sheet parsing
// Handles: standard table format, single line totals, format detection
// Returns rich QC info for inline validation display.

import { standardizeUnit, getScaledUnit } from '../utils/units.js';

const STANDARD_NUMERIC_COLUMNS = [
  'Bulk volume', 'Net volume', 'Pore volume',
  'HCPV oil', 'HCPV gas', 'STOIIP', 'GIIP',
];

export const FORMAT = {
  STANDARD_TABLE: 'standard_table',
  SINGLE_LINE_TOTALS: 'single_totals',
  SINGLE_LINE_GROUPED: 'single_grouped',
};

const FORMAT_LABELS = {
  [FORMAT.STANDARD_TABLE]: 'Standard table (pivot)',
  [FORMAT.SINGLE_LINE_TOTALS]: 'Single row (totals per case)',
  [FORMAT.SINGLE_LINE_GROUPED]: 'Single row with grouping (unsupported)',
};

// ─── Header parsing ─────────────────────────────────────────

export function parseHeaders(headerLine) {
  const rawHeaders = headerLine.split('\t');
  const headers = [];
  const units = {};
  const columnMap = {};

  for (const header of rawHeaders) {
    if (!header || !header.trim()) { headers.push(''); continue; }

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

// ─── Metadata extraction from pre-data lines ────────────────

/**
 * Scan lines before the data table for Petrel metadata.
 * Looks for key: value patterns like "Project: MyProject", "Grid: MainGrid"
 */
function extractMetadata(allLines) {
  const meta = {};
  const metaPatterns = [
    { key: 'project', pattern: /^(?:project|project name)\s*[:=]\s*(.+)/i },
    { key: 'grid', pattern: /^(?:grid|grid name|model)\s*[:=]\s*(.+)/i },
    { key: 'exportDate', pattern: /^(?:export date|date|exported)\s*[:=]\s*(.+)/i },
    { key: 'case', pattern: /^(?:case|case name|realization)\s*[:=]\s*(.+)/i },
  ];

  // Only check first 10 lines (metadata is always at the top)
  const limit = Math.min(allLines.length, 10);
  for (let i = 0; i < limit; i++) {
    const line = allLines[i].trim();
    if (!line) continue;
    // Skip if it looks like a data line (has many tabs)
    if (line.split('\t').length > 3) break;

    for (const { key, pattern } of metaPatterns) {
      const m = line.match(pattern);
      if (m) { meta[key] = m[1].trim(); break; }
    }
  }

  return meta;
}

/**
 * Find the header line index — the first line with multiple tab-separated fields.
 */
function findHeaderLineIndex(lines) {
  for (let i = 0; i < lines.length; i++) {
    const cols = lines[i].split('\t');
    if (cols.length >= 3) return i;
  }
  return 0;
}

// ─── Format detection ───────────────────────────────────────

export function detectFormat(headers, firstDataRow) {
  if (!firstDataRow || firstDataRow.length === 0) {
    return { format: FORMAT.STANDARD_TABLE, error: null };
  }

  let nonNumericCount = 0;
  for (let i = 0; i < firstDataRow.length; i++) {
    const val = firstDataRow[i].trim();
    const normalised = val.replace(',', '.');
    if (val === '' || isNaN(parseFloat(normalised))) nonNumericCount++;
  }

  if (nonNumericCount > 1) return { format: FORMAT.STANDARD_TABLE, error: null };

  if (nonNumericCount <= 1) {
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
    return { format: FORMAT.SINGLE_LINE_TOTALS, error: null };
  }

  return { format: FORMAT.STANDARD_TABLE, error: null };
}

// ─── Column classification ──────────────────────────────────

export function detectGroupColumns(headers, units) {
  return headers.filter(h => {
    if (!h || h.trim() === '') return false;
    if (STANDARD_NUMERIC_COLUMNS.includes(h)) return false;
    if (units[h] && units[h] !== '') return false;
    if (h.startsWith('__')) return false;
    return true;
  });
}

function classifyColumns(headers, units) {
  const groups = [];
  const volumes = [];

  for (const h of headers) {
    if (!h || h.trim() === '') continue;
    if (STANDARD_NUMERIC_COLUMNS.includes(h) || (units[h] && units[h] !== '')) {
      volumes.push({ name: h, unit: units[h] || '' });
    } else if (!h.startsWith('__')) {
      groups.push(h);
    }
  }

  return { groups, volumes };
}

// ─── Main parse function ────────────────────────────────────

/**
 * Full parse with rich QC output.
 *
 * @param {string} rawText - Tab-separated text from Petrel
 * @param {Object} options - { divideBy1000: boolean }
 * @returns {Object} Rich result with data, QC info, and per-case breakdown for single-row
 */
export function parseOutputSheet(rawText, options = {}) {
  const { divideBy1000 = true } = options;

  let text = rawText;
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  const allLines = text.split('\n');
  const nonEmptyLines = allLines.filter(l => l.trim() !== '');

  if (nonEmptyLines.length === 0) {
    return { error: 'No data found. Paste tab-separated data from Petrel.' };
  }

  // Extract metadata from pre-data lines
  const petrelMeta = extractMetadata(allLines);

  // Find the actual header line
  const headerIdx = findHeaderLineIndex(nonEmptyLines);
  const headerLine = nonEmptyLines[headerIdx];
  const headerInfo = parseHeaders(headerLine);
  let headers = [...headerInfo.headers];
  const rawUnits = { ...headerInfo.units };

  const dataLines = nonEmptyLines.slice(headerIdx + 1);
  if (dataLines.length === 0) {
    return { error: 'No data rows found after header line.' };
  }

  // Column count fix
  const firstRowCells = dataLines[0].split('\t');
  if (firstRowCells.length === headers.length + 1) {
    headers.unshift('Zones');
    rawUnits['Zones'] = '';
  }

  // Format detection
  const formatResult = detectFormat(headers, firstRowCells);
  if (formatResult.error) {
    return { error: formatResult.error, format: formatResult.format, formatLabel: FORMAT_LABELS[formatResult.format] };
  }

  // Process units
  const units = {};
  for (const [label, rawUnit] of Object.entries(rawUnits)) {
    units[label] = divideBy1000 && rawUnit ? getScaledUnit(rawUnit) : rawUnit;
  }

  // Classify columns
  const groupColumns = detectGroupColumns(headers, rawUnits);
  const { groups, volumes } = classifyColumns(headers, rawUnits);

  // Parse data rows
  const data = [];
  const errors = [];

  for (let i = 0; i < dataLines.length; i++) {
    const cells = dataLines[i].split('\t');
    const row = {};

    const expectedCols = headers.length;
    if (cells.length !== expectedCols && cells.length !== expectedCols - 1) {
      errors.push(`Row ${i + 1}: expected ${expectedCols} columns, got ${cells.length}`);
      continue;
    }

    for (let j = 0; j < headers.length; j++) {
      const header = headers[j];
      if (!header) continue;

      const cellValue = (j < cells.length) ? cells[j] : '';
      const isNumeric = (rawUnits[header] && rawUnits[header] !== '') || STANDARD_NUMERIC_COLUMNS.includes(header);

      if (isNumeric) {
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
    return { error: errors.length > 0 ? `No valid rows:\n${errors.join('\n')}` : 'No data rows parsed.' };
  }

  // ── Build QC summary ──
  const qc = {
    format: formatResult.format,
    formatLabel: FORMAT_LABELS[formatResult.format],
    rowCount: data.length,
    columnCount: headers.filter(h => h).length,
    groupColumns: groups,
    volumeColumns: volumes,
    petrelMeta,
    errors: errors.length > 0 ? errors : null,
  };

  // ── For single-row format, split into per-case entries ──
  let cases = null;
  if (formatResult.format === FORMAT.SINGLE_LINE_TOTALS) {
    // First non-numeric column is the case identifier
    const caseCol = groupColumns[0] || null;
    cases = data.map((row, idx) => {
      const caseName = caseCol ? row[caseCol] : `Case ${idx + 1}`;
      return {
        originalName: caseName,
        suggestedName: caseName,
        description: '',
        row,
      };
    });
    qc.caseCount = cases.length;
  } else {
    // Standard table = one case
    qc.caseCount = 1;
  }

  return {
    data, headers, units, rawUnits,
    format: formatResult.format,
    groupColumns, cases,
    qc, errors: errors.length > 0 ? errors : null,
    columnMap: headerInfo.columnMap,
  };
}
