import ExcelJS from 'exceljs';
import { OPENING_TEMPLATES, type OpeningKind, type OpeningRowError } from '@wewin/shared';
import { AppError } from '../../core/errors/app-error';

/** Template workbook: one data sheet per template sheet (bold headers, required ones marked *) + instructions. */
export function buildTemplate(kind: OpeningKind) {
  const t = OPENING_TEMPLATES[kind];
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Wewin ERP';
  for (const s of t.sheets) {
    const ws = wb.addWorksheet(s.name, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = s.columns.map((c) => ({ header: c.required ? `${c.header} *` : c.header, key: c.key, width: Math.max(14, c.header.length + 4) }));
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
    // Text format so codes like 0012 and dates typed as DD-MM-YYYY are kept exactly as typed.
    s.columns.forEach((_c, i) => (ws.getColumn(i + 1).numFmt = '@'));
  }
  const help = wb.addWorksheet('Instructions');
  help.columns = [{ width: 24 }, { width: 28 }, { width: 10 }, { width: 22 }, { width: 60 }];
  help.addRow([t.title]).font = { bold: true, size: 14 };
  help.addRow([t.description]);
  help.addRow(['Fill the data sheet(s) from row 2. Columns marked * are required. Do not rename sheets or headers.']);
  help.addRow([]);
  for (const s of t.sheets) {
    help.addRow([`Sheet “${s.name}”`]).font = { bold: true };
    help.addRow(['Column', 'Header', 'Required', 'Example', 'Notes']).font = { bold: true };
    for (const c of s.columns) help.addRow([c.key, c.header, c.required ? 'yes' : '', c.example, c.note ?? '']);
    help.addRow([]);
  }
  return wb;
}

/** Cell → text: dates as YYYY-MM-DD, formulas by their result, rich text joined. */
function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('text' in v) return String(v.text);
    return '';
  }
  return String(v).trim();
}

export interface RawRow {
  row: number;
  values: Record<string, string>;
}

/** Read every template sheet by header text (order-independent); blank rows are skipped. */
export async function readWorkbook(buf: Buffer, kind: OpeningKind, maxRows = 5000) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw new AppError('VALIDATION_ERROR', 'The file is not a readable .xlsx workbook', 400);
  }
  const problems: OpeningRowError[] = [];
  const sheets: Record<string, RawRow[]> = {};
  for (const s of OPENING_TEMPLATES[kind].sheets) {
    const ws = wb.getWorksheet(s.name);
    sheets[s.name] = [];
    if (!ws) {
      problems.push({ sheet: s.name, row: 0, message: `Sheet “${s.name}” is missing — use the template` });
      continue;
    }
    const header = new Map<string, number>();
    ws.getRow(1).eachCell((cell, n) => header.set(cellText(cell.value).replace(/\s*\*$/, '').toLowerCase(), n));
    const colOf = new Map<string, number>();
    for (const c of s.columns) {
      const n = header.get(c.header.toLowerCase());
      if (n) colOf.set(c.key, n);
      else if (c.required) problems.push({ sheet: s.name, row: 1, field: c.key, message: `Column “${c.header}” is missing` });
    }
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const values: Record<string, string> = {};
      for (const c of s.columns) values[c.key] = colOf.has(c.key) ? cellText(row.getCell(colOf.get(c.key)!).value) : '';
      if (Object.values(values).every((v) => v === '')) continue;
      if (sheets[s.name]!.length >= maxRows) {
        problems.push({ sheet: s.name, row: r, message: `More than ${maxRows} rows — split the file` });
        break;
      }
      sheets[s.name]!.push({ row: r, values });
    }
  }
  return { sheets, problems };
}
