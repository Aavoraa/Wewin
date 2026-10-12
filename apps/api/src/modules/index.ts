import { type Router } from 'express';
import { stockRouter } from './stock/stock.routes';
import { mastersRouter } from './masters/masters.routes';
import { ordersRouter } from './orders/orders.routes';
import { programsRouter } from './programs/programs.routes';
import { yarnRouter } from './yarn/yarn.routes';
import { jobworkRouter } from './jobwork/jobwork.routes';
import { cuttingRouter } from './cutting/cutting.routes';
import { panelsRouter } from './panels/panels.routes';
import { sewingRouter } from './sewing/sewing.routes';
import { packingRouter } from './packing/packing.routes';
import { trimsRouter } from './trims/trims.routes';
import { wipRouter } from './wip/wip.routes';

/** Business module routers, mounted under /api/v1 after authentication. */
export const moduleRouters: Router[] = [stockRouter, mastersRouter, ordersRouter, programsRouter, yarnRouter, jobworkRouter, cuttingRouter, panelsRouter, sewingRouter, packingRouter, trimsRouter, wipRouter];
