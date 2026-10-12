import ExcelJS from 'exceljs';
import { type Response } from 'express';
import { z } from 'zod';
import { formatDateTimeIst } from '@wewin/shared';

export const EXPORT_MAX_ROWS = 20_000;

export const zExportColumns = z
  .array(
    z.object({
      key: z.string().regex(/^[a-zA-Z0-9_.]+$/),
      header: z.string().max(80),
      type: z.enum(['text', 'kg', 'qty', 'money', 'rate', 'pct', 'date', 'datetime', 'int']).optional(),
    }),
  )
  .min(1)
  .max(60);
export type ExportColumn = z.infer<typeof zExportColumns>[number];

const INR_FMT = '[>=10000000]##\\,##\\,##\\,##0.00;[>=100000]##\\,##\\,##0.00;##,##0.00';
const FORMATS: Record<string, string> = {
  kg: '#,##0.000',
  qty: '#,##0',
  int: '0',
  money: INR_FMT,
  rate: '#,##0.0000',
  pct: '0.00',
  date: 'dd-mm-yyyy',
};

function getPath(row: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), row);
}

function cellValue(v: unknown, type: ExportColumn['type']): ExcelJS.CellValue {
  if (v === null || v === undefined || v === '') return null;
  switch (type) {
    case 'kg':
    case 'qty':
    case 'money':
    case 'rate':
    case 'pct':
    case 'int':
      // Display conversion only (no arithmetic): Excel stores numbers as doubles.
      return Number(String(v));
    case 'date': {
      const s = v instanceof Date ? v.toISOString() : String(v);
      return new Date(`${s.slice(0, 10)}T00:00:00Z`);
    }
    case 'datetime':
      return formatDateTimeIst(v instanceof Date ? v : String(v));
    default:
      if (v instanceof Date) return formatDateTimeIst(v);
      if (typeof v === 'object') return JSON.stringify(v);
      return String(v);
  }
}

export async function buildWorkbook(opts: { title: string; columns: ExportColumn[]; rows: unknown[]; subtitle?: string }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Wewin ERP';
  wb.created = new Date();
  const ws = wb.addWorksheet(opts.title.slice(0, 31).replace(/[\\/?*[\]:]/g, '-'), {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  ws.columns = opts.columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: Math.max(10, Math.min(40, c.header.length + 4)),
    style: c.type && FORMATS[c.type] ? { numFmt: FORMATS[c.type] } : {},
  }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
  for (const r of opts.rows) {
    ws.addRow(Object.fromEntries(opts.columns.map((c) => [c.key, cellValue(getPath(r, c.key), c.type)])));
  }
  return wb;
}

export async function sendWorkbook(res: Response, fileName: string, wb: ExcelJS.Workbook) {
  const safe = fileName.replace(/[^a-zA-Z0-9_.-]/g, '_');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${safe}"`);
  await wb.xlsx.write(res);
  res.end();
}
