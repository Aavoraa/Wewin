import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { PERMISSIONS, type PermissionKey, permissionModule } from '@wewin/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ErrorState, LoadingState, PageHeader } from '@/components/states';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox, Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface RoleRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  version: number;
  userCount: number;
  permissions: PermissionKey[];
}

const GROUPS = Object.entries(
  (Object.keys(PERMISSIONS) as PermissionKey[]).reduce<Record<string, PermissionKey[]>>((acc, k) => {
    (acc[permissionModule(k)] ??= []).push(k);
    return acc;
  }, {}),
);

/** Roles are bundles of permissions, editable by the Owner (A§10). */
export function RolesPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['roles'], queryFn: () => api.get<RoleRow[]>('/roles') });
  const [selected, setSelected] = useState<string | null>(null);
  const role = useMemo(() => q.data?.find((r) => r.id === selected) ?? q.data?.[0], [q.data, selected]);
  const [perms, setPerms] = useState<Set<PermissionKey>>(new Set());
  const [newName, setNewName] = useState('');
  const editable = can('roles.manage') && role?.code !== 'OWNER';

  useEffect(() => {
    if (role) setPerms(new Set(role.permissions));
  }, [role]);

  const save = useMutation({
    mutationFn: () => api.patch(`/roles/${role!.id}`, { name: role!.name, description: role!.description, permissions: [...perms], version: role!.version }),
    onSuccess: () => {
      toast.success('Role saved — takes effect within seconds');
      void qc.invalidateQueries({ queryKey: ['roles'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const create = useMutation({
    mutationFn: () => api.post<RoleRow>('/roles', { code: newName.toUpperCase().replace(/[^A-Z0-9]+/g, '_'), name: newName, permissions: ['dashboard.view'] }),
    onSuccess: (r) => {
      setNewName('');
      setSelected(r.id);
      void qc.invalidateQueries({ queryKey: ['roles'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isLoading) return <LoadingState />;
  if (q.isError) return <ErrorState error={q.error} />;
  const dirty = role && (perms.size !== role.permissions.length || role.permissions.some((p) => !perms.has(p)));

  return (
    <div>
      <PageHeader title="Roles & permissions" description="Default bundles are interim (Q-002); the Owner role always has everything." />
      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <Card>
          <CardContent className="flex flex-col gap-1 p-2">
            {q.data?.map((r) => (
              <button
                key={r.id}
                onClick={() => setSelected(r.id)}
                className={cn('flex items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-accent', role?.id === r.id && 'bg-accent font-medium')}
              >
                {r.name} <span className="text-xs text-muted-foreground">{r.userCount} users</span>
              </button>
            ))}
            {can('roles.manage') ? (
              <div className="mt-2 flex gap-1 border-t pt-2">
                <Input placeholder="New role name" value={newName} onChange={(e) => setNewName(e.target.value)} className="h-8" />
                <Button size="sm" disabled={newName.trim().length < 2} onClick={() => create.mutate()} loading={create.isPending}>
                  Add
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
        {role ? (
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                {role.name} <Badge>{role.code}</Badge> <span className="text-xs font-normal text-muted-foreground">{perms.size} permissions</span>
              </CardTitle>
              {editable ? (
                <Button size="sm" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
                  Save permissions
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {GROUPS.map(([mod, keys]) => (
                <div key={mod}>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{mod}</div>
                  {keys.map((k) => (
                    <label key={k} className="flex items-start gap-2 py-0.5 text-sm" title={k}>
                      <Checkbox
                        className="mt-0.5"
                        disabled={!editable}
                        checked={perms.has(k)}
                        onChange={(e) => {
                          const n = new Set(perms);
                          if (e.target.checked) n.add(k);
                          else n.delete(k);
                          setPerms(n);
                        }}
                      />
                      <span>{PERMISSIONS[k]}</span>
                    </label>
                  ))}
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
