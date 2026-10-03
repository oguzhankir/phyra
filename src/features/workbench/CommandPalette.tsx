import { ArrowUpRight, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export type CommandAction = {
  id: string;
  label: string;
  description: string;
  group: string;
  keywords?: string;
  disabled?: boolean;
  action: () => void;
};

export default function CommandPalette({
  commands,
  onClose,
}: {
  commands: CommandAction[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const matches = commands.filter((command) => {
    const text =
      `${command.label} ${command.description} ${command.group} ${command.keywords ?? ''}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
  const selected = Math.min(active, matches.length - 1);
  const choose = (command: CommandAction) => {
    if (command.disabled) return;
    onClose();
    command.action();
  };
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [active, query]);
  return (
    <div
      className="modal-backdrop command-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="modal command-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-title"
        aria-describedby="command-description"
        onKeyDown={(event) => {
          if (
            (event.metaKey || event.ctrlKey) &&
            ['s', 'o', 'n'].includes(event.key.toLowerCase())
          ) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        <div className="command-heading">
          <h2 id="command-title">Search actions</h2>
          <button aria-label="Close command search" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <p id="command-description" className="command-description">
          Jump to an editor or run a project action.
        </p>
        <div className="command-input">
          <div className="command-search-field">
            <Search size={17} aria-hidden="true" />
            <input
              role="combobox"
              aria-label="Search actions and editors"
              aria-expanded="true"
              aria-controls="command-results"
              aria-activedescendant={
                matches[selected] ? `command-option-${matches[selected].id}` : undefined
              }
              autoComplete="off"
              placeholder="Geometry, loads, mesh, save…"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && matches[selected]) {
                  event.preventDefault();
                  choose(matches[selected]);
                }
                if (!['ArrowDown', 'ArrowUp'].includes(event.key) || !matches.length) return;
                event.preventDefault();
                const direction = event.key === 'ArrowDown' ? 1 : -1;
                let index = selected;
                for (let count = 0; count < matches.length; count++) {
                  index = (index + direction + matches.length) % matches.length;
                  if (!matches[index].disabled) break;
                }
                setActive(index);
              }}
            />
          </div>
        </div>
        <div
          id="command-results"
          className="command-results"
          role="listbox"
          aria-label="Matching actions"
          ref={list}
        >
          {matches.map((command, index) => (
            <button
              id={`command-option-${command.id}`}
              key={command.id}
              role="option"
              aria-selected={index === selected}
              disabled={command.disabled}
              onPointerMove={() => setActive(index)}
              onClick={() => choose(command)}
            >
              <span>
                <strong>{command.label}</strong>
                <small>{command.description}</small>
              </span>
              <span className="command-group">{command.group}</span>
              <ArrowUpRight size={14} />
            </button>
          ))}
          {!matches.length && (
            <p className="command-empty">
              No matching action. Try a section name such as “geometry” or “results”.
            </p>
          )}
        </div>
        <div className="command-footer">
          <span>↑ ↓ to choose · Enter to open</span>
          <span>Esc to close</span>
        </div>
      </div>
    </div>
  );
}
