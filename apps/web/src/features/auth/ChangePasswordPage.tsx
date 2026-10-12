import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { zChangePassword } from '@wewin/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PageHeader } from '@/components/states';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const zForm = zChangePassword
  .extend({ confirm: z.string() })
  .refine((v) => v.confirm === v.newPassword, { message: 'Passwords do not match', path: ['confirm'] });
type FormValues = z.infer<typeof zForm>;

export function ChangePasswordPage() {
  const { logout } = useAuth();
  const form = useForm<FormValues>({ resolver: zodResolver(zForm), defaultValues: { currentPassword: '', newPassword: '', confirm: '' } });
  const e = form.formState.errors;

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await api.post('/auth/change-password', { currentPassword: v.currentPassword, newPassword: v.newPassword });
      toast.success('Password changed. Please log in again.');
      await logout();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  });

  return (
    <div className="max-w-md">
      <PageHeader title="Change password" description="At least 10 characters with a letter and a digit. All sessions are signed out." />
      <Card>
        <CardContent>
          <form onSubmit={onSubmit} className="grid gap-3" noValidate>
            {(['currentPassword', 'newPassword', 'confirm'] as const).map((k) => (
              <div key={k} className="grid gap-1">
                <Label htmlFor={k}>{k === 'currentPassword' ? 'Current password' : k === 'newPassword' ? 'New password' : 'Confirm new password'}</Label>
                <Input id={k} type="password" autoComplete={k === 'currentPassword' ? 'current-password' : 'new-password'} {...form.register(k)} />
                {e[k] ? <span className="text-[11px] text-destructive">{e[k]?.message}</span> : null}
              </div>
            ))}
            <Button type="submit" loading={form.formState.isSubmitting}>
              Change password
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
