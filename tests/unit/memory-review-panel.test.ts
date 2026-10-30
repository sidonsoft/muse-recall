import type { ReviewItem, ReviewQueue } from '@mml/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReviewQueuePanel } from '../../apps/web/src/components/memory/ReviewQueuePanel.tsx';

const MEMORY_ID = '22222222-2222-4222-8222-222222222222';

function item(overrides: Partial<ReviewItem> = {}): ReviewItem {
  return {
    memory: {
      id: MEMORY_ID,
      type: 'contextual_fact',
      scope: 'project',
      project_id: 'alpha',
      content: 'The <b>deploy step</b> runs after tests',
      source: { session_id: null, reference: null },
      confidence: 0.8,
      validation_status: 'unverified',
      status: 'active',
      created_at: '2026-10-01T00:00:00Z',
      updated_at: '2026-10-01T00:00:00Z',
      expires_at: null,
      revision: 1,
      tags: [],
    },
    reasons: ['unverified'],
    days_until_expiry: null,
    ...overrides,
  };
}

function render(queue: ReviewQueue | null): string {
  return renderToStaticMarkup(
    createElement(ReviewQueuePanel, {
      queue,
      busyId: null,
      onVerify: () => undefined,
      onDispute: () => undefined,
      onExtend: () => undefined,
      onOpen: () => undefined,
    }),
  );
}

describe('ReviewQueuePanel (G-9)', () => {
  it('renders an empty state that states the guarantee', () => {
    const html = render({ items: [], total: 0, horizon_days: 7 });
    expect(html).toContain('Nothing needs a decision');
    expect(html).toContain('7');
  });

  it('renders reasons as escaped text, never markup', () => {
    const html = render({
      items: [item({ reasons: ['disputed', 'expired'], days_until_expiry: -3 })],
      total: 1,
      horizon_days: 7,
    });
    expect(html).toContain('disputed claim');
    expect(html).toContain('expired 3 days ago');
    expect(html).toContain('&lt;b&gt;deploy step&lt;/b&gt;');
    expect(html).not.toContain('<b>deploy step</b>');
  });

  it('shows expiry actions only for dated memories and counts in the header', () => {
    const html = render({
      items: [item({ reasons: ['expiring'], days_until_expiry: 1 })],
      total: 9,
      horizon_days: 7,
    });
    expect(html).toContain('expires in 1 day');
    expect(html).not.toContain('Extend 30d');
    const dated = render({
      items: [
        item({
          reasons: ['expiring'],
          days_until_expiry: 2,
          memory: { ...item().memory, expires_at: '2026-11-01T00:00:00Z' },
        }),
      ],
      total: 1,
      horizon_days: 7,
    });
    expect(dated).toContain('Extend 30d');
  });
});
