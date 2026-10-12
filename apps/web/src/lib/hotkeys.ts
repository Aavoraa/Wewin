import { useEffect, useRef } from 'react';

type Handlers = Partial<Record<'save' | 'post' | 'escape', () => void>>;

/** Document-form shortcuts (A§9): Ctrl+S saves the draft, Ctrl+Enter posts. */
export function useDocumentHotkeys(handlers: Handlers, enabled = true) {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        ref.current.save?.();
      } else if (mod && e.key === 'Enter') {
        e.preventDefault();
        ref.current.post?.();
      } else if (e.key === 'Escape') {
        ref.current.escape?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

/**
 * Enter moves focus to the next focusable field inside `container` (form headers and grids).
 * Textareas and buttons keep their normal Enter behaviour.
 */
export function focusNextField(from: HTMLElement, container: HTMLElement | null, backwards = false): boolean {
  if (!container) return false;
  const fields = Array.from(
    container.querySelectorAll<HTMLElement>('input:not([type=hidden]):not([disabled]), select:not([disabled]), [data-enter-nav]'),
  ).filter((el) => el.offsetParent !== null && !el.hasAttribute('readonly'));
  const i = fields.indexOf(from);
  const next = fields[i + (backwards ? -1 : 1)];
  if (next) {
    next.focus();
    if (next instanceof HTMLInputElement) next.select();
    return true;
  }
  return false;
}
