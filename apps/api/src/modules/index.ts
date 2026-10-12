import { type Router } from 'express';
import { stockRouter } from './stock/stock.routes';

/** Business module routers, mounted under /api/v1 after authentication. */
export const moduleRouters: Router[] = [stockRouter];
