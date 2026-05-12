// core/parser.js — Petrel Output Sheet parsing
// Handles: standard table format, single line totals, format detection
// Returns rich QC info for inline validation display.

import { standardizeUnit, getScaledUnit } from '../utils/units.js';

const STANDARD_NUMERIC_COLUMNS = [
  'Bulk volume', 'Net volume', 'Pore volume',
  'HCPV oil', 'HCPV gas', 'STOIIP', 'GIIP',
  'STOIIP (in oil)', 'STOIIP (in gas)', 'GIIP (in gas)', 'GIIP (in oil)',
];

// Columns to exclude from volume group detection
const EXCLUDED_GROUP_COLUMNS = ['Case', 'Folder'];

// Known volume column patterns (for header line detection)
const VOLUME_HEADER_PATTERNS = [
  'Bulk volume', 'Net volume', 'Pore volume', 'HCPV', 'STOIIP', 'GIIP',
];

export const FORMAT = {
  STANDARD_TABLE: 'standard_table',
  SINGLE_LINE_TOTALS: 'single_totals',
  SINGLE_LINE_GROUPED: 'single_grouped',
  MULTI_ROW_HEADER: 'multi_row_header', // Petrel "Single line format" with zone breakdown spread across repeated columns + upper header rows
};

const FORMAT_LABELS = {
  [FORMAT.STANDARD_TABLE]: 'Standard table (pivot)',
  [FORMAT.SINGLE_LINE_TOTALS]: 'Single row (totals per case)',
  [FORMAT.SINGLE_LINE_GROUPED]: 'Single row with grouping (unsupported)',
  [FORMAT.MULTI_ROW_HEADER]: 'Petrel single line format (multi-row header)',
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
    { key: 'project', pattern: /^(?:project|project name)\s*[:=\t]\s*(.+)/i },
    { key: 'grid', pattern: /^(?:grid|grid name)\s*[:=\t]\s*(.+)/i },
    { key: 'model', pattern: /^(?:model|model name)\s*[:=\t]\s*(.+)/i },
    { key: 'exportDate', pattern: /^(?:export date|date|exported)\s*[:=\t]\s*(.+)/i },
    { key: 'case', pattern: /^(?:case|case name|realization)\s*[:=\t]\s*(.+)/i },
    { key: 'user', pattern: /^(?:user name|user)\s*[:=\t]\s*(.+)/i },
  ];

  // Scan metadata lines before the data table (can be 30+ lines in Petrel)
  const limit = Math.min(allLines.length, 50);
  for (let i = 0; i < limit; i++) {
    const line = allLines[i].trim();
    if (!line) continue;
    // Stop if this looks like a volume data header (contains known volume column names)
    if (VOLUME_HEADER_PATTERNS.some(p => line.includes(p))) break;

    for (const { key, pattern } of metaPatterns) {
      const m = line.match(pattern);
      if (m) { meta[key] = m[1].trim(); break; }
    }
  }

  return meta;
}

/**
 * Find the best header line index.
 * Petrel output sheets can have multiple sections (Totals, Zones, Facies, Detailed results).
 * We prefer the LAST header line that contains known volume column names — this is
 * typically the "Detailed results" section with proper Zone/Facies/Region grouping.
 * Falls back to the first multi-column line if no volume headers are found.
 */
function findHeaderLineIndex(lines) {
  let lastVolumeHeader = -1;
  let firstMultiCol = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const cols = line.split('\t');
    if (cols.length < 3) continue;

    if (firstMultiCol === -1) firstMultiCol = i;

    // Check if this line contains known volume column names
    const hasVolumeHeaders = VOLUME_HEADER_PATTERNS.some(pattern =>
      cols.some(col => col.includes(pattern))
    );

    if (hasVolumeHeaders) {
      lastVolumeHeader = i;
    }
  }

  // Prefer the last header with volume columns (Detailed results section)
  if (lastVolumeHeader !== -1) return lastVolumeHeader;
  // Fall back to first multi-column line
  return firstMultiCol !== -1 ? firstMultiCol : 0;
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
    if (h.startsWith('$')) return false;               // Petrel parameter columns
    if (EXCLUDED_GROUP_COLUMNS.includes(h)) return false; // Case, Folder, etc.
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
    } else if (!h.startsWith('__') && !h.startsWith('$') && !EXCLUDED_GROUP_COLUMNS.includes(h)) {
      groups.push(h);
    }
  }

  return { groups, volumes };
}

