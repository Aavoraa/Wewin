import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Navigate, useLocation } from 'react-router';
import { type LoginInput, zLogin } from '@wewin/shared';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { WewinBrand } from '@/components/Brand';

/** From wewinknitfashions.com. */
const FACTS: [string, string][] = [
  ['75,000', 'Pcs monthly production capacity'],
  ['100', 'Sewing machines'],
  ['3', 'Automatic printing machines'],
  ['1', 'Computerised embroidery machine'],
];

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
    <div className="flex min-h-full flex-col bg-background">
      <div className="h-0.5 bg-brand/80" aria-hidden />
      <div className="flex flex-1">
        <aside className="relative hidden w-[52%] flex-col justify-between overflow-hidden bg-sidebar p-12 text-white lg:flex">
          <div className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-brand/5" aria-hidden />
          <WewinBrand onDark />
          <div className="relative max-w-xl">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-brand">Tirupur · since 2004</p>
            <h2 className="text-4xl font-bold leading-tight">Tradition, Skill, and Dedication in Every Thread</h2>
            <p className="mt-4 text-[15px] leading-relaxed text-slate-300">
              One system for every order — from yarn and programmes to job work, production, export and accounts.
            </p>
          </div>
          <div className="relative grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/10 bg-white/10 xl:grid-cols-4">
            {FACTS.map(([n, l]) => (
              <div key={l} className="bg-sidebar px-5 py-4">
                <div className="font-[family-name:var(--font-display)] text-2xl font-semibold text-[#b7c7a6]">{n}</div>
                <div className="mt-1 text-[12px] leading-snug text-slate-400">{l}</div>
              </div>
            ))}
          </div>
        </aside>
        <main className="flex flex-1 items-center justify-center p-6">
          <form onSubmit={onSubmit} className="w-full max-w-sm" noValidate>
            <WewinBrand className="mb-8 lg:hidden" />
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">Wewin ERP</p>
            <div className="mb-1 mt-2 h-0.5 w-8 bg-brand" aria-hidden />
            <h1 className="mt-3 text-2xl font-semibold">Sign in</h1>
            <p className="mb-6 mt-1 text-sm text-muted-foreground">Use your Wewin ERP username and password.</p>
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
        </main>
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t bg-card px-6 py-2.5 text-xs text-muted-foreground">
        <span>Copyright © {new Date().getFullYear()} Wewin Knit Fashions</span>
        <span>Manufacturers &amp; Exporters of Hosiery Garments</span>
      </footer>
    </div>
  );
}
