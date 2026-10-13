import { z } from 'zod';
import { zListQuery } from './api';

export const ALERT_KINDS = ['DC_OVERDUE', 'GST_TIME_LIMIT', 'PAYMENT_DUE'] as const;
export const zAlertListQuery = zListQuery.extend({
  status: z.enum(['ACTIVE', 'ACKNOWLEDGED', 'RESOLVED', 'OPEN']).optional(),
  kind: z.enum(ALERT_KINDS).optional(),
});
export const zAlertCheck = z.object({ kind: z.enum(['DC', 'PAYMENT']) });
