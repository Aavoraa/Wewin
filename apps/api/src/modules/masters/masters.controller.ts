import { ListResult, type HandlerInput } from '../../core/http';
import { mastersService as svc } from './masters.service';
import { usersService } from './users.service';
import type * as S from './masters.schemas';

type In<T extends object> = HandlerInput<T>;
const list = <T>(r: { rows: T[]; total: number; p: { page: number; pageSize: number } }) =>
  new ListResult(r.rows, { page: r.p.page, pageSize: r.p.pageSize, total: r.total });

export const mastersController = {
  // Processes
  listProcesses: async ({ query }: In<{ query: typeof S.zMasterListQuery }>) => list(await svc.listProcesses(query)),
  createProcess: ({ body }: In<{ body: typeof S.zProcessInput }>) => svc.createProcess(body),
  updateProcess: ({ params, body }: In<{ params: typeof S.zIdParam; body: typeof S.zProcessUpdate }>) => svc.updateProcess(params.id, body),
  activateProcess: ({ params }: In<{ params: typeof S.zIdParam }>) => svc.setProcessActive(params.id, true),
  deactivateProcess: ({ params }: In<{ params: typeof S.zIdParam }>) => svc.setProcessActive(params.id, false),

  // Vendors
  listVendors: async ({ query }: In<{ query: typeof S.zVendorListQuery }>) => list(await svc.listVendors(query)),
  getVendor: ({ params }: In<{ params: typeof S.zIdParam }>) => svc.getVendor(params.id),
  createVendor: ({ body }: In<{ body: typeof S.zVendorInput }>) => svc.createVendor(body),
  updateVendor: ({ params, body }: In<{ params: typeof S.zIdParam; body: typeof S.zVendorUpdate }>) => svc.updateVendor(params.id, body),
  activateVendor: ({ params }: In<{ params: typeof S.zIdParam }>) => svc.setVendorActive(params.id, true),
  deactivateVendor: ({ params }: In<{ params: typeof S.zIdParam }>) => svc.setVendorActive(params.id, false),

  // Buyers
  listBuyers: async ({ query }: In<{ query: typeof S.zMasterListQuery }>) => list(await svc.listBuyers(query)),
  getBuyer: ({ params }: In<{ params: typeof S.zIdParam }>) => svc.getBuyer(params.id),
  createBuyer: ({ body }: In<{ body: typeof S.zBuyerInput }>) => svc.createBuyer(body),
  updateBuyer: ({ params, body }: In<{ params: typeof S.zIdParam; body: typeof S.zBuyerUpdate }>) => svc.updateBuyer(params.id, body),
  activateBuyer: ({ params }: In<{ params: typeof S.zIdParam }>) => svc.setBuyerActive(params.id, true),
  deactivateBuyer: ({ params }: In<{ params: typeof S.zIdParam }>) => svc.setBuyerActive(params.id, false),

  // Items
  listItems: async ({ query }: In<{ query: typeof S.zItemListQuery }>) => list(await svc.listItems(query)),
  getItem: ({ params }: In<{ params: typeof S.zIdParam }>) => svc.getItem(params.id),
  createItem: ({ body }: In<{ body: typeof S.zItemInput }>) => svc.createItem(body),
  updateItem: ({ params, body }: In<{ params: typeof S.zIdParam; body: typeof S.zItemUpdate }>) => svc.updateItem(params.id, body),
  activateItem: ({ params }: In<{ params: typeof S.zIdParam }>) => svc.setItemActive(params.id, true),
  deactivateItem: ({ params }: In<{ params: typeof S.zIdParam }>) => svc.setItemActive(params.id, false),

  // Locations
  listLocations: async ({ query }: In<{ query: typeof S.zLocationListQuery }>) => list(await svc.listLocations(query)),

  // Users
  listUsers: async ({ query }: In<{ query: typeof S.zMasterListQuery }>) => list(await usersService.list(query)),
  getUser: ({ params }: In<{ params: typeof S.zIdParam }>) => usersService.get(params.id),
  createUser: ({ body }: In<{ body: typeof S.zUserCreate }>) => usersService.create(body),
  updateUser: ({ params, body }: In<{ params: typeof S.zIdParam; body: typeof S.zUserUpdate }>) => usersService.update(params.id, body),
  activateUser: ({ params, user }: In<{ params: typeof S.zIdParam }>) => usersService.setActive(params.id, true, user.id),
  deactivateUser: ({ params, user }: In<{ params: typeof S.zIdParam }>) => usersService.setActive(params.id, false, user.id),
  resetPassword: ({ params, body }: In<{ params: typeof S.zIdParam; body: typeof S.zResetPassword }>) =>
    usersService.resetPassword(params.id, body.password),

  // Roles
  listRoles: () => usersService.listRoles(),
  listPermissions: async () => usersService.allPermissions(),
  createRole: ({ body }: In<{ body: typeof S.zRoleInput }>) => usersService.createRole(body),
  updateRole: ({ params, body }: In<{ params: typeof S.zIdParam; body: typeof S.zRoleUpdate }>) => usersService.updateRole(params.id, body),
};
