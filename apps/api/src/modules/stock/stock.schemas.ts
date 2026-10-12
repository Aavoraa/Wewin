import { z } from 'zod';
import { zBoolString, zDate, zItemType, zListQuery } from '@wewin/shared';

export const zBalanceQuery = zListQuery.extend({
  itemId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  locationKind: z.enum(['OWN', 'VENDOR', 'VIRTUAL']).optional(),
  itemType: zItemType.optional(),
  orderId: z.string().uuid().optional(),
  lot: z.string().max(60).optional(),
  live: zBoolString.optional(),
});

export const zMovementQuery = zListQuery.extend({
  itemId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  orderId: z.string().uuid().optional(),
  sourceType: z.string().max(40).optional(),
  sourceId: z.string().uuid().optional(),
  from: zDate().optional(),
  to: zDate().optional(),
});
