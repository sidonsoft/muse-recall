import type { ForgeArtifact, ForgeDiff } from '@mml/shared';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatBytes, shortSha } from '../../lib/format.ts';
import { Icon } from '../Icon.tsx';

type TokenKind = 'plain' | 'tag' | 'attr' | 'string' | 'comment' | 'doctype' | 'embedded';

interface Token {
  text: string;
  kind: TokenKind;
}

const KIND_CLASS: Record<TokenKind, string> = {
  plain: 'text-ink-dim',
  tag: 'text-[#e7c17c]',
  attr: 'text-[#9dc3e6]',
  string: 'text-[#9ed4a8]',
  comment: 'text-[#6f7787] italic',
  doctype: 'text-[#b7a0d8]',
  embedded: 'text-[#c9b48a]',
};

function tagTokens(tag: string): Token[] {
  const tokens: Token[] = [];
  let rest = tag;
  const push = (text: string, kind: TokenKind) => {
    if (text.length > 0) tokens.push({ text, kind });
  };

  const opener = /^(<\/?)/.exec(rest)?.[1];
  if (opener) {
    push(opener, 'tag');
    rest = rest.slice(opener.length);
  }

  const name = /^[a-zA-Z][\w:-]*/.exec(rest)?.[0];
  if (name) {
    push(name, 'tag');
    rest = rest.slice(name.length);
  }

  while (rest.length > 0) {
    const whitespace = /^\s+/.exec(rest)?.[0];
    if (whitespace) {
      push(whitespace, 'plain');
      rest = rest.slice(whitespace.length);
      continue;
    }
    const close = /^\/?>/.exec(rest)?.[0];
    if (close) {
      push(close, 'tag');
      rest = rest.slice(close.length);
      continue;
    }
    const attribute = /^[^\s=/>]+/.exec(rest)?.[0];
    if (attribute) {
      push(attribute, 'attr');
      rest = rest.slice(attribute.length);
      continue;
    }
    const equals = /^\s*=\s*/.exec(rest)?.[0];
    if (equals) {
      push(equals, 'plain');
      rest = rest.slice(equals.length);
      continue;
    }
    const value = /^("[^"]*"|'[^']*'|[^\s>]+)/.exec(rest)?.[0];
    if (value) {
      push(value, 'string');
      rest = rest.slice(value.length);
      continue;
    }
    push(rest[0] ?? '', 'plain');
    rest = rest.slice(1);
  }

  return tokens;
}

/**
 * A small HTML tokenizer for readable source.
 *
 * Script and style bodies are kept as opaque embedded text rather than being
 * colourised as markup, so the source view never lies about what is a tag.
 */
