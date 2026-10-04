// Strict comma-separated text parser. No IO, coercion, recovery or partial results.
export function validationError(code, sourceRowNumber, field) {
  return Object.assign(new Error(`${code}: row ${sourceRowNumber}, field ${field}`), { code, sourceRowNumber, field });
}
export function parseCsv(text) {
  if (typeof text !== 'string') throw validationError('INVALID_CSV_INPUT', 0, 'csv');
  const bom = text.startsWith('\uFEFF');
  const source = bom ? text.slice(1) : text;
  if (!source.length) throw validationError('EMPTY_CSV', 1, 'header');
  const records = [];
  let row = [], value = '', quoted = false, closed = false, line = 1, rowStart = 1;
  const endField = () => { row.push(value); value = ''; closed = false; };
  const endRow = () => { endField(); records.push({ values: row, sourceRowNumber: rowStart }); row = []; };
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') { value += '"'; i++; }
        else { quoted = false; closed = true; }
      } else {
        if (char === '\r' && source[i + 1] !== '\n') throw validationError('INVALID_LINE_ENDING', line, 'csv');
        value += char;
        if (char === '\n') line++;
      }
      continue;
    }
    if (closed && ![',', '\r', '\n'].includes(char)) throw validationError('INVALID_QUOTE', line, 'csv');
    if (char === '"') {
      if (value.length || closed) throw validationError('INVALID_QUOTE', line, 'csv');
      quoted = true;
    } else if (char === ',') endField();
    else if (char === '\n' || char === '\r') {
      if (char === '\r') {
        if (source[i + 1] !== '\n') throw validationError('INVALID_LINE_ENDING', line, 'csv');
        i++;
      }
      endRow(); line++; rowStart = line;
    } else value += char;
  }
  if (quoted) throw validationError('UNCLOSED_QUOTE', rowStart, 'csv');
  if (row.length || value.length || closed || source.endsWith(',')) endRow();
  const headers = records.shift()?.values;
  if (!headers?.length || headers.some(header => !header.trim()) || new Set(headers).size !== headers.length) throw validationError('INVALID_HEADER', 1, 'header');
  for (const row of records) if (row.values.length !== headers.length) throw validationError('COLUMN_COUNT_MISMATCH', row.sourceRowNumber, 'csv');
  const crlf = (source.match(/\r\n/g) || []).length;
  const lf = (source.match(/\n/g) || []).length - crlf;
  return { headers, rows: records, metadata: { bom, newline: crlf && lf ? 'mixed' : crlf ? 'CRLF' : lf ? 'LF' : 'none', rowCount: records.length } };
}
