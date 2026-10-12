import { PRINT_TEMPLATES } from './PrintRoute';
import { YarnReceiptPrint } from './YarnReceiptPrint';
import { InwardDcPrint, OutwardDcPrint, RollLabelsPrint } from './JobworkPrints';
import { BundleTicketsPrint, CartonLabelPrint, PackingListPrint, PanelDcPrint } from './ProductionPrints';

/** Print templates by document type (A§11). */
PRINT_TEMPLATES['yarn-receipt'] = YarnReceiptPrint;
PRINT_TEMPLATES['outward-dc'] = OutwardDcPrint;
PRINT_TEMPLATES['inward-dc'] = InwardDcPrint;
PRINT_TEMPLATES['roll-labels'] = RollLabelsPrint;
PRINT_TEMPLATES['bundle-tickets'] = BundleTicketsPrint;
PRINT_TEMPLATES['carton-label'] = CartonLabelPrint;
PRINT_TEMPLATES['packing-list'] = PackingListPrint;
PRINT_TEMPLATES['panel-dc'] = PanelDcPrint;
