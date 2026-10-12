import { Router } from 'express';
import { zIdParam } from '@wewin/shared';
import { requirePermission } from '../../core/auth/auth.middleware';
import { handle } from '../../core/http';
import { wipService } from './wip.service';

/** /api/v1/orders/:id/wip — order work-in-progress from yarn to packed garments. */
export const wipRouter = Router();
wipRouter.get('/orders/:id/wip', requirePermission('orders.view'), handle({ params: zIdParam }, ({ params }) => wipService.forOrder(params.id)));