// ─── Multi-row header detection ─────────────────────────────

/**
 * Walk backwards from the property header line to collect upper header rows
 * (e.g. Petrel's "Zones" / "Contact regions" rows). An upper header row is
 * recognised by:
 *   - same tab-cell count as the property header (so columns align), and
 *   - a non-empty first cell that does NOT look like a property column
 *     (no units, no known volume names), and
 *   - at least one non-empty cell beyond the first, aligned with one of the
 *     repeated-name columns in the property header.
 *
 * Returns an array of upper rows ordered top-to-bottom:
 *   [{ label: 'Zones', cells: ['Zones', '', '', ..., 'Levee', 'Levee', ...] }, ...]
 */
function findUpperHeaders(nonEmptyLines, headerIdx, propertyCells) {
  const expectCount = propertyCells.length;
  const repeatedColumns = findRepeatedColumns(propertyCells);
  if (repeatedColumns.size === 0) return [];

  const upper = [];
  for (let i = headerIdx - 1; i >= 0; i--) {
    const cells = nonEmptyLines[i].split('\t');
    if (cells.length !== expectCount) break;

    const first = (cells[0] || '').trim();
    if (!first) break;

    // Skip rows that look like a property header themselves
    if (VOLUME_HEADER_PATTERNS.some((p) => first.includes(p))) break;

    // Must have at least one non-empty cell aligned with a repeated column
    let hasAlignedValue = false;
    for (let j = 1; j < cells.length; j++) {
      if (repeatedColumns.has(j) && cells[j].trim() !== '') {
        hasAlignedValue = true;
        break;
      }
    }
    if (!hasAlignedValue) break;

    upper.unshift({ label: first, cells });
  }
  return upper;
}

