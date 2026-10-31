import { useEffect, useId, useRef, type KeyboardEvent } from 'react';

interface ConfirmDialogProps {
  title: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Modal confirmation. Focus moves into the dialog when it opens and back to the element that had it
 * when it closes; Esc cancels.
 */
export function ConfirmDialog({ title, confirmLabel, cancelLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  const titleId = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();
    return () => opener?.focus();
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key !== 'Tab') return;
    // Keep focus inside the dialog: it has exactly two buttons.
    const first = confirmRef.current;
    const last = cancelRef.current;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={handleKeyDown}>
      <p id={titleId}>{title}</p>
      <button type="button" ref={confirmRef} onClick={onConfirm}>
        {confirmLabel}
      </button>
      <button type="button" ref={cancelRef} onClick={onCancel}>
        {cancelLabel}
      </button>
    </div>
  );
}
