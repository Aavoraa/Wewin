import { AppError } from './errors/app-error';

/**
 * Document lifecycle helpers (A§6): Draft → Posted → (Closed | Cancelled).
 * The backend enforces every transition; the UI only offers what these allow.
 */
export type DocState = 'DRAFT' | 'POSTED' | 'CLOSED' | 'CANCELLED';

export function assertDraft(doc: { status: DocState; docNo?: string | null }, what = 'Document'): void {
  if (doc.status === 'DRAFT') return;
  throw new AppError(
    'DOC_ALREADY_POSTED',
    `${what} ${doc.docNo ?? ''} is ${doc.status.toLowerCase()} and cannot be changed`.replace('  ', ' '),
    409,
    { status: doc.status },
  );
}

export function assertPosted(doc: { status: DocState; docNo?: string | null }, action: string, what = 'Document'): void {
  if (doc.status === 'POSTED') return;
  throw new AppError('INVALID_STATE', `Only a posted ${what.toLowerCase()} can be ${action} (it is ${doc.status.toLowerCase()})`, 409, {
    status: doc.status,
  });
}

/** Allowed transitions, used by tests and for clear errors. */
export const TRANSITIONS: Record<DocState, DocState[]> = {
  DRAFT: ['POSTED'],
  POSTED: ['CANCELLED', 'CLOSED'],
  CLOSED: [],
  CANCELLED: [],
};

export function canTransition(from: DocState, to: DocState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function dateOnly(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export function toDbDate(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

export function toDbDateOrNull(s: string | null | undefined): Date | null {
  return s ? toDbDate(s) : null;
}
