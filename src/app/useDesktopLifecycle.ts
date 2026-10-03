import { useEffect, useRef } from 'react';
import { subscribeCloseRequested } from '../platform/desktop/lifecycle';
import { historyShortcut } from './historyShortcut';
import type { NativeActivity } from './workbenchActivity';
import type { ProjectDocumentSnapshot } from './projectDocuments';

type Props = {
  desktop: boolean;
  active: ProjectDocumentSnapshot | null;
  nativeActivity: NativeActivity;
  modalOpen: boolean;
  anyDirty: boolean;
  onNew: () => void;
  onOpen: () => Promise<boolean>;
  onSave: (as?: boolean) => Promise<boolean>;
  onCloseDocument: () => Promise<void>;
  onHelp: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canCloseWindow: () => Promise<boolean>;
  onWindowCloseFailed: () => void;
  onError: (message: string) => void;
};

// One application-level listener routes commands to the currently focused
// document. Hidden document owners never receive another tab's shortcut.
export function useDesktopLifecycle(props: Props) {
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const current = latest.current;
      if (
        current.modalOpen ||
        current.nativeActivity.closing.current ||
        document.querySelector('.modal[aria-modal="true"]')
      )
        return;
      if (event.key === 'F1') {
        event.preventDefault();
        current.onHelp();
        return;
      }
      const platform = /Mac|iPhone|iPad/i.test(navigator.platform)
        ? 'mac'
        : /Win/i.test(navigator.platform)
          ? 'windows'
          : 'other';
      const action = historyShortcut(event, {
        platform,
        blocked: !current.active || current.active.historyBlocked,
      });
      if (action) {
        event.preventDefault();
        (action === 'undo' ? current.onUndo : current.onRedo)();
        return;
      }
      if (!event.metaKey && !event.ctrlKey) return;
      const character = event.key.toLowerCase();
      if (!['s', 'o', 'n', 'w'].includes(character)) return;
      if (character === 'w' && !current.active) return;
      event.preventDefault();
      if (character === 'n') current.onNew();
      if (character === 'w') void current.onCloseDocument();
      if (character === 's' && current.active) void current.onSave(event.shiftKey);
      if (character === 'o') void current.onOpen();
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const current = latest.current;
      if (
        current.anyDirty ||
        current.nativeActivity.execution.current ||
        current.nativeActivity.file.current ||
        current.nativeActivity.device.current
      ) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('keydown', key);
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, []);
  useEffect(() => {
    if (!props.desktop) return;
    let dead = false;
    let unsubscribe: (() => void) | undefined;
    subscribeCloseRequested(async (event, close) => {
      event.preventDefault();
      const current = latest.current;
      if (
        current.modalOpen ||
        document.querySelector('.modal[aria-modal="true"]') ||
        current.nativeActivity.execution.current ||
        current.nativeActivity.file.current ||
        current.nativeActivity.device.current
      ) {
        current.onError(
          'Finish the active dialog or native operation before closing Phyra. Running analyses can be cancelled in their project tab.',
        );
        return;
      }
      try {
        if (await current.canCloseWindow()) await close();
      } catch (cause) {
        current.onWindowCloseFailed();
        current.onError(`Phyra remains open: ${String(cause)}`);
      }
    })
      .then((remove) => {
        if (dead) remove();
        else unsubscribe = remove;
      })
      .catch((cause) => latest.current.onError(`Window lifecycle failed: ${String(cause)}`));
    return () => {
      dead = true;
      unsubscribe?.();
    };
  }, [props.desktop]);
}