function findRepeatedColumns(propertyCells) {
  const counts = new Map();
  const cleaned = propertyCells.map((c) => stripUnits(c));
  for (const name of cleaned) {
    if (!name) continue;
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  const repeatedIndices = new Set();
  for (let i = 0; i < cleaned.length; i++) {
    if (counts.get(cleaned[i]) > 1) repeatedIndices.add(i);
  }
  return repeatedIndices;
}

function stripUnits(header) {
  if (!header) return '';
  const m = header.match(/^(.+?)\s*\[\s*.*?\s*\]$/);
  return (m ? m[1] : header).trim();
}

// ─── Multi-row header parsing (Format 4) ────────────────────

function parseMultiRowHeader(propertyCells, upperRows, dataLines, divideBy1000) {
  // Property metadata per column
  const columns = propertyCells.map((raw, i) => {
    const m = raw.match(/^(.+?)\s*\[\s*(.*?)\s*\]$/);
    const name = (m ? m[1] : raw).trim();
    const rawUnit = m ? m[2].trim() : '';
    return { idx: i, name, rawUnit };
  });

  // Units: prefer the bracketed occurrence for any duplicated property name
  const rawUnits = {};
  for (const c of columns) {
    if (!c.name) continue;
    if (rawUnits[c.name] === undefined || (rawUnits[c.name] === '' && c.rawUnit)) {
      rawUnits[c.name] = c.rawUnit ? standardizeUnit(c.rawUnit) : '';
    }
  }
  const units = {};
  for (const [k, v] of Object.entries(rawUnits)) {
    units[k] = divideBy1000 && v ? getScaledUnit(v) : v;
  }

  // Upper header labels = group column names ("Zones", "Contact regions")
  const groupLabels = upperRows.map((r) => r.label);

  // Classify each column: totals (no upper-header values) vs breakdown (has upper-header values)
  const caseIdCol = columns[0]; // first column is the realization identifier
  const totalsCols = [];     // [{ idx, name }]
  const breakdownCols = [];  // [{ idx, name, groupValues: { Zones: 'Levee', 'Contact regions': 'Duva' } }]
  for (let i = 1; i < columns.length; i++) {
    const c = columns[i];
    if (!c.name) continue;
    const groupValues = {};
    let hasAny = false;
    for (let r = 0; r < upperRows.length; r++) {
      const v = (upperRows[r].cells[i] || '').trim();
      if (v) {
        groupValues[upperRows[r].label] = v;
        hasAny = true;
      }
    }
    if (hasAny) {
      breakdownCols.push({ idx: i, name: c.name, groupValues });
    } else {
      totalsCols.push({ idx: i, name: c.name });
    }
  }

  // Parse each data line into one realization
  const realizations = [];
  const errors = [];
  for (let r = 0; r < dataLines.length; r++) {
    const cells = dataLines[r].split('\t');
    if (cells.length < columns.length && cells.length < columns.length - 1) {
      errors.push(`Row ${r + 1}: expected ${columns.length} cells, got ${cells.length}`);
      continue;
    }

    const name = (cells[caseIdCol.idx] || '').trim() || `Run ${r + 1}`;
    const totals = {};
    for (const tc of totalsCols) {
      totals[tc.name] = numericCell(cells[tc.idx], rawUnits[tc.name], divideBy1000);
    }

    // Group breakdown cells by (zone, contact, ...) tuple → one row per tuple
    const grouped = new Map();
    for (const bc of breakdownCols) {
      const key = groupLabels.map((g) => bc.groupValues[g] || '').join('|');
      if (!grouped.has(key)) {
        const row = {};
        for (const g of groupLabels) row[g] = bc.groupValues[g] || '';
        grouped.set(key, row);
      }
      const row = grouped.get(key);
      row[bc.name] = numericCell(cells[bc.idx], rawUnits[bc.name], divideBy1000);
    }
    const breakdown = [...grouped.values()];

    realizations.push({ name, totals, breakdown });
  }

  return {
    realizations,
    rawUnits,
    units,
    groupLabels,
    columns,
    totalsCols,
    breakdownCols,
    caseIdName: caseIdCol.name,
    errors,
  };
}

function numericCell(raw, rawUnit, divideBy1000) {
  if (raw == null) return 0;
  const normalised = String(raw).replace(',', '.');
  let n = parseFloat(normalised);
  if (!Number.isFinite(n)) n = 0;
  if (divideBy1000 && rawUnit) n /= 1000;
  return n;
}

// Pick the median-STOIIP realization (by total STOIIP) so the case has a
// deterministic representative breakdown for pivot/ball/cross-plot views.
function pickRepresentative(realizations) {
  if (!Array.isArray(realizations) || realizations.length === 0) return null;
  const stoiipOf = (rz) => parseFloat(rz.totals?.STOIIP ?? rz.totals?.['STOIIP (in oil)'] ?? 0) || 0;
  const sorted = [...realizations].sort((a, b) => stoiipOf(a) - stoiipOf(b));
  return sorted[Math.floor(sorted.length / 2)];
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

  // ── Multi-row header (Petrel Single line format) ──
  const propertyCells = headerLine.split('\t');
  const upperRows = findUpperHeaders(nonEmptyLines, headerIdx, propertyCells);
  if (upperRows.length > 0) {
    return buildMultiRunResult(
      parseMultiRowHeader(propertyCells, upperRows, dataLines, divideBy1000),
      petrelMeta,
    );
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

  // ── Single-line totals: each row is a realization ──
  // ≥2 rows → bundle into one multirun case; 1 row → single regular case.
  if (formatResult.format === FORMAT.SINGLE_LINE_TOTALS) {
    const caseCol = groupColumns[0] || null;
    const realizations = data.map((row, idx) => {
      const totals = {};
      for (const v of volumes) totals[v.name] = parseFloat(row[v.name]) || 0;
      return {
        name: caseCol ? String(row[caseCol] || `Run ${idx + 1}`) : `Run ${idx + 1}`,
        totals,
        breakdown: [],
      };
    });

    if (realizations.length >= 2) {
      qc.caseCount = 1;
      qc.runCount = realizations.length;
      return {
        data: [makeRepRowFromTotals(realizations, caseCol)],
        headers, units, rawUnits,
        format: formatResult.format,
        isMultiRun: true,
        runs: realizations,
        groupColumns: [],
        groupLabels: [],
        qc, errors: errors.length > 0 ? errors : null,
        columnMap: headerInfo.columnMap,
      };
    }

    qc.caseCount = 1;
    qc.runCount = 1;
    return {
      data, headers, units, rawUnits,
      format: formatResult.format,
      groupColumns, cases: null,
      qc, errors: errors.length > 0 ? errors : null,
      columnMap: headerInfo.columnMap,
    };
  }

  // ── Standard table = one case ──
  qc.caseCount = 1;

  return {
    data, headers, units, rawUnits,
    format: formatResult.format,
    groupColumns, cases: null,
    qc, errors: errors.length > 0 ? errors : null,
    columnMap: headerInfo.columnMap,
  };
}

// Build the parser result for a multirun case (Format 4: Petrel multi-row header).
function buildMultiRunResult(parsed, petrelMeta) {
  const { realizations, units, rawUnits, groupLabels, errors, caseIdName } = parsed;
  if (realizations.length === 0) {
    return { error: 'No realizations parsed from the pasted data.' };
  }

  const rep = pickRepresentative(realizations);
  const data = (rep && rep.breakdown && rep.breakdown.length > 0)
    ? rep.breakdown
    : [makeRepRowFromTotals(realizations, null, groupLabels)];

  // Column inventory for QC display
  const volumeNames = new Set();
  for (const rz of realizations) {
    for (const k of Object.keys(rz.totals)) volumeNames.add(k);
    for (const br of rz.breakdown) {
      for (const k of Object.keys(br)) {
        if (!groupLabels.includes(k)) volumeNames.add(k);
      }
    }
  }
  const volumeColumns = [...volumeNames].map((name) => ({ name, unit: units[name] || '' }));

  const headers = [...groupLabels, ...volumeNames];

  return {
    data,
    headers,
    units,
    rawUnits,
    format: FORMAT.MULTI_ROW_HEADER,
    isMultiRun: true,
    runs: realizations,
    groupColumns: groupLabels,
    groupLabels,
    qc: {
      format: FORMAT.MULTI_ROW_HEADER,
      formatLabel: FORMAT_LABELS[FORMAT.MULTI_ROW_HEADER],
      rowCount: data.length,
      columnCount: headers.length,
      groupColumns: groupLabels,
      volumeColumns,
      petrelMeta,
      caseCount: 1,
      runCount: realizations.length,
      caseIdName,
      errors: errors.length > 0 ? errors : null,
    },
    errors: errors.length > 0 ? errors : null,
    columnMap: {},
  };
}

// When the multirun case has no zone breakdown (e.g. Format 2 with N rows, or
// Format 4 where every property is a total), synthesise a single representative
// row from the median realization so existing single-row pivot/ball views work.
function makeRepRowFromTotals(realizations, caseCol, groupLabels = []) {
  const rep = pickRepresentative(realizations) || realizations[0];
  const row = {};
  for (const g of groupLabels) row[g] = 'All';
  if (caseCol) row[caseCol] = rep.name;
  if (rep && rep.totals) Object.assign(row, rep.totals);
  return row;
}
