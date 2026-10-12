import { type SeriesCode, formatDocNo, fyCodeFor } from '@wewin/shared';
import { env } from '../../config/env';
import { type Tx } from '../db';
import { AppError } from '../errors/app-error';

/**
 * Per-series, per-financial-year document numbers (A§5, D-06).
 * Must be called inside the posting transaction: the increment rolls back with it, so numbers are
 * gap-free, and the row lock (ON CONFLICT DO UPDATE) means two concurrent posts never share a number.
 */
export const numbering = {
  async next(seriesCode: SeriesCode, docDate: string, tx: Tx): Promise<{ docNo: string; fyCode: string; seq: number }> {
    const series = await tx.documentSeries.findUnique({ where: { code: seriesCode } });
    if (!series?.isActive) {
      throw new AppError('SERIES_NOT_CONFIGURED', `Document series ${seriesCode} is not configured`, 500);
    }
    const fyCode = fyCodeFor(docDate, env.FY_START_MONTH);
    const rows = await tx.$queryRaw<{ last_no: number }[]>`
      INSERT INTO number_series (id, series_code, fy_code, last_no, updated_at)
      VALUES (gen_random_uuid(), ${seriesCode}, ${fyCode}, 1, now())
      ON CONFLICT (series_code, fy_code)
      DO UPDATE SET last_no = number_series.last_no + 1, updated_at = now()
      RETURNING last_no`;
    const seq = Number(rows[0]!.last_no);
    return { docNo: formatDocNo(series.prefix, fyCode, seq, series.padding), fyCode, seq };
  },
};
