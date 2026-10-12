import { useState } from 'react';
import { DataTable, type DTColumn } from '@/components/DataTable';
import { PageHeader } from '@/components/states';
import { Input, Select } from '@/components/ui/input';

interface AuditRow {
  id: string;
  at: string;
  userId: string | null;
  tableName: string;
  recordId: string | null;
  action: string;
  reason: string | null;
  docNo: string | null;
  newData: unknown;
}

const columns: DTColumn<AuditRow>[] = [
  { key: 'at', header: 'When (IST)', type: 'datetime' },
  { key: 'action', header: 'Action' },
  { key: 'tableName', header: 'Table / document' },
  { key: 'docNo', header: 'Doc no.' },
  { key: 'recordId', header: 'Record', cell: (r) => <span className="font-mono text-xs">{r.recordId?.slice(0, 8)}</span> },
  { key: 'userId', header: 'User', cell: (r) => <span className="font-mono text-xs">{r.userId?.slice(0, 8) ?? 'system'}</span> },
  { key: 'reason', header: 'Reason' },
];

/** Append-only audit log viewer. */
export function AuditPage() {
  const [action, setAction] = useState('');
  const [table, setTable] = useState('');
  return (
    <div>
      <PageHeader title="Audit log" description="Every create, update, delete, post, cancel, close and approval — append-only." />
      <DataTable<AuditRow>
        id="audit"
        endpoint="/audit"
        columns={columns}
        exportTitle="Audit log"
        filters={{ action: action || undefined, tableName: table || undefined }}
        filterBar={
          <>
            <Select className="h-9 w-36" value={action} onChange={(e) => setAction(e.target.value)} aria-label="Action">
              <option value="">All actions</option>
              {['INSERT', 'UPDATE', 'DELETE', 'POST', 'CANCEL', 'CLOSE', 'APPROVE'].map((a) => (
                <option key={a}>{a}</option>
              ))}
            </Select>
            <Input className="h-9 w-44" placeholder="Table e.g. items" value={table} onChange={(e) => setTable(e.target.value.trim())} />
          </>
        }
      />
    </div>
  );
}
