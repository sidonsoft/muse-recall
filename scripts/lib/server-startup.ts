/**
 * When a live gate's own server dies before it answers a readiness probe, the operator
 * needs the reason the server gave, not the bottom of its stack.
 *
 * Reading the log backwards produced messages like
 *
 *   the server process exited (1) before becoming ready: e:///…dist/index.js:7488:11)
 *
 * which is the tail of a stack trace. The line that named the actual cause —
 * `Fatal startup error: Invalid environment configuration — FORGE_MUSE_API_KEY: Too
 * small: expected string to have >=10 characters` — sat at the top and was cut off.
 *
 * So: prefer the server's own error line, fall back to the first line, always bound the
 * result, and never return an empty string (a message that ends in nothing reads as
 * though there was nothing to report).
 */

const DEFAULT_LIMIT = 300;

/** Lines that state a cause, in the order a reader would want them. */
const CAUSE_PATTERNS: readonly RegExp[] = [
  /^Fatal startup error\b/,
  /^\w*Error: /,
  /^Error\b/,
  /^FATAL\b/,
];

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function startupFailureExcerpt(log: string, limit: number = DEFAULT_LIMIT): string {
  const lines = log
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (lines.length === 0) return '(the server wrote nothing to its log)';
  for (const pattern of CAUSE_PATTERNS) {
    const index = lines.findIndex((line) => pattern.test(line));
    if (index === -1) continue;
    const line = lines[index] ?? '';
    // A cause line that ends in a colon or dash continues on the next line (the config
    // validator wraps that way), so quoting only the matched line would drop the part
    // that names the offending field.
    const next = lines[index + 1];
    const continues = /[:—]$/.test(line) && next !== undefined && !/^\s*at /.test(next);
    return bound(continues ? `${line} ${next}` : line, limit);
  }
  return bound(oneLine(lines[0] ?? ''), limit);
}

function bound(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - 1))}…`;
}
