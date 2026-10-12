import { type ReactNode } from 'react';
import { type FieldValues, type Path, type UseFormReturn } from 'react-hook-form';
import { cn } from '@/lib/utils';
import { Checkbox, Input, Label, Select, Textarea } from './ui/input';

interface Base<T extends FieldValues> {
  form: UseFormReturn<T, unknown, FieldValues>;
  name: Path<T>;
  label: string;
  className?: string;
  required?: boolean;
  hint?: string;
}

function errorOf<T extends FieldValues>(form: UseFormReturn<T, unknown, FieldValues>, name: string): string | undefined {
  const parts = name.split('.');
  let e: unknown = form.formState.errors;
  for (const p of parts) e = (e as Record<string, unknown> | undefined)?.[p];
  return (e as { message?: string } | undefined)?.message;
}

function Wrap({ label, error, children, className, required, hint, htmlFor }: { label: string; error?: string; children: ReactNode; className?: string; required?: boolean; hint?: string; htmlFor: string }) {
  return (
    <div className={cn('grid gap-1', className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? ' *' : ''}
      </Label>
      {children}
      {error ? <span className="text-[11px] text-destructive">{error}</span> : hint ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

export function TextField<T extends FieldValues>({ form, name, label, className, required, hint, type = 'text', placeholder, inputMode }: Base<T> & { type?: string; placeholder?: string; inputMode?: 'decimal' | 'numeric' | 'text' }) {
  const error = errorOf(form, name);
  return (
    <Wrap label={label} error={error} className={className} required={required} hint={hint} htmlFor={name}>
      <Input id={name} type={type} placeholder={placeholder} inputMode={inputMode} aria-invalid={!!error} className={inputMode === 'decimal' ? 'num' : undefined} {...form.register(name)} />
    </Wrap>
  );
}

export function TextAreaField<T extends FieldValues>({ form, name, label, className, required }: Base<T>) {
  const error = errorOf(form, name);
  return (
    <Wrap label={label} error={error} className={className} required={required} htmlFor={name}>
      <Textarea id={name} aria-invalid={!!error} {...form.register(name)} />
    </Wrap>
  );
}

export function SelectField<T extends FieldValues>({ form, name, label, className, required, options, hint }: Base<T> & { options: { value: string; label: string }[] }) {
  const error = errorOf(form, name);
  return (
    <Wrap label={label} error={error} className={className} required={required} hint={hint} htmlFor={name}>
      <Select id={name} aria-invalid={!!error} {...form.register(name)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </Wrap>
  );
}

export function CheckboxField<T extends FieldValues>({ form, name, label, className }: Base<T>) {
  return (
    <label className={cn('flex items-center gap-2 text-sm', className)}>
      <Checkbox {...form.register(name)} /> {label}
    </label>
  );
}
