'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

export function useDocumentHistory<T>(initial: () => T, external: T | undefined, onChange?: (document: T) => void) {
  const [value, setValue] = useState<T>(() => external ?? initial());
  const valueRef = useRef(value); const callbackRef = useRef(onChange);
  const past = useRef<T[]>([]); const future = useRef<T[]>([]); const [counts, setCounts] = useState({ past: 0, future: 0 });
  const externalRef = useRef(external);
  useEffect(() => { callbackRef.current = onChange; }, [onChange]);
  useEffect(() => {
    let current = true;
    queueMicrotask(() => {
      if (!current) return;
      if (external !== externalRef.current) {
        externalRef.current = external;
        const next = external ?? initial();
        if (JSON.stringify(next) !== JSON.stringify(valueRef.current)) {
          valueRef.current = next; setValue(next); past.current = []; future.current = []; setCounts({ past: 0, future: 0 });
        }
      }
    });
    return () => { current = false; };
  }, [external, initial]);
  const apply = useCallback((next: T, record = true) => {
    if (JSON.stringify(next) === JSON.stringify(valueRef.current)) return;
    if (record) { past.current = [...past.current.slice(-39), valueRef.current]; future.current = []; }
    valueRef.current = next; setValue(next); callbackRef.current?.(next); setCounts({ past: past.current.length, future: future.current.length });
  }, []);
  const undo = useCallback(() => { const previous = past.current.pop(); if (!previous) return; future.current.push(valueRef.current); apply(previous, false); }, [apply]);
  const redo = useCallback(() => { const next = future.current.pop(); if (!next) return; past.current.push(valueRef.current); apply(next, false); }, [apply]);
  return { value, apply, undo, redo, canUndo: counts.past > 0, canRedo: counts.future > 0 };
}
