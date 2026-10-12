import { Prisma } from '@wewin/db';
import { prisma } from '../../core/db';

/** Read-only aggregate queries for order WIP (yarn → packed → shipped). */
export const wipRepo = {
  /** Kg sent to job workers per process (outward D.C.s posted or closed). */
  async sentByProcess(orderId: string) {
    return prisma.$queryRaw<{ process: string; kg: Prisma.Decimal }[]>`
      SELECT p.code AS process, COALESCE(SUM(l.qty_kg), 0) AS kg
      FROM outward_dcs d JOIN processes p ON p.id = d.process_id JOIN outward_dc_lines l ON l.dc_id = d.id
      WHERE d.order_id = ${orderId}::uuid AND d.status IN ('POSTED', 'CLOSED')
      GROUP BY p.code`;
  },
  /** Kg received back per process (inward D.C.s posted, credited via dc_links). */
  async receivedByProcess(orderId: string) {
    return prisma.$queryRaw<{ process: string; kg: Prisma.Decimal }[]>`
      SELECT p.code AS process, COALESCE(SUM(k.received_kg), 0) AS kg
      FROM dc_links k JOIN inward_dcs i ON i.id = k.inward_dc_id JOIN outward_dcs d ON d.id = k.outward_dc_id JOIN processes p ON p.id = d.process_id
      WHERE d.order_id = ${orderId}::uuid AND i.status = 'POSTED'
      GROUP BY p.code`;
  },
  async fabricCutKg(orderId: string) {
    const r = await prisma.$queryRaw<{ kg: Prisma.Decimal }[]>`
      SELECT COALESCE(SUM(r.kg_used), 0) AS kg FROM cut_lay_rolls r JOIN cut_lays l ON l.id = r.lay_id
      WHERE l.order_id = ${orderId}::uuid AND l.status = 'POSTED'`;
    return r[0]?.kg ?? new Prisma.Decimal(0);
  },
  cutPieces(orderId: string) {
    return prisma.$queryRaw<{ colour: string; size: string; component_code: string; pcs: bigint }[]>`
      SELECT b.colour, b.size, b.component_code, SUM(b.pcs)::bigint AS pcs
      FROM cut_bundles b JOIN cut_lays l ON l.id = b.lay_id
      WHERE b.order_id = ${orderId}::uuid AND l.status = 'POSTED'
      GROUP BY b.colour, b.size, b.component_code`;
  },
  /** Panels currently at printers / embroiderers (live ledger). */
  async panelsAtVendors(orderId: string) {
    const r = await prisma.$queryRaw<{ pcs: Prisma.Decimal }[]>`
      SELECT COALESCE(SUM(q), 0) AS pcs FROM (
        SELECT m.qty AS q FROM stock_movements m JOIN locations l ON l.id = m.to_location_id JOIN items i ON i.id = m.item_id
         WHERE m.order_id = ${orderId}::uuid AND l.kind = 'VENDOR' AND i.type = 'PANEL'
        UNION ALL
        SELECT -m.qty FROM stock_movements m JOIN locations l ON l.id = m.from_location_id JOIN items i ON i.id = m.item_id
         WHERE m.order_id = ${orderId}::uuid AND l.kind = 'VENDOR' AND i.type = 'PANEL'
      ) x`;
    return r[0]?.pcs ?? new Prisma.Decimal(0);
  },
  sewn(orderId: string) {
    return prisma.$queryRaw<{ colour: string; size: string; pcs: bigint }[]>`
      SELECT l.colour, l.size, SUM(l.pcs)::bigint AS pcs FROM sewing_entry_lines l JOIN sewing_entries e ON e.id = l.entry_id
      WHERE e.order_id = ${orderId}::uuid AND e.status = 'POSTED' GROUP BY l.colour, l.size`;
  },
  packed(orderId: string) {
    return prisma.$queryRaw<{ colour: string; size: string; pcs: bigint }[]>`
      SELECT l.colour, l.size, SUM(l.pcs)::bigint AS pcs FROM carton_lines l JOIN cartons c ON c.id = l.carton_id
      WHERE c.order_id = ${orderId}::uuid AND c.status = 'POSTED' GROUP BY l.colour, l.size`;
  },
  /** Garments shipped (net movements into SHIPPED for the order). */
  shipped(orderId: string) {
    return prisma.$queryRaw<{ colour: string; size: string; pcs: Prisma.Decimal }[]>`
      SELECT colour, size, SUM(q) AS pcs FROM (
        SELECT m.colour, m.size, m.qty AS q FROM stock_movements m JOIN locations l ON l.id = m.to_location_id WHERE m.order_id = ${orderId}::uuid AND l.code = 'SHIPPED'
        UNION ALL
        SELECT m.colour, m.size, -m.qty FROM stock_movements m JOIN locations l ON l.id = m.from_location_id WHERE m.order_id = ${orderId}::uuid AND l.code = 'SHIPPED'
      ) x GROUP BY colour, size`;
  },
};
