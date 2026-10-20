import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface OrderDetail {
  id: string;
  orderNo: string;
  /** Set when the order was created from a scanned buyer PO. */
  sourceScanId: string | null;
  buyerId: string;
  buyerPoNo: string;
  poDate: string;
  shipDate: string | null;
  styleNo: string;
  styleName: string | null;
  description: string | null;
  garmentItemId: string;
  currency: string;
  colours: string[];
  sizes: string[];
  status: 'DRAFT' | 'CONFIRMED' | 'CLOSED' | 'CANCELLED';
  remarks: string | null;
  version: number;
  confirmedAt: string | null;
  buyer: { id: string; code: string; name: string; currency: string };
  garmentItem: { id: string; code: string; name: string };
  lines: { id: string; colour: string; size: string; qty: number; unitPrice: string | null }[];
  components: { id: string; code: string; name: string; panelItemId: string; pcsPerGarment: number; panelItem: { code: string; name: string } }[];
  programs: { id: string; programNo: string; status: string; requiredKg: string; fabricItem: { code: string; name: string } }[];
  totals: { pcs: number; value: string; fullyPriced: boolean; byColour: Record<string, number>; bySize: Record<string, number> };
}

export function useOrder(id: string | undefined) {
  return useQuery({
    queryKey: ['order', id],
    queryFn: () => api.get<OrderDetail>(`/orders/${id}`),
    enabled: !!id && id !== 'new',
  });
}

export const pickers = {
  buyer: (r: never) => {
    const b = r as { id: string; code: string; name: string; currency: string };
    return { id: b.id, label: `${b.name}`, sublabel: `${b.code} · ${b.currency}`, data: b };
  },
  item: (r: never) => {
    const i = r as { id: string; code: string; name: string; unit: string };
    return { id: i.id, label: i.name, sublabel: `${i.code} · ${i.unit}`, data: i };
  },
  vendor: (r: never) => {
    const v = r as { id: string; code: string; name: string; city: string | null };
    return { id: v.id, label: v.name, sublabel: [v.code, v.city].filter(Boolean).join(' · '), data: v };
  },
  order: (r: never) => {
    const o = r as { id: string; orderNo: string; styleNo: string; buyer: { name: string }; status: string };
    return { id: o.id, label: `${o.orderNo} · ${o.styleNo}`, sublabel: `${o.buyer.name} · ${o.status}`, data: o };
  },
};
