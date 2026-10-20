import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { LoadingState } from '@/components/states';

interface Setting {
  key: string;
  value: string | number | boolean;
  description: string;
}

function parsed(s: Setting, v: string): string | number | boolean {
  if (typeof s.value === 'number') return Number(v);
  if (typeof s.value === 'boolean') return v === 'true';
  return v;
}

function SettingRow({ s, editable }: { s: Setting; editable: boolean }) {
  const qc = useQueryClient();
  const [v, setV] = useState(String(s.value));
  const save = useMutation({
    mutationFn: () => api.put(`/settings/business/${s.key}`, { value: parsed(s, v) }),
    onSuccess: () => {
      toast.success(`${s.key} saved`);
      void qc.invalidateQueries({ queryKey: ['settings', 'business'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const isMode = s.key === 'match.toleranceMode';
  return (
    <div className="grid items-center gap-2 border-b py-2.5 last:border-0 sm:grid-cols-[220px_160px_1fr_auto]">
      <code className="text-xs">{s.key}</code>
      {isMode ? (
        <Select value={v} onChange={(e) => setV(e.target.value)} disabled={!editable}>
          {['ABS', 'PCT', 'EITHER', 'BOTH'].map((m) => (
            <option key={m}>{m}</option>
          ))}
        </Select>
      ) : typeof s.value === 'boolean' ? (
        <Select value={v} onChange={(e) => setV(e.target.value)} disabled={!editable}>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </Select>
      ) : (
        <Input value={v} onChange={(e) => setV(e.target.value)} disabled={!editable} inputMode="decimal" className="num" />
      )}
      <span className="text-xs text-muted-foreground">{s.description}</span>
      {editable ? (
        <Button size="sm" variant="outline" disabled={v === String(s.value)} loading={save.isPending} onClick={() => save.mutate()}>
          Save
        </Button>
      ) : null}
    </div>
  );
}

/** Configurable business rules (tolerances, GST windows). Defaults are interim — see OPEN-QUESTIONS. */
export function BusinessSettings({ editable }: { editable: boolean }) {
  const q = useQuery({ queryKey: ['settings', 'business'], queryFn: () => api.get<Setting[]>('/settings/business') });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Business rules</CardTitle>
        <CardDescription>
          Interim defaults pending confirmation by Wewin and its auditor. Changes are audited.
        </CardDescription>
      </CardHeader>
      <CardContent className="py-1">
        {q.isLoading ? <LoadingState /> : q.data?.map((s) => <SettingRow key={`${s.key}:${String(s.value)}`} s={s} editable={editable} />)}
      </CardContent>
    </Card>
  );
}
