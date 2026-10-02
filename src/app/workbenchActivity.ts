import { useMemo, useRef, type RefObject } from 'react';
import type { Operation } from '../domain/contracts/types';

export type FileOperation = 'open' | 'save' | 'export' | 'reference';

// Synchronous guards shared by the project and execution owners. React state remains
// with each owner; these refs close the gap before the next render or native reply.
export interface WorkbenchActivity {
  execution: RefObject<Operation | null>;
  file: RefObject<FileOperation | null>;
  device: RefObject<boolean>;
  recovery: RefObject<boolean>;
  confirmation: RefObject<boolean>;
}

export function useWorkbenchActivity(): WorkbenchActivity {
  const execution = useRef<Operation | null>(null);
  const file = useRef<FileOperation | null>(null);
  const device = useRef(false);
  const recovery = useRef(false);
  const confirmation = useRef(false);
  return useMemo(() => ({ execution, file, device, recovery, confirmation }), []);
}
