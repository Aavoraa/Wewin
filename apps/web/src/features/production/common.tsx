import { useState } from 'react';
import { Link } from 'react-router';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { type PermissionKey } from '@wewin/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFy } from '@/lib/fy';
import { DataTable, type DTColumn } from '@/components/DataTable';
import { PageHeader } from '@/components/states';
import { Button } from '@/components/ui/button';
import { StatusFilter } from '../yarn/YarnPages';

export interface BundleInfo {
  id: string;
  bundleNo: string;
  componentCode: string;
  colour: string;
  size: string;
  pcs: number;
  orderId: string;
  panelItem: { code: string; name: string };
  lay: { docNo: string; order: { orderNo: string; styleNo: string } };
  at: { locationId: string; code: string; name: string; kind: string; pcs: number }[];
}

/** Scan a bundle QR (or type its number) and get it with its live location. */
export async function lookupBundle(code: string): Promise<BundleInfo | null> {
  try {
    return await api.get<BundleInfo>(`/bundles/by-no/${encodeURIComponent(code.trim())}`);
  } catch (e) {
    toast.error(errorMessage(e));
    return null;
  }
}

/** Generic register page for production documents. */
export function DocRegister<T extends { id: string }>({
  id,
  title,
  description,
  endpoint,
  route,
  columns,
  createPerm,
  newLabel,
  extraFilters,
  statuses,
}: {
  id: string;
  title: string;
  description: string;
  endpoint: string;
  route: string;
  columns: DTColumn<T>[];
  createPerm: PermissionKey;
  newLabel: string;
  extraFilters?: Record<string, string | undefined>;
  statuses?: string[];
}) {
  const { can } = useAuth();
  const fy = useFy();
  const [status, setStatus] = useState('');
  return (
    <div>
      <PageHeader
        title={title}
        description={description}
        actions={
          can(createPerm) ? (
            <Button asChild>
              <Link to={`/${route}/new`}>
                <Plus /> {newLabel}
              </Link>
            </Button>
          ) : null
        }
      />
      <DataTable<T>
        id={id}
        endpoint={endpoint}
        columns={columns}
        exportTitle={title}
        rowHref={(r) => `/${route}/${r.id}`}
        filters={{ status: status || undefined, from: fy.start, to: fy.end, ...(extraFilters ?? {}) }}
        filterBar={<StatusFilter value={status} onChange={setStatus} statuses={statuses} />}
      />
    </div>
  );
}

export const docNoCol = <T extends { docNo: string | null }>(header = 'No.'): DTColumn<T> => ({
  key: 'docNo',
  header,
  sort: 'docNo',
  cell: (r) => <span className="font-mono">{r.docNo ?? 'Draft'}</span>,
});
