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
  | 'bolt';

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
