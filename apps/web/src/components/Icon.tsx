/**
 * Minimal inline icon set.
 *
 * Hand-rolled rather than pulled from an icon package: six glyphs do not
 * justify a dependency, and inline SVG guarantees the interface renders with
 * no network access.
 */
export type IconName =
  | 'chat'
  | 'projects'
  | 'memory'
  | 'tools'
  | 'eval'
  | 'settings'
  | 'system'
  | 'check'
  | 'alert'
  | 'x'
  | 'refresh'
  | 'spark'
  | 'bolt'
  | 'search'
  | 'edit'
  | 'trash'
  | 'history'
  | 'plus'
  | 'close'
  | 'layers'
  | 'tag'
  | 'chevronDown'
  | 'chevronRight'
  | 'code'
  | 'download'
  | 'diff'
  | 'play'
  | 'external'
  | 'arrowRight'
  | 'clock'
  | 'branch';

const PATHS: Record<IconName, string> = {
  chat: 'M21 12a8 8 0 0 1-8 8H7l-4 3v-6.5A8 8 0 0 1 13 4a8 8 0 0 1 8 8Z',
  projects: 'M3 7h6l2 2h10v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Zm0 3h18',
  memory: 'M12 3v18M5 7h14M5 17h14M8 7v10M16 7v10',
  tools: 'M14.7 6.3a4 4 0 1 0 5 5L21 21H3l8.7-8.7a4 4 0 0 1 3-6Z',
  eval: 'M4 20V10m5 10V4m5 16v-7m5 7V8',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8-3a8 8 0 0 0-.2-1.7l2-1.6-2-3.4-2.4 1a8 8 0 0 0-2.9-1.7L14 2h-4l-.5 2.6A8 8 0 0 0 6.6 6.3l-2.4-1-2 3.4 2 1.6A8 8 0 0 0 4 12',
  system: 'M4 5h16v11H4V5Zm5 15h6m-3-4v4',
  check: 'M20 6 9 17l-5-5',
  alert:
    'M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  x: 'M18 6 6 18M6 6l12 12',
  refresh: 'M21 12a9 9 0 1 1-3-6.7M21 3v6h-6',
  spark: 'M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18',
  bolt: 'm13 2-9 12h7l-1 8 9-12h-7l1-8Z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm10 2-4.35-4.35',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z',
  trash: 'M3 6h18M8 6V4h8v2M7 6l1 14h8l1-14M10 11v6M14 11v6',
  history: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 8v4l3 2',
  plus: 'M12 5v14M5 12h14',
  close: 'M18 6 6 18M6 6l12 12',
  layers: 'm12 3 9 5-9 5-9-5 9-5Zm9 9-9 5-9-5m18 4-9 5-9-5',
  tag: 'M20 12 12 4H4v8l8 8 8-8ZM8 8h.01',
  chevronDown: 'm6 9 6 6 6-6',
  chevronRight: 'm9 6 6 6-6 6',
  code: 'm9 18-6-6 6-6m6 12 6-6-6-6',
  download: 'M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
  diff: 'M6 3v12m0 0a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM18 21V9m0 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 6h9a3 3 0 0 1 3 3M18 18H9a3 3 0 0 1-3-3',
  play: 'm8 5 11 7-11 7V5Z',
  external: 'M14 3h7v7M21 3l-9 9M10 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5',
  arrowRight: 'M4 12h16m-6-6 6 6-6 6',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v5l3 2',
  branch:
    'M6 3v12m0 0a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM18 6a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 0v3a4 4 0 0 1-4 4H6',
};

export function Icon({ name, className = 'size-4' }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
