import { subscribeCloseRequested } from '../platform/desktop/lifecycle';
import { useEffect, type RefObject, type Dispatch, type SetStateAction } from 'react';
import type { Operation } from '../domain/contracts/types';
import type { Section } from '../features/workbench/navigation';
import type { HelpContext } from '../features/help/content';
import type { ExampleId } from '../features/examples/projects';
type Props = {
  desktop: boolean;
  busyRef: RefObject<Operation | null>;
  fileBusyRef: RefObject<string | null>;
  confirmationRef: RefObject<boolean>;
  dirtyRef: RefObject<boolean>;
  canReplaceRef: RefObject<() => Promise<boolean>>;
  help: boolean;
  confirmation: boolean;
  section: Section;
  save: (as?: boolean) => Promise<boolean>;
  open: () => Promise<void>;
  create: (example?: ExampleId) => Promise<void>;
  setHelpContext: Dispatch<SetStateAction<HelpContext>>;
  setHelp: Dispatch<SetStateAction<boolean>>;
  setError: (message: string | null) => void;
};
export function useDesktopLifecycle({
  desktop,
  busyRef,
  fileBusyRef,
  confirmationRef,
  dirtyRef,
  canReplaceRef,
  help,
  confirmation,
  section,
  save,
  open,
  create,
  setHelpContext,
  setHelp,
  setError,
}: Props) {
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'F1') {
        event.preventDefault();
        if (!confirmation) {
          setHelpContext(section);
          setHelp(true);
        }
        return;
      }
      if (!event.metaKey && !event.ctrlKey) return;
      const character = event.key.toLowerCase();
      if (!['s', 'o', 'n'].includes(character)) return;
      event.preventDefault();
      if (busyRef.current || fileBusyRef.current || confirmationRef.current || help) return;
      if (character === 's') void save(event.shiftKey);
      if (character === 'o') void open();
      if (character === 'n') void create();
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current || busyRef.current || fileBusyRef.current) {
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
  }, [save, open, create, help, confirmation, section]);
  useEffect(() => {
    if (!desktop) return;
    let unsubscribe: (() => void) | undefined;
    let dead = false;
    subscribeCloseRequested(async (event, close) => {
      if (busyRef.current || fileBusyRef.current) {
        event.preventDefault();
        setError(
          fileBusyRef.current
            ? 'Wait for the project file operation to finish before closing Phyra.'
            : 'Cancel the running job before closing Phyra.',
        );
        return;
      }
      if (dirtyRef.current) {
        event.preventDefault();
        if (await canReplaceRef.current()) await close();
      }
    })
      .then((remove) => {
        if (dead) remove();
        else unsubscribe = remove;
      })
      .catch((cause) => setError(`Window lifecycle failed: ${String(cause)}`));
    return () => {
      dead = true;
      unsubscribe?.();
    };
  }, [desktop]);
}
