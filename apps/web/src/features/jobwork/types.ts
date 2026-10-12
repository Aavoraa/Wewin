import { type LossBand } from '@wewin/shared';

export interface LossInfo {
  sentKg: string;
  receivedKg: string;
  lossKg: string;
  lossPct: string;
  allowedPct: string;
  allowedKg: string;
  excessKg: string;
  final: boolean;
  band: LossBand;
}

export interface OutwardDc {
  id: string;
  docNo: string | null;
  docDate: string;
  vendorId: string;
  programProcessId: string;
  processId: string;
  orderId: string;
  fromLocationId: string;
  expectedReturnDate: string | null;
  purpose: string;
  vehicleNo: string | null;
  remarks: string | null;
  status: string;
  version: number;
  postedAt: string | null;
  closedAt: string | null;
  closeReason: string | null;
  cancelReason: string | null;
  allowedLossPct: string;
  vendor: { id: string; code: string; name: string; gstin: string | null; addressLine1: string | null; addressLine2: string | null; city: string | null; state: string | null; stateCode: string | null; pincode: string | null };
  process: { id: string; code: string; name: string; defaultReturnDays: number };
  order: { id: string; orderNo: string; styleNo: string; status: string };
  fromLocation: { id: string; code: string; name: string; kind: string; vendorId: string | null };
  programProcess: { id: string; sequence: number; allowedLossPct: string; inputItemId: string; outputItemId: string; program: { id: string; programNo: string } };
  lines: {
    id: string;
    lineNo: number;
    itemId: string;
    lot: string;
    colour: string;
    rollId: string | null;
    qtyKg: string;
    rolls: number | null;
    valuePerKg: string | null;
    value: string | null;
    consumedKg: string;
    remainingKg: string;
    item: { id: string; code: string; name: string; hsnCode: string | null; type: string };
    roll: { id: string; rollNo: string } | null;
  }[];
  totals: { sentKg: string; value: string; rolls: number };
  loss: LossInfo;
  pendingKg: string;
  overdue: boolean;
  inwards?: { id: string; docNo: string | null; docDate: string | null; status: string; billId: string | null; receivedKg: string }[];
}

export interface PendingOutward {
  id: string;
  docNo: string;
  docDate: string;
  expectedReturnDate: string | null;
  orderNo: string;
  process: string;
  programNo: string;
  outputItemId: string;
  sentKg: string;
  receivedKg: string;
  pendingKg: string;
  allowedLossPct: string;
  nearThresholdPct: string;
  lots: string[];
  colours: string[];
}

export interface InwardDc {
  id: string;
  docNo: string | null;
  docDate: string;
  vendorId: string;
  vendorDcNo: string | null;
  vendorDcDate: string | null;
  holdAtVendor: boolean;
  vehicleNo: string | null;
  remarks: string | null;
  status: string;
  version: number;
  postedAt: string | null;
  billId: string | null;
  cancelReason: string | null;
  vendor: { id: string; code: string; name: string; gstin: string | null };
  toLocation: { id: string; code: string; name: string; kind: string };
  lines: { id: string; lineNo: number; itemId: string; rollNo: string; kg: string; lot: string; colour: string; gsm: number | null; dia: string | null; remarks: string | null; item: { code: string; name: string; hsnCode: string | null }; roll: { id: string; rollNo: string } | null }[];
  links: {
    id: string;
    outwardDcId: string;
    receivedKg: string;
    outward: { id: string; docNo: string | null; docDate: string | null; status: string; allowedLossPct: string | null; process: { code: string; name: string } };
  }[];
  totals: { kg: string; rolls: number };
}
