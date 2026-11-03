"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export function Dialog({ title, subtitle, children, onClose, small = false, className = "" }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void; small?: boolean; className?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    const focusPrimary = () => {
      const primary = element?.querySelector<HTMLElement>("[data-dialog-autofocus], input:not([type='hidden']):not([hidden]):not(:disabled), textarea:not(:disabled), select:not(:disabled)");
      primary?.focus({ preventScroll: true });
    };
    // showModal focuses the first button itself; focus the form only after opening.
    focusPrimary();
    const frame = window.requestAnimationFrame(focusPrimary);
    return () => { window.cancelAnimationFrame(frame); if (element?.open) element.close(); };
  }, []);
  return <dialog ref={dialog} className={`studio-dialog ${small ? "is-small" : ""} ${className}`} aria-label={title} onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="studio-dialog-header"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="studio-icon-button" onClick={onClose} aria-label="Close dialog"><X size={18} /></button></div>
    {children}
  </dialog>;
}
