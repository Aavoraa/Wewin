import { z } from 'zod';

/** Standard list query (A§8): ?page=&pageSize=&sort=&q=&filters */
export const zListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(25),
  sort: z
    .string()
    .regex(/^-?[a-zA-Z0-9_.]+$/)
    .optional(),
  q: z.string().trim().max(100).optional(),
});
export type ListQuery = z.infer<typeof zListQuery>;

export interface ListMeta {
  page: number;
  pageSize: number;
  total: number;
}
export interface ListResponse<T> {
  data: T[];
  meta: ListMeta;
}
export interface ItemResponse<T> {
  data: T;
}
export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export const zId = z.string().uuid();
/** Reference to another record in a form: empty → "Required". */
export const zRef = () => z.string({ required_error: 'Required' }).min(1, 'Required').uuid('Required');
export const zIdParam = z.object({ id: zId });
export const zVersion = z.object({ version: z.number().int().min(1) });
export const zReason = z.object({ reason: z.string().trim().min(3, 'Give a reason (min 3 characters)').max(500) });

export const zBoolString = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');
