import { D, garmentSets, trimsRequirement } from '@wewin/shared';
import { ordersService } from '../orders/orders.service';
import { programsService } from '../programs/programs.service';
import { trimsService } from '../trims/trims.service';
import { wipRepo as repo } from './wip.repo';


/**
 * Order WIP (B-Step 8): yarn → knitted → dyed → cut → sewn → packed (→ shipped) against the PO,
 * built from posted documents and the ledger, plus trims issued vs BOM requirement.
 */
export const wipService = {
  async forOrder(orderId: string) {
    const order = await ordersService.getDetail(orderId);
    const [sent, received, cutKg, cut, atVendors, sewn, packed, shipped, bom, issued] = await Promise.all([
      repo.sentByProcess(orderId),
      repo.receivedByProcess(orderId),
      repo.fabricCutKg(orderId),
      repo.cutPieces(orderId),
      repo.panelsAtVendors(orderId),
      repo.sewn(orderId),
      repo.packed(orderId),
      repo.shipped(orderId),
      programsService.getBom(orderId),
      trimsService.issuedForOrder(orderId),
    ]);
    const kg = (rows: { process: string; kg: { toString(): string } }[], p: string) => D(rows.find((r) => r.process === p)?.kg.toString() ?? 0).toFixed(3);
    const components = order.components.map((c) => ({ code: c.code, pcsPerGarment: c.pcsPerGarment }));

    const cells = order.lines.map((l) => {
      const pieces: Record<string, number> = {};
      for (const r of cut.filter((x) => x.colour === l.colour && x.size === l.size)) pieces[r.component_code] = Number(r.pcs);
      const num = (rows: { colour: string; size: string; pcs: { toString(): string } | bigint }[]) =>
        Number(rows.find((r) => r.colour === l.colour && r.size === l.size)?.pcs.toString() ?? 0);
      return {
        colour: l.colour,
        size: l.size,
        po: l.qty,
        cutSets: garmentSets(pieces, components),
        sewn: num(sewn),
        packed: num(packed),
        shipped: num(shipped),
      };
    });
    const total = (k: 'po' | 'cutSets' | 'sewn' | 'packed' | 'shipped') => cells.reduce((a, c) => a + c[k], 0);
    const po = total('po');
    const pct = (n: number) => (po ? D(n).div(po).times(100).toFixed(1) : '0.0');

    const stages = [
      { key: 'yarn', label: 'Yarn sent to knitting', unit: 'KG', qty: kg(sent, 'KNITTING') },
      { key: 'knitted', label: 'Knitted (greige received)', unit: 'KG', qty: kg(received, 'KNITTING') },
      { key: 'dyed', label: 'Dyed (received)', unit: 'KG', qty: kg(received, 'DYEING') },
      { key: 'compacted', label: 'Compacted (received)', unit: 'KG', qty: kg(received, 'COMPACTING') },
      { key: 'fabricCut', label: 'Fabric cut', unit: 'KG', qty: D(cutKg.toString()).toFixed(3) },
      { key: 'cut', label: 'Cut (garment sets)', unit: 'PCS', qty: String(total('cutSets')), pctOfPo: pct(total('cutSets')) },
      { key: 'atPrinting', label: 'Panels at printing / embroidery', unit: 'PCS', qty: D(atVendors.toString()).toFixed(0) },
      { key: 'sewn', label: 'Sewn', unit: 'PCS', qty: String(total('sewn')), pctOfPo: pct(total('sewn')) },
      { key: 'packed', label: 'Packed', unit: 'PCS', qty: String(total('packed')), pctOfPo: pct(total('packed')) },
      { key: 'shipped', label: 'Shipped', unit: 'PCS', qty: String(total('shipped')), pctOfPo: pct(total('shipped')) },
    ];

    const matrix = order.lines.map((l) => ({ colour: l.colour, size: l.size, qty: l.qty }));
    const trims = bom.map((b) => {
      const req = trimsRequirement({ colour: b.colour, size: b.size, qtyPerGarment: b.qtyPerGarment, wastagePct: b.wastagePct }, matrix);
      return { itemId: b.trimItemId, code: b.trimItem.code, name: b.trimItem.name, unit: b.trimItem.unit, colour: b.colour, size: b.size, required: req.rounded, issued: issued.get(b.trimItemId) ?? '0.000' };
    });

    return { order: { id: order.id, orderNo: order.orderNo, styleNo: order.styleNo, status: order.status, colours: order.colours, sizes: order.sizes }, poPcs: po, stages, cells, trims };
  },
};
