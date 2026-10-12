import { type Router } from 'express';
import { stockRouter } from './stock/stock.routes';
import { mastersRouter } from './masters/masters.routes';
import { ordersRouter } from './orders/orders.routes';
import { programsRouter } from './programs/programs.routes';
import { yarnRouter } from './yarn/yarn.routes';

/** Business module routers, mounted under /api/v1 after authentication. */
export const moduleRouters: Router[] = [stockRouter, mastersRouter, ordersRouter, programsRouter, yarnRouter];
