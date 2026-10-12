import { type Router } from 'express';
import { stockRouter } from './stock/stock.routes';
import { mastersRouter } from './masters/masters.routes';

/** Business module routers, mounted under /api/v1 after authentication. */
export const moduleRouters: Router[] = [stockRouter, mastersRouter];
