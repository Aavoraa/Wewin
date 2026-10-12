import { type ComponentType } from 'react';
import { useParams } from 'react-router';
import { EmptyState } from '@/components/states';

/** Registry of print templates by document type; modules register theirs (A§9 print pattern). */
export const PRINT_TEMPLATES: Record<string, ComponentType<{ id: string }>> = {};

export function PrintRoute() {
  const { docType = '', id = '' } = useParams();
  const T = PRINT_TEMPLATES[docType];
  if (!T) return <EmptyState title={`No print layout for ${docType}`} />;
  return <T id={id} />;
}
