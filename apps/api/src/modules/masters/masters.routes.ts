import { Router } from 'express';
import { requirePermission } from '../../core/auth/auth.middleware';
import { handle } from '../../core/http';
import { mastersController as c } from './masters.controller';
import * as S from './masters.schemas';

/** /api/v1 masters: vendors, buyers, items, processes, locations, users, roles (A§8). */
export const mastersRouter = Router();
const view = requirePermission('masters.view');
const edit = requirePermission('masters.edit');
const created = { status: 201 };

mastersRouter.get('/processes', view, handle({ query: S.zMasterListQuery }, c.listProcesses));
mastersRouter.post('/processes', edit, handle({ body: S.zProcessInput }, c.createProcess, created));
mastersRouter.patch('/processes/:id', edit, handle({ params: S.zIdParam, body: S.zProcessUpdate }, c.updateProcess));
mastersRouter.post('/processes/:id/activate', edit, handle({ params: S.zIdParam }, c.activateProcess));
mastersRouter.post('/processes/:id/deactivate', edit, handle({ params: S.zIdParam }, c.deactivateProcess));

mastersRouter.get('/vendors', view, handle({ query: S.zVendorListQuery }, c.listVendors));
mastersRouter.get('/vendors/:id', view, handle({ params: S.zIdParam }, c.getVendor));
mastersRouter.post('/vendors', edit, handle({ body: S.zVendorInput }, c.createVendor, created));
mastersRouter.patch('/vendors/:id', edit, handle({ params: S.zIdParam, body: S.zVendorUpdate }, c.updateVendor));
mastersRouter.post('/vendors/:id/activate', edit, handle({ params: S.zIdParam }, c.activateVendor));
mastersRouter.post('/vendors/:id/deactivate', edit, handle({ params: S.zIdParam }, c.deactivateVendor));

mastersRouter.get('/buyers', view, handle({ query: S.zMasterListQuery }, c.listBuyers));
mastersRouter.get('/buyers/:id', view, handle({ params: S.zIdParam }, c.getBuyer));
mastersRouter.post('/buyers', edit, handle({ body: S.zBuyerInput }, c.createBuyer, created));
mastersRouter.patch('/buyers/:id', edit, handle({ params: S.zIdParam, body: S.zBuyerUpdate }, c.updateBuyer));
mastersRouter.post('/buyers/:id/activate', edit, handle({ params: S.zIdParam }, c.activateBuyer));
mastersRouter.post('/buyers/:id/deactivate', edit, handle({ params: S.zIdParam }, c.deactivateBuyer));

mastersRouter.get('/items', view, handle({ query: S.zItemListQuery }, c.listItems));
mastersRouter.get('/items/:id', view, handle({ params: S.zIdParam }, c.getItem));
mastersRouter.post('/items', edit, handle({ body: S.zItemInput }, c.createItem, created));
mastersRouter.patch('/items/:id', edit, handle({ params: S.zIdParam, body: S.zItemUpdate }, c.updateItem));
mastersRouter.post('/items/:id/activate', edit, handle({ params: S.zIdParam }, c.activateItem));
mastersRouter.post('/items/:id/deactivate', edit, handle({ params: S.zIdParam }, c.deactivateItem));

mastersRouter.get('/locations', view, handle({ query: S.zLocationListQuery }, c.listLocations));

mastersRouter.get('/users', requirePermission('users.view'), handle({ query: S.zMasterListQuery }, c.listUsers));
mastersRouter.get('/users/:id', requirePermission('users.view'), handle({ params: S.zIdParam }, c.getUser));
mastersRouter.post('/users', requirePermission('users.manage'), handle({ body: S.zUserCreate }, c.createUser, created));
mastersRouter.patch('/users/:id', requirePermission('users.manage'), handle({ params: S.zIdParam, body: S.zUserUpdate }, c.updateUser));
mastersRouter.post('/users/:id/activate', requirePermission('users.manage'), handle({ params: S.zIdParam }, c.activateUser));
mastersRouter.post('/users/:id/deactivate', requirePermission('users.manage'), handle({ params: S.zIdParam }, c.deactivateUser));
mastersRouter.post(
  '/users/:id/reset-password',
  requirePermission('users.manage'),
  handle({ params: S.zIdParam, body: S.zResetPassword }, c.resetPassword),
);

mastersRouter.get('/roles', requirePermission('users.view'), handle({}, c.listRoles));
mastersRouter.get('/permissions', requirePermission('users.view'), handle({}, c.listPermissions));
mastersRouter.post('/roles', requirePermission('roles.manage'), handle({ body: S.zRoleInput }, c.createRole, created));
mastersRouter.patch('/roles/:id', requirePermission('roles.manage'), handle({ params: S.zIdParam, body: S.zRoleUpdate }, c.updateRole));
