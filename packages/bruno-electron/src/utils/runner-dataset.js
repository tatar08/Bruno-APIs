const path = require('node:path');

const MAX_DATASET_ROWS = 10000;
const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

const parseCsvRows = (input) => {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        field += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      if (field.length > 0) throw new Error('Invalid CSV: a quoted field must start after a delimiter');
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (quoted) throw new Error('Invalid CSV: unterminated quoted field');
  row.push(field);
  if (row.some((value) => value !== '') || rows.length === 0) rows.push(row);
  return rows;
};

const validateRows = (rows) => {
  if (!Array.isArray(rows)) throw new Error('Dataset JSON must be an array of objects');
  if (rows.length === 0) throw new Error('Dataset must contain at least one data row');
  if (rows.length > MAX_DATASET_ROWS) throw new Error(`Dataset cannot contain more than ${MAX_DATASET_ROWS} rows`);
  rows.forEach((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`Dataset row ${index + 1} must be an object`);
    Object.keys(row).forEach((key) => {
      if (!key.trim()) throw new Error(`Dataset row ${index + 1} contains an empty variable name`);
      if (BLOCKED_KEYS.has(key)) throw new Error(`Dataset variable name "${key}" is not allowed`);
    });
  });
  return rows;
};

const parseRunnerDataset = (content, filePath = 'dataset.json') => {
  const extension = path.extname(filePath).toLowerCase();
  const source = String(content).replace(/^\uFEFF/, '');
  let rows;
  if (extension === '.json') {
    try {
      const parsed = JSON.parse(source);
      rows = Array.isArray(parsed) ? parsed : parsed?.data;
    } catch (error) {
      throw new Error(`Invalid JSON dataset: ${error.message}`);
    }
  } else if (extension === '.csv') {
    const csvRows = parseCsvRows(source);
    if (csvRows.length < 2) throw new Error('CSV dataset must contain a header and at least one data row');
    const headers = csvRows.shift().map((header) => header.trim());
    if (headers.some((header) => !header)) throw new Error('CSV dataset contains an empty header');
    if (new Set(headers).size !== headers.length) throw new Error('CSV dataset contains duplicate headers');
    headers.forEach((header) => { if (BLOCKED_KEYS.has(header)) throw new Error(`Dataset variable name "${header}" is not allowed`); });
    rows = csvRows.filter((values) => values.some((value) => value !== '')).map((values) => {
      if (values.length > headers.length) throw new Error('CSV data row contains more values than the header');
      const row = {};
      headers.forEach((header, index) => { row[header] = values[index] ?? ''; });
      return row;
    });
  } else {
    throw new Error('Dataset file must use the .json or .csv extension');
  }
  validateRows(rows);
  return { format: extension.slice(1), rows, columns: [...new Set(rows.flatMap((row) => Object.keys(row)))] };
};

module.exports = { parseRunnerDataset, parseCsvRows, validateRows, MAX_DATASET_ROWS };
