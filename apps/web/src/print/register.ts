import { PRINT_TEMPLATES } from './PrintRoute';
import { YarnReceiptPrint } from './YarnReceiptPrint';

/** Print templates by document type (A§11). */
PRINT_TEMPLATES['yarn-receipt'] = YarnReceiptPrint;
