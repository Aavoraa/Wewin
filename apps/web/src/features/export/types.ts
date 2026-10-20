export interface ExportInvoice {
  id: string;
  docNo: string | null;
  docDate: string;
  buyerId: string;
  currency: string;
  exchangeRate: string;
  incoterm: string;
  portOfLoading: string;
  portOfDischarge: string;
  finalDestination: string | null;
  countryOfDestination: string;
  paymentTerms: string | null;
  underLut: boolean;
  lutNumber: string | null;
  igstRatePct: string | null;
  totalPcs: number;
  fobValue: string;
  inrValue: string;
  igstAmountInr: string;
  remarks: string | null;
  status: string;
  version: number;
  postedAt: string | null;
  shipmentId: string | null;
  declaration: string;
  buyer: { id: string; code: string; name: string; country: string | null; addressLine1: string | null; addressLine2: string | null; city: string | null; currency: string };
  lines: { id: string; lineNo: number; orderId: string; colour: string; size: string; pcs: number; unitPrice: string; amount: string; order: { id: string; orderNo: string; styleNo: string; styleName: string | null; buyerPoNo: string } }[];
  packingLists: { id: string; docNo: string | null; docDate: string | null; status: string; orderId: string }[];
  shipment: { id: string; docNo: string | null; docDate: string | null; status: string } | null;
  allocations: { amountFc: string; receipt: { id: string; docNo: string | null; docDate: string | null; exchangeRate: string } }[];
  figures: { realisedFc: string; outstandingFc: string; realisation: 'UNREALISED' | 'PARTIAL' | 'REALISED' | null; exchangeDifferenceInr: string };
}

export interface PlCandidate {
  id: string;
  docNo: string;
  docDate: string;
  order: { id: string; orderNo: string; styleNo: string; buyerPoNo: string; currency: string };
  cartons: number;
  pcs: number;
  grossKg: string;
  netKg: string;
}

export interface Shipment {
  id: string;
  docNo: string | null;
  docDate: string;
  buyerId: string;
  mode: 'SEA' | 'AIR' | 'COURIER' | 'ROAD';
  shippingBillNo: string | null;
  shippingBillDate: string | null;
  portCode: string | null;
  blAwbNo: string | null;
  blAwbDate: string | null;
  carrier: string | null;
  vesselFlight: string | null;
  containerNo: string | null;
  sealNo: string | null;
  forwarder: string | null;
  etd: string | null;
  eta: string | null;
  draftInvoiceIds: string[];
  remarks: string | null;
  status: string;
  version: number;
  postedAt: string | null;
  buyer: { id: string; code: string; name: string; country: string | null };
  invoices: { id: string; docNo: string | null; docDate: string | null; totalPcs: number; fobValue: string; currency: string; portOfLoading: string; portOfDischarge: string }[];
  draftInvoices: ExportInvoice[];
}

export interface BuyerReceipt {
  id: string;
  docNo: string | null;
  docDate: string;
  buyerId: string;
  currency: string;
  amountFc: string;
  bankChargesFc: string;
  exchangeRate: string;
  amountInr: string;
  bankReference: string | null;
  firaNo: string | null;
  remarks: string | null;
  status: string;
  version: number;
  postedAt: string | null;
  buyer: { id: string; code: string; name: string; country: string | null };
  allocations: { id: string; invoiceId: string; amountFc: string; invoice: { id: string; docNo: string | null; docDate: string | null; fobValue: string; exchangeRate: string; currency: string } }[];
  allocatedFc: string;
  unallocatedFc: string;
}

export interface OpenExportInvoice {
  id: string;
  docNo: string;
  docDate: string;
  fobValue: string;
  exchangeRate: string;
  realisedFc: string;
  outstandingFc: string;
}
