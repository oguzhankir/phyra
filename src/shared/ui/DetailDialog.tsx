import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, X } from 'lucide-react';
import { useModalFocus } from './useModalFocus';
import { mountDetailDialogOwnership } from './detailDialogLifecycle';
import './DetailDialog.css';

/** Secondary information and advanced edits open in a focused sheet, keeping the page concise. */
export default function DetailDialog({
  title,
  children,
  className = '',
  forceOpen = false,
}: {
  title: ReactNode;
  children: ReactNode;
  className?: string;
  forceOpen?: boolean;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const modal = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(forceOpen);
  const [mounted, setMounted] = useState(forceOpen);
  const [blocked, setBlocked] = useState(false);
  const [controlsDisabled, setControlsDisabled] = useState(false);
  const close = () => {
    const invalid = modal.current?.querySelector<HTMLInputElement>('input[aria-invalid="true"]');
    if (invalid) {
      setBlocked(true);
      invalid.focus();
      return;
    }
    setOpen(false);
  };
  useModalFocus(open, close, id, modal);
  useEffect(() => {
    if (forceOpen) {
      setMounted(true);
      setOpen(true);
    }
  }, [forceOpen]);
  useEffect(() => {
    if (!open || !trigger.current) return;
    return mountDetailDialogOwnership({
      trigger: trigger.current,
      onHide: () => setOpen(false),
      onDisabled: setControlsDisabled,
    });
  }, [open]);
  const content = (
    <div
      className={`${open ? 'modal ' : ''}detail-dialog`}
      role={open ? 'dialog' : undefined}
      aria-modal={open ? true : undefined}
      aria-labelledby={`${id}-title`}
      ref={modal}
    >
      <div className="detail-dialog-header">
        <h2 id={`${id}-title`}>{title}</h2>
        <button type="button" className="icon-button" aria-label="Close details" onClick={close}>
          <X size={18} />
        </button>
      </div>
      <div
        className="detail-dialog-body"
        onClickCapture={(event) => {
          if (event.target instanceof Element && event.target.closest('[data-detail-close]'))
            close();
        }}
      >
        <fieldset disabled={controlsDisabled}>{children}</fieldset>
      </div>
      {blocked && (
        <p className="detail-dialog-error" role="alert">
          Complete or revert the highlighted number before closing.
        </p>
      )}
      <div className="detail-dialog-footer">
        <button type="button" className="secondary" onClick={close}>
          Done
        </button>
      </div>
    </div>
  );
  return (
    <div className={`detail-action ${className}`}>
      <button
        type="button"
        ref={trigger}
        className="detail-dialog-trigger"
        aria-haspopup="dialog"
        onClick={() => {
          setBlocked(false);
          setMounted(true);
          setOpen(true);
        }}
      >
        <span>{title}</span>
        <ArrowUpRight size={14} aria-hidden="true" />
      </button>
      {mounted &&
        (typeof document === 'undefined'
          ? content
          : createPortal(
              <div
                className="modal-backdrop detail-dialog-backdrop"
                hidden={!open}
                onPointerDown={(event) => {
                  if (event.target === event.currentTarget) close();
                }}
              >
                {content}
              </div>,
              document.body,
            ))}
    </div>
  );
}
