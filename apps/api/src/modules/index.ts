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
import { accountsRouter } from './accounts/accounts.routes';
import { alertsRouter } from './alerts/alerts.routes';
import { scansRouter } from './scans/scans.routes';
import { exportRouter } from './export/export.routes';
import { reportsRouter } from './reports/reports.routes';
import { attachmentsRouter } from './attachments/attachments.routes';
import { openingRouter } from './opening/opening.routes';

/** Business module routers, mounted under /api/v1 after authentication. */
export const moduleRouters: Router[] = [stockRouter, mastersRouter, ordersRouter, programsRouter, yarnRouter, jobworkRouter, cuttingRouter, panelsRouter, sewingRouter, packingRouter, trimsRouter, wipRouter, accountsRouter, alertsRouter, scansRouter, exportRouter, reportsRouter, attachmentsRouter, openingRouter];