export function tokenizeHtml(html: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < html.length) {
    const next = html.indexOf('<', index);
    if (next === -1) {
      tokens.push({ text: html.slice(index), kind: 'plain' });
      break;
    }
    if (next > index) tokens.push({ text: html.slice(index, next), kind: 'plain' });

    if (html.startsWith('<!--', next)) {
      const end = html.indexOf('-->', next + 4);
      const stop = end === -1 ? html.length : end + 3;
      tokens.push({ text: html.slice(next, stop), kind: 'comment' });
      index = stop;
      continue;
    }
    if (html.startsWith('<!', next)) {
      const end = html.indexOf('>', next);
      const stop = end === -1 ? html.length : end + 1;
      tokens.push({ text: html.slice(next, stop), kind: 'doctype' });
      index = stop;
      continue;
    }

    const end = html.indexOf('>', next);
    if (end === -1) {
      tokens.push({ text: html.slice(next), kind: 'plain' });
      break;
    }
    const tag = html.slice(next, end + 1);
    for (const token of tagTokens(tag)) tokens.push(token);
    index = end + 1;

    const embedded = /^<(script|style)\b/i.exec(tag)?.[1];
    if (embedded) {
      const close = html.toLowerCase().indexOf(`</${embedded.toLowerCase()}`, index);
      if (close === -1) {
        tokens.push({ text: html.slice(index), kind: 'embedded' });
        index = html.length;
      } else {
        if (close > index) tokens.push({ text: html.slice(index, close), kind: 'embedded' });
        const closeEnd = html.indexOf('>', close);
        const stop = closeEnd === -1 ? html.length : closeEnd + 1;
        tokens.push({ text: html.slice(close, stop), kind: 'tag' });
        index = stop;
      }
    }
  }

  return tokens;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function SourcePanel({
  artifact,
  loading,
  error,
}: {
  artifact: ForgeArtifact | null;
  loading: boolean;
  error: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const tokens = useMemo(() => (artifact ? tokenizeHtml(artifact.html) : []), [artifact]);
  const lineCount = artifact ? Math.max(1, artifact.lines) : 0;

  if (loading) {
    return (
      <div className="flex h-full flex-col gap-2 p-4" aria-busy="true">
        <div className="skeleton h-4 w-48" />
        <div className="skeleton h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return <PanelEmpty icon="alert" title="Source is not available" body={error} />;
  }

  if (!artifact) {
    return (
      <PanelEmpty
        icon="code"
        title="No HTML to inspect yet"
        body="Generate a first version, or approve a staged change, and its source appears here."
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <span className="chip">
          {artifact.staged ? 'staged source' : `v${artifact.version ?? '—'}`}
        </span>
        <span className="font-mono text-[11px] text-ink-dim">index.html</span>
        <span className="text-[10.5px] text-muted">
          {artifact.lines} lines · {formatBytes(artifact.bytes)} · sha{' '}
          {shortSha(artifact.sha256, 10)}
        </span>
        <button
          type="button"
          onClick={() => {
            void copyText(artifact.html).then((ok) => {
              if (!ok) return;
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
          className="btn btn-sm ml-auto"
        >
          <Icon name={copied ? 'check' : 'code'} className="size-3.5" />
          {copied ? 'Copied' : 'Copy source'}
        </button>
      </div>
      <div className="flex min-h-0 flex-1 overflow-auto bg-[#0b0e14] font-mono text-[11.5px] leading-[1.7]">
        <div
          aria-hidden="true"
          className="sticky left-0 z-10 select-none border-r border-line bg-[#0b0e14] px-2 py-2 text-right text-muted/70"
        >
          {Array.from({ length: lineCount }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: gutter rows are positional by definition
            <div key={`gutter-${index + 1}`}>{index + 1}</div>
          ))}
        </div>
        <pre className="min-w-0 flex-1 px-3 py-2 text-ink-dim">
          <code>
            {tokens.map((token, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: the token stream is immutable for one artifact
              <span key={index} className={KIND_CLASS[token.kind]}>
                {token.text}
              </span>
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
}

interface DiffLine {
  id: number;
  kind: 'add' | 'del' | 'hunk' | 'meta' | 'context';
  text: string;
}

function parseDiff(diff: string): DiffLine[] {
  return diff.split('\n').map((line, index) => {
    if (line.startsWith('@@')) return { id: index, kind: 'hunk', text: line };
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ')) {
      return { id: index, kind: 'meta', text: line };
    }
    if (line.startsWith('+')) return { id: index, kind: 'add', text: line };
    if (line.startsWith('-')) return { id: index, kind: 'del', text: line };
    return { id: index, kind: 'context', text: line };
  });
}

export function DiffPanel({
  diff,
  onOpenSource,
}: {
  diff: ForgeDiff | null;
  onOpenSource: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [wrap, setWrap] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const file = diff?.files[0] ?? null;
  const lines = useMemo(() => (file ? parseDiff(file.diff) : []), [file]);
  const added = lines.filter((line) => line.kind === 'add').length;
  const removed = lines.filter((line) => line.kind === 'del').length;
  const net = added - removed;
  const large = Boolean(diff && added + removed > 60 && added > lines.length * 0.35);

  const jumpToAdditions = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    const target = container.querySelector('[data-diff-kind="add"]');
    if (!(target instanceof HTMLElement)) return;
    container.scrollTop =
      target.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      container.scrollTop -
      8;
  }, []);

  // A whole-file rewrite opens on the new code instead of a wall of removals.
  useEffect(() => {
    if (!large) return;
    const handle = requestAnimationFrame(jumpToAdditions);
    return () => cancelAnimationFrame(handle);
  }, [large, jumpToAdditions]);

  if (!diff || !file) {
    return (
      <PanelEmpty
        icon="diff"
        title="Nothing staged for review"
        body="Ask Studio generation for a change and its staged source diff appears here. The approved application is untouchable until you approve."
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line px-3 py-1.5">
        <span className="chip border-warn/30 bg-warn/10 text-warn">staged · not approved</span>
        <span className="font-mono text-[11px] text-ink-dim">{file.path}</span>
        <span className="text-[10.5px] text-ok">+{added}</span>
        <span className="text-[10.5px] text-err">−{removed}</span>
        <span className="text-[10.5px] text-muted">
          net {net >= 0 ? '+' : ''}
          {net}
        </span>
        {large ? (
          <span className="chip border-warn/30 bg-warn/10 text-warn">large rewrite</span>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={jumpToAdditions} className="btn btn-sm btn-quiet">
            Additions
          </button>
          <button
            type="button"
            onClick={() => setWrap((value) => !value)}
            aria-pressed={wrap}
            className={`btn btn-sm ${wrap ? '' : 'btn-quiet'}`}
            title={wrap ? 'Long lines wrap inside the pane' : 'Long lines scroll horizontally'}
          >
            {wrap ? 'Wrapped' : 'Wrap'}
          </button>
          <button type="button" onClick={onOpenSource} className="btn btn-sm">
            <Icon name="code" className="size-3.5" /> Source
          </button>
          <button
            type="button"
            onClick={() => {
              void copyText(file.diff).then((ok) => {
                if (!ok) return;
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              });
            }}
            className="btn btn-sm"
          >
            {copied ? 'Copied' : 'Copy diff'}
          </button>
        </div>
      </div>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto bg-[#0b0e14] py-1 font-mono text-[11.5px] leading-[1.7]"
      >
        {lines.map((line) => {
          const tone =
            line.kind === 'add'
              ? 'bg-ok/10 text-ok'
              : line.kind === 'del'
                ? 'bg-err/10 text-err'
                : line.kind === 'hunk'
                  ? 'bg-surface-2 text-accent'
                  : line.kind === 'meta'
                    ? 'text-muted'
                    : 'text-ink-dim';
          return (
            <div
              key={line.id}
              data-diff-kind={line.kind}
              className={`px-3 ${wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'} ${tone}`}
            >
              {line.text.length > 0 ? line.text : ' '}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function PanelEmpty({
  icon,
  title,
  body,
  action,
}: {
  icon: 'code' | 'diff' | 'alert' | 'spark';
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <span className="flex size-10 items-center justify-center rounded-xl border border-line bg-surface-2 text-muted">
        <Icon name={icon} className="size-4.5" />
      </span>
      <p className="text-[13px] font-medium text-ink">{title}</p>
      <p className="max-w-sm text-[11.5px] leading-relaxed text-muted">{body}</p>
      {action}
    </div>
  );
}
