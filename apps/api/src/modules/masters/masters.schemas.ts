import { z } from 'zod';
export {
  zBuyerInput,
  zBuyerUpdate,
  zIdParam,
  zItemInput,
  zItemListQuery,
  zItemUpdate,
  zLocationListQuery,
  zMasterListQuery,
  zProcessInput,
  zResetPassword,
  zRoleInput,
  zRoleUpdate,
  zUserCreate,
  zUserUpdate,
  zVendorInput,
  zVendorListQuery,
  zVendorUpdate,
} from '@wewin/shared';
import { zProcessInput } from '@wewin/shared';

export const zProcessUpdate = zProcessInput.extend({ version: z.number().int().min(1) });
