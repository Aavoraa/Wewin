import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Navigate, useLocation } from 'react-router';
import { type LoginInput, zLogin } from '@wewin/shared';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';

export function LoginPage() {
  const { login, status } = useAuth();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<LoginInput>({ resolver: zodResolver(zLogin), defaultValues: { username: '', password: '' } });

  if (status === 'authenticated') {
    const from = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={from} replace />;
  }

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      await login(v.username, v.password);
    } catch (e) {
      setError(errorMessage(e));
    }
  });

  return (
    <div className="flex min-h-full items-center justify-center bg-sidebar p-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm rounded-lg bg-card p-6 shadow-xl" noValidate>
        <div className="mb-5 flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="size-9" />
          <div>
            <h1 className="text-base font-semibold">Wewin ERP</h1>
            <p className="text-xs text-muted-foreground">Wewin Knit Fashions</p>
          </div>
        </div>
        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label htmlFor="username">Username</Label>
            <Input id="username" autoComplete="username" autoFocus {...form.register('username')} />
            {form.formState.errors.username ? (
              <span className="text-[11px] text-destructive">{form.formState.errors.username.message}</span>
            ) : null}
          </div>
          <div className="grid gap-1">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" autoComplete="current-password" {...form.register('password')} />
            {form.formState.errors.password ? (
              <span className="text-[11px] text-destructive">{form.formState.errors.password.message}</span>
            ) : null}
          </div>
          {error ? (
            <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          ) : null}
          <Button type="submit" loading={form.formState.isSubmitting} className="mt-1">
            Log in
          </Button>
        </div>
      </form>
    </div>
  );
}
