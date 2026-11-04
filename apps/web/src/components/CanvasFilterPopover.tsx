import type { NodeStatus } from '@n2/contracts';
import { useEffect, useId, useRef, useState } from 'react';
import { isTextSearchActive } from '../canvasFilter.js';
import { useSuspendNotificationExpiry } from '../notificationContext.js';
import { nodeStatusOptions } from '../statusPresentation.js';
import './CanvasFilterPopover.css';

export function CanvasFilterPopover({
  hiddenStatuses,
  textQuery,
  onTextQueryChange,
  onToggleStatus
}: {
  hiddenStatuses: ReadonlySet<NodeStatus>;
  textQuery: string;
  onTextQueryChange: (query: string) => void;
  onToggleStatus: (status: NodeStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const hiddenCount = hiddenStatuses.size;
  const searchActive = isTextSearchActive(textQuery);
  const activeCount = hiddenCount + (searchActive ? 1 : 0);
  // The open panel can cover the toast lane above the toolbar.
  useSuspendNotificationExpiry(open);

  useEffect(() => {
    if (!open) return;

    const isOutside = (target: EventTarget | null): target is Node =>
      target instanceof Node && !root.current?.contains(target);
    const blockOutsidePointerDown = (event: PointerEvent): void => {
      if (!isOutside(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const dismissOutside = (event: MouseEvent): void => {
      if (!isOutside(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    };
    const dismissWithEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };

    document.addEventListener('pointerdown', blockOutsidePointerDown, true);
    document.addEventListener('click', dismissOutside, true);
    document.addEventListener('keydown', dismissWithEscape);
    return () => {
      document.removeEventListener('pointerdown', blockOutsidePointerDown, true);
      document.removeEventListener('click', dismissOutside, true);
      document.removeEventListener('keydown', dismissWithEscape);
    };
  }, [open]);

  const statusSummary = `${hiddenCount} ${hiddenCount === 1 ? 'status' : 'statuses'} hidden`;
  const activeSummary =
    activeCount === 0
      ? 'No active filters'
      : [hiddenCount > 0 ? statusSummary : null, searchActive ? 'Text search active' : null]
          .filter(Boolean)
          .join(' · ');

  return (
    <div className="canvas-filter-popover" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="canvas-filter-popover__trigger"
        data-filter-active={activeCount > 0}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
        title={`Canvas filters · ${activeSummary}`}
      >
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <path d="M2.5 3.25h11L9.35 8v3.65l-2.7 1.3V8L2.5 3.25Z" />
        </svg>
        <span>Filters</span>
        {activeCount > 0 ? (
          <strong className="canvas-filter-popover__count" aria-label={activeSummary}>
            {activeCount}
          </strong>
        ) : null}
      </button>
      {open ? (
        <section id={panelId} className="canvas-filter-popover__panel" aria-label="Canvas filters">
          <header>
            <strong>Canvas filters</strong>
            {activeCount > 0 ? <small>{activeSummary}</small> : null}
          </header>
          <label className="canvas-filter-popover__search">
            <span>Title or reference</span>
            <div>
              <svg aria-hidden="true" viewBox="0 0 16 16">
                <circle cx="7" cy="7" r="4.25" />
                <path d="m10.25 10.25 3 3" />
              </svg>
              <input
                type="search"
                value={textQuery}
                placeholder="Search titles or N2-42"
                autoFocus
                onChange={(event) => onTextQueryChange(event.currentTarget.value)}
              />
              {textQuery.length > 0 ? (
                <button
                  type="button"
                  className="canvas-filter-popover__clear"
                  aria-label="Clear text search"
                  onClick={() => onTextQueryChange('')}
                >
                  ×
                </button>
              ) : null}
            </div>
          </label>
          <span className="canvas-filter-popover__section-label">Effective status</span>
          <div className="canvas-filter-popover__options" role="group" aria-label="Status filters">
            {nodeStatusOptions.map((option) => {
              const shown = !hiddenStatuses.has(option.status);
              return (
                <button
                  key={option.status}
                  type="button"
                  className="canvas-filter-popover__option"
                  data-status-filter={option.status}
                  aria-pressed={shown}
                  aria-label={`${option.label} work is ${shown ? 'shown' : 'hidden'}`}
                  onClick={() => onToggleStatus(option.status)}
                >
                  <i className={`status-dot status-dot--${option.status}`} aria-hidden="true" />
                  <span>{option.label}</span>
                  <small>{shown ? 'Shown' : 'Hidden'}</small>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
