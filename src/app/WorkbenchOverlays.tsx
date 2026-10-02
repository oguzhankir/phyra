import { Save } from 'lucide-react';
import HelpPanel from '../features/help/HelpPanel';
import RecoveryDialog from '../features/project/RecoveryDialog';
import CommandPalette, { type CommandAction } from '../features/workbench/CommandPalette';
import type { Workbench } from './useWorkbench';

interface Props {
  workbench: Pick<
    Workbench,
    | 'recovery'
    | 'confirmation'
    | 'help'
    | 'helpContext'
    | 'validation'
    | 'desktop'
    | 'setConfirmation'
    | 'confirmResolver'
    | 'setHelp'
  >;
  commandsOpen: boolean;
  commands: CommandAction[];
  onCommandsClose: () => void;
}

// Modal precedence belongs to application composition, not individual editors.
export default function WorkbenchOverlays({
  workbench,
  commandsOpen,
  commands,
  onCommandsClose,
}: Props) {
  const {
    recovery,
    confirmation,
    help,
    helpContext,
    validation,
    desktop,
    setConfirmation,
    confirmResolver,
    setHelp,
  } = workbench;
  return (
    <>
      {commandsOpen && !confirmation && !help && !recovery.prompt && (
        <CommandPalette commands={commands} onClose={onCommandsClose} />
      )}
      {recovery.prompt && !confirmation && !help && (
        <RecoveryDialog
          records={recovery.records}
          pending={recovery.pending}
          onRestore={(record) => void recovery.restore(record)}
          onDiscard={(record) => void recovery.discard(record)}
          onLater={() => recovery.setPrompt(false)}
        />
      )}
      {confirmation && (
        <div className="modal-backdrop">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="unsaved-title">
            <div className="modal-icon">
              <Save size={23} />
            </div>
            <h2 id="unsaved-title">Save your changes?</h2>
            <p>
              Your current project has unsaved changes. Save before continuing, or discard them.
            </p>
            <div className="modal-actions">
              {(['cancel', 'discard', 'save'] as const).map((choice) => (
                <button
                  key={choice}
                  className={choice === 'save' ? 'primary' : 'secondary'}
                  disabled={choice === 'save' && (!!validation || !desktop)}
                  onClick={() => {
                    setConfirmation(false);
                    confirmResolver.current?.(choice);
                    confirmResolver.current = null;
                  }}
                >
                  {choice === 'save' ? 'Save changes' : choice === 'discard' ? 'Discard' : 'Cancel'}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {help && !confirmation && (
        <div className="modal-backdrop help-backdrop">
          <div
            className="modal help-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Phyra help"
          >
            <HelpPanel open={help} context={helpContext} onClose={() => setHelp(false)} />
          </div>
        </div>
      )}
    </>
  );
}
