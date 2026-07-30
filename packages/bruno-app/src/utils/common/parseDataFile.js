/**
 * Utility to parse CSV or JSON parameter files into an array of objects
 */

export const parseCSV = (text) => {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0) return [];

  const parseLine = (line) => {
    const values = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if ((char === ',' || char === '\t') && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());
    return values;
  };

  const headers = parseLine(lines[0]);
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i]);
    const rowObj = {};
    headers.forEach((header, index) => {
      rowObj[header] = values[index] !== undefined ? values[index] : '';
    });
    rows.push(rowObj);
  }

  return rows;
};

export const parseDataFileContent = (content, filename = '') => {
  if (!content) return [];

  const isJson = filename.endsWith('.json') || (typeof content === 'string' && content.trim().startsWith('['));

  if (isJson) {
    try {
      const parsed = typeof content === 'string' ? JSON.parse(content) : content;
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch (e) {
      throw new Error('Invalid JSON data file format');
    }
  }

  return parseCSV(String(content));
};
