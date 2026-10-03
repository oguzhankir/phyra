import { useEffect, useRef, useState } from 'react';
import { Check, CircleAlert, Save } from 'lucide-react';

type Props = {
  path: string | null;
  dirty: boolean;
  desktop: boolean;
  canSave: boolean;
  autosaveEnabled: boolean;
  autosaveStatus: 'off' | 'needs-save' | 'waiting' | 'saving' | 'saved' | 'paused' | 'error';
  autosaveError: string | null;
  onAutosave: (enabled: boolean) => void;
  onSave: () => void;
};

export default function ProjectWorkspaceBar(props: Props) {
  const saving = props.autosaveStatus === 'saving';
  const prior = useRef({ dirty: props.dirty, status: props.autosaveStatus, path: props.path });
  const [showSaved, setShowSaved] = useState(false);
  const [savedTick, setSavedTick] = useState(0);
  useEffect(() => {
    const before = prior.current;
    prior.current = { dirty: props.dirty, status: props.autosaveStatus, path: props.path };
    if (!props.path || props.dirty) {
      setShowSaved(false);
      return;
    }
    if (before.dirty || before.status === 'saving' || (!before.path && props.path)) {
      setShowSaved(true);
      setSavedTick((tick) => tick + 1);
    }
  }, [props.path, props.dirty, props.autosaveStatus]);
  useEffect(() => {
    if (!savedTick) return;
    const timer = window.setTimeout(() => setShowSaved(false), 3000);
    return () => window.clearTimeout(timer);
  }, [savedTick]);
  const status = !props.desktop
    ? 'Browser preview'
    : saving
      ? 'Saving…'
      : props.autosaveStatus === 'error'
        ? 'Auto-save failed · save manually'
        : !props.path
          ? 'Draft · not saved to a file'
          : !props.dirty
            ? showSaved
              ? 'All changes saved'
              : ''
            : props.autosaveStatus === 'paused'
              ? 'Auto-save paused'
              : props.autosaveEnabled
                ? 'Changes pending…'
                : 'Unsaved changes';
  return (
    <div className="project-workspace-bar">
      <div
        hidden={!status}
        className={`project-persistence-state${props.autosaveStatus === 'error' ? ' failed' : ''}`}
        role="status"
        title={props.autosaveError ?? undefined}
      >
        {saving ? (
          <span className="spinner" />
        ) : props.autosaveStatus === 'error' ? (
          <CircleAlert size={13} />
        ) : props.path && !props.dirty ? (
          <Check size={13} />
        ) : (
          <span className="save-state-dot" />
        )}
        {status}
      </div>
      <div className="project-save-actions">
        {props.desktop && (
          <label
            className="autosave-toggle"
            title={
              props.path
                ? 'Automatically save validated changes to this file after a short pause'
                : 'Auto-save starts after you choose a file location with Save'
            }
          >
            <input
              type="checkbox"
              checked={props.autosaveEnabled}
              onChange={(event) => props.onAutosave(event.target.checked)}
            />
            Auto-save <span>{props.autosaveEnabled ? 'on' : 'off'}</span>
          </label>
        )}
        <button
          className={!props.path ? 'primary' : 'secondary'}
          disabled={!props.canSave || saving || (!!props.path && !props.dirty)}
          onClick={props.onSave}
          aria-label="Save project"
          title={props.path ?? 'Choose a project file location'}
        >
          <Save size={14} /> {props.path ? 'Save' : 'Save project…'}
        </button>
      </div>
    </div>
  );
}
