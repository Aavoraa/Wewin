import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Controller } from 'react-hook-form';
import { KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { zUserCreate, zUserUpdate } from '@wewin/shared';
import { api, errorMessage } from '@/lib/api';
import { formatDateTimeIst } from '@/lib/format';
import { TextField } from '@/components/form-fields';
import { Button } from '@/components/ui/button';
import { Checkbox, Input, Label } from '@/components/ui/input';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { MasterCrudPage, type MasterRow } from './MasterCrudPage';

interface UserRow extends MasterRow {
  username: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  lastLoginAt: string | null;
  lockedUntil: string | null;
  mustChangePassword: boolean;
  roles: { id: string; code: string; name: string }[];
  roleIds: string[];
}
interface RoleRow {
  id: string;
  name: string;
}

function ResetPassword({ user }: { user: UserRow }) {
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState('');
  const m = useMutation({
    mutationFn: () => api.post(`/users/${user.id}/reset-password`, { password: pw }),
    onSuccess: () => {
      toast.success(`Password reset for ${user.username}. They must change it at next login.`);
      setOpen(false);
      setPw('');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <>
      <Button size="icon-sm" variant="ghost" aria-label="Reset password" title="Reset password" onClick={() => setOpen(true)}>
        <KeyRound />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={`Reset password — ${user.username}`} description="All of the user's sessions are signed out.">
          <div className="grid gap-1">
            <Label htmlFor="new-pw">New temporary password</Label>
            <Input id="new-pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
            <span className="text-[11px] text-muted-foreground">At least 10 characters with a letter and a digit.</span>
          </div>
          <div className="mt-4 flex justify-end">
            <Button onClick={() => m.mutate()} loading={m.isPending} disabled={pw.length < 10}>
              Reset password
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function UsersPage() {
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api.get<RoleRow[]>('/roles') });
  return (
    <MasterCrudPage<UserRow>
      id="users"
      noun="user"
      title="Users"
      description="Named users and their roles. Permissions are checked on the server for every request."
      endpoint="/users"
      editPerm="users.manage"
      columns={[
        { key: 'username', header: 'Username', sort: 'username' },
        { key: 'fullName', header: 'Name', sort: 'fullName' },
        { key: 'roles', header: 'Roles', cell: (r) => r.roles.map((x) => x.name).join(', ') },
        { key: 'lastLoginAt', header: 'Last login', type: 'datetime', sort: 'lastLoginAt' },
        {
          key: 'lockedUntil',
          header: 'Locked',
          cell: (r) => (r.lockedUntil && new Date(r.lockedUntil) > new Date() ? `until ${formatDateTimeIst(r.lockedUntil)}` : '—'),
        },
      ]}
      schema={zUserCreate}
      updateSchema={zUserUpdate}
      emptyForm={{ username: '', fullName: '', email: '', phone: '', password: '', roleIds: [] }}
      toForm={(r) => ({ fullName: r.fullName, email: r.email ?? '', phone: r.phone ?? '', roleIds: r.roleIds })}
      rowActions={(r) => <ResetPassword user={r} />}
      renderForm={(form, editing) => (
        <>
          {editing ? (
            <div className="grid gap-1">
              <Label>Username</Label>
              <Input value={editing.username} disabled />
            </div>
          ) : (
            <TextField form={form} name="username" label="Username" required />
          )}
          <TextField form={form} name="fullName" label="Full name" required />
          <TextField form={form} name="email" label="Email" type="email" />
          <TextField form={form} name="phone" label="Phone" />
          {!editing ? <TextField form={form} name="password" label="Initial password" type="password" required hint="User must change it at first login" /> : null}
          <div className="sm:col-span-2">
            <Label>Roles *</Label>
            <Controller
              control={form.control}
              name="roleIds"
              render={({ field, fieldState }) => (
                <>
                  <div className="mt-1 flex flex-wrap gap-3">
                    {(roles.data ?? []).map((r) => {
                      const v = field.value as string[];
                      return (
                        <label key={r.id} className="flex items-center gap-1.5 text-sm">
                          <Checkbox checked={v.includes(r.id)} onChange={(e) => field.onChange(e.target.checked ? [...v, r.id] : v.filter((x) => x !== r.id))} />
                          {r.name}
                        </label>
                      );
                    })}
                  </div>
                  {fieldState.error ? <span className="text-[11px] text-destructive">{fieldState.error.message}</span> : null}
                </>
              )}
            />
          </div>
        </>
      )}
    />
  );
}
