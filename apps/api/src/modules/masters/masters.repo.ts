import { type Prisma } from '@wewin/db';
import { type Tx, prisma } from '../../core/db';
import { type Paging } from '../../core/list';

/** Prisma queries for master data. No business rules. */
export const mastersRepo = {
  // ── Processes ──
  listProcesses(where: Prisma.ProcessWhereInput, order: Prisma.ProcessOrderByWithRelationInput, p: Paging) {
    return prisma.$transaction([
      prisma.process.findMany({ where, orderBy: order, skip: p.skip, take: p.take }),
      prisma.process.count({ where }),
    ]);
  },
  getProcess(id: string, tx: Tx | typeof prisma = prisma) {
    return tx.process.findUnique({ where: { id } });
  },
  processByCode(code: string, tx: Tx | typeof prisma = prisma) {
    return tx.process.findUnique({ where: { code } });
  },
  setProcessActive(tx: Tx, id: string, isActive: boolean) {
    return tx.process.update({ where: { id }, data: { isActive, version: { increment: 1 } } });
  },
  createProcess(tx: Tx, data: Prisma.ProcessCreateInput) {
    return tx.process.create({ data });
  },
  updateProcess(tx: Tx, id: string, version: number, data: Prisma.ProcessUpdateManyMutationInput) {
    return tx.process.updateMany({ where: { id, version }, data: { ...data, version: { increment: 1 } } });
  },

  // ── Vendors ──
  vendorsForMatching() {
    return prisma.vendor.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true, gstin: true, pan: true, stateCode: true, isActive: true } });
  },
  itemsForMatching(types: ('YARN' | 'TRIM' | 'FABRIC' | 'PANEL' | 'GARMENT')[]) {
    return prisma.item.findMany({ where: { isActive: true, type: { in: types } }, select: { id: true, code: true, name: true, spec: true, hsnCode: true, unit: true, type: true, isActive: true } });
  },
  itemsByIdsBrief(ids: string[]) {
    return prisma.item.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true, unit: true, type: true, isActive: true } });
  },
  listVendors(where: Prisma.VendorWhereInput, order: Prisma.VendorOrderByWithRelationInput, p: Paging) {
    return prisma.$transaction([
      prisma.vendor.findMany({
        where,
        orderBy: order,
        skip: p.skip,
        take: p.take,
        include: { processes: { include: { process: { select: { id: true, code: true, name: true } } } } },
      }),
      prisma.vendor.count({ where }),
    ]);
  },
  getVendor(id: string, tx: Tx | typeof prisma = prisma) {
    return tx.vendor.findUnique({
      where: { id },
      include: { processes: { include: { process: { select: { id: true, code: true, name: true, stage: true } } } } },
    });
  },
  createVendor(tx: Tx, data: Prisma.VendorCreateInput) {
    return tx.vendor.create({ data });
  },
  updateVendor(tx: Tx, id: string, version: number, data: Prisma.VendorUpdateManyMutationInput) {
    return tx.vendor.updateMany({ where: { id, version }, data: { ...data, version: { increment: 1 } } });
  },
  async setVendorProcesses(tx: Tx, vendorId: string, processIds: string[]) {
    await tx.vendorProcess.deleteMany({ where: { vendorId, processId: { notIn: processIds } } });
    await tx.vendorProcess.createMany({
      data: processIds.map((processId) => ({ vendorId, processId })),
      skipDuplicates: true,
    });
  },
  setVendorActive(tx: Tx, id: string, isActive: boolean) {
    return tx.vendor.update({ where: { id }, data: { isActive, version: { increment: 1 } } });
  },
  vendorLocation(tx: Tx | typeof prisma, vendorId: string) {
    return tx.location.findUnique({ where: { vendorId } });
  },
  createVendorLocation(tx: Tx, vendorId: string, code: string, name: string) {
    return tx.location.create({ data: { code, name, kind: 'VENDOR', vendorId } });
  },
  renameVendorLocation(tx: Tx, vendorId: string, name: string) {
    return tx.location.update({ where: { vendorId }, data: { name, version: { increment: 1 } } });
  },
  countProcesses(ids: string[]) {
    return prisma.process.count({ where: { id: { in: ids } } });
  },

  // ── Buyers ──
  listBuyers(where: Prisma.BuyerWhereInput, order: Prisma.BuyerOrderByWithRelationInput, p: Paging) {
    return prisma.$transaction([
      prisma.buyer.findMany({ where, orderBy: order, skip: p.skip, take: p.take }),
      prisma.buyer.count({ where }),
    ]);
  },
  getBuyer(id: string, tx: Tx | typeof prisma = prisma) {
    return tx.buyer.findUnique({ where: { id } });
  },
  buyersForMatching() {
    return prisma.buyer.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true, currency: true } });
  },
  setBuyerActive(tx: Tx, id: string, isActive: boolean) {
    return tx.buyer.update({ where: { id }, data: { isActive, version: { increment: 1 } } });
  },
  createBuyer(tx: Tx, data: Prisma.BuyerCreateInput) {
    return tx.buyer.create({ data });
  },
  updateBuyer(tx: Tx, id: string, version: number, data: Prisma.BuyerUpdateManyMutationInput) {
    return tx.buyer.updateMany({ where: { id, version }, data: { ...data, version: { increment: 1 } } });
  },

  // ── Items ──
  listItems(where: Prisma.ItemWhereInput, order: Prisma.ItemOrderByWithRelationInput, p: Paging) {
    return prisma.$transaction([
      prisma.item.findMany({ where, orderBy: order, skip: p.skip, take: p.take }),
      prisma.item.count({ where }),
    ]);
  },
  getItem(id: string, tx: Tx | typeof prisma = prisma) {
    return tx.item.findUnique({ where: { id } });
  },
  setItemActive(tx: Tx, id: string, isActive: boolean) {
    return tx.item.update({ where: { id }, data: { isActive, version: { increment: 1 } } });
  },
  createItem(tx: Tx, data: Prisma.ItemCreateInput) {
    return tx.item.create({ data });
  },
  updateItem(tx: Tx, id: string, version: number, data: Prisma.ItemUpdateManyMutationInput) {
    return tx.item.updateMany({ where: { id, version }, data: { ...data, version: { increment: 1 } } });
  },
  itemHasMovements(tx: Tx, itemId: string) {
    return tx.stockMovement.count({ where: { itemId } });
  },

  // ── Locations ──
  listLocations(where: Prisma.LocationWhereInput, order: Prisma.LocationOrderByWithRelationInput, p: Paging) {
    return prisma.$transaction([
      prisma.location.findMany({ where, orderBy: order, skip: p.skip, take: p.take }),
      prisma.location.count({ where }),
    ]);
  },
  locationByCode(code: string, tx: Tx | typeof prisma = prisma) {
    return tx.location.findUnique({ where: { code } });
  },
  locationsByCodes(codes: string[], tx: Tx | typeof prisma = prisma) {
    return tx.location.findMany({ where: { code: { in: codes } } });
  },
  getLocation(id: string, tx: Tx | typeof prisma = prisma) {
    return tx.location.findUnique({ where: { id } });
  },
};
