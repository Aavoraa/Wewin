import { z } from 'zod';
import { zCode } from './masters';
import { zCompanySettings } from './settings';

/**
 * Exporters and their units (Q-085). An exporter is a legal entity (letterhead, GSTIN, IEC, LUT, bank);
 * a unit is one of its factories / branches with its own documents, numbers, stock and reports.
 */
export const zExporterCreate = zCompanySettings.omit({ version: true }).extend({ code: zCode });
export type ExporterCreateInput = z.infer<typeof zExporterCreate>;
export const zExporterUpdate = zCompanySettings;

/** Put in front of every document number of the unit, e.g. "U2-" gives U2-OD/25-26/0001. */
export const zDocPrefix = z
  .string()
  .trim()
  .toUpperCase()
  .min(1, 'A prefix is needed so numbers never clash with another unit')
  .max(8)
  .regex(/^[A-Z0-9][A-Z0-9/-]*$/, 'Letters, digits, - and / only');

export const zUnitCreate = z.object({
  code: zCode,
  name: z.string().trim().min(2).max(100),
  exporterId: z.string().uuid(),
  docPrefix: zDocPrefix,
});
export type UnitCreateInput = z.infer<typeof zUnitCreate>;

/** Code, exporter and number prefix are fixed once created; only the name changes. */
export const zUnitUpdate = z.object({
  name: z.string().trim().min(2).max(100),
  version: z.number().int().min(1),
});

export const zSetActive = z.object({ isActive: z.boolean() });
