import { useMemo, useRef, type RefObject } from 'react';
import type { Operation } from '../domain/contracts/types';

export type FileOperation = 'open' | 'save' | 'export' | 'reference';

export interface NativeActivity {
  cad?: RefObject<string | null>;
  closing: RefObject<boolean>;
  execution: RefObject<Operation | null>;
  file: RefObject<FileOperation | null>;
  device: RefObject<boolean>;
}

// Synchronous guards shared by the project and execution owners. React state remains
// with each owner; these refs close the gap before the next render or native reply.
export interface WorkbenchActivity {
  cad?: RefObject<boolean>;
  native: NativeActivity;
  execution: RefObject<Operation | null>;
  file: RefObject<FileOperation | null>;
  device: RefObject<boolean>;
  recovery: RefObject<boolean>;
  confirmation: RefObject<boolean>;
}

export function useNativeActivity(): NativeActivity {
  const cad = useRef<string | null>(null);
  const closing = useRef(false);
  const execution = useRef<Operation | null>(null);
  const file = useRef<FileOperation | null>(null);
  const device = useRef(false);
  return useMemo(() => ({ execution, file, device, closing, cad }), []);
}

export function useWorkbenchActivity(native: NativeActivity): WorkbenchActivity {
  const cad = useRef(false);
  const execution = useRef<Operation | null>(null);
  const file = useRef<FileOperation | null>(null);
  const device = useRef(false);
  const recovery = useRef(false);
  const confirmation = useRef(false);
  return useMemo(
    () => ({ native, execution, file, device, recovery, confirmation, cad }),
    [native],
  );
}
