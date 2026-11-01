import { describe, expect, it } from 'vitest';
import { MediaAdapter, type MediaFetch } from '../../apps/server/src/media/adapter.js';
import { MediaVisualReview } from '../../apps/server/src/media/segment.js';

/**
 * Batch E — screenshot review validation. The transport is a fake: these tests
 * pin what the server accepts as a finding and what it refuses to turn into
 * one, with no provider traffic.
 */

const ID_A = '2f1c6a44-6f0f-4b0c-9f2a-6c9b0d000001';
const ID_B = '2f1c6a44-6f0f-4b0c-9f2a-6c9b0d000002';
const ID_OUTSIDE = '2f1c6a44-6f0f-4b0c-9f2a-6c9b0d000009';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function completed(text: string, model = 'muse-spark-1.3-actual'): Response {
  return jsonResponse({
    id: 'resp_review_1',
    status: 'completed',
    model,
    output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
  });
}

function reviewAdapter(body: Response, capture?: (payload: unknown) => void) {
  const fetchImpl: MediaFetch = async (_url, init) => {
    if (capture !== undefined && typeof init?.body === 'string') capture(JSON.parse(init.body));
    return body;
  };
  return new MediaAdapter({ apiKey: 'test-key', maxRetries: 0, fetchImpl });
}

function review(body: Response, capture?: (payload: unknown) => void): MediaVisualReview {
  return new MediaVisualReview(reviewAdapter(body, capture), { model: 'muse-spark-1.3' });
}

const IMAGE = {
  bytes: Buffer.from('not-really-a-png-but-the-adapter-does-not-care'),
  mime: 'image/png',
};
const DECISIONS = [
  { id: ID_A, text: 'Theme: woodland, ocean only for the background.' },
  { id: ID_B, text: 'Never show a countdown timer.' },
];

const finding = (
  decision_id: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  decision_id,
  verdict: 'possible_conflict',
  evidence: 'a blue bar across the bottom of the frame',
  uncertainty: 'a still frame cannot show whether the bar counts down',
  confidence: 0.7,
  ...extra,
});

describe('MediaVisualReview.review', () => {
  it('returns findings that name evidence and uncertainty', async () => {
    const result = await review(
      completed(JSON.stringify({ findings: [finding(ID_A), finding(ID_B)] })),
    ).review(IMAGE, DECISIONS);
    expect(result.findings).toHaveLength(2);
    expect(result.findings[0]).toMatchObject({
      decision_id: ID_A,
      verdict: 'possible_conflict',
      confidence: 0.7,
    });
    expect(result.unverified).toEqual([]);
    expect(result.ignored).toBe(0);
    expect(result.model).toBe('muse-spark-1.3');
    expect(result.observedModel).toBe('muse-spark-1.3-actual');
    expect(result.attempts).toBe(1);
  });

  it('sends the selected decision ids and forbids inventing scope', async () => {
    let payload: Record<string, unknown> = {};
    await review(completed(JSON.stringify({ findings: [] })), (body) => {
      payload = body as Record<string, unknown>;
    }).review(IMAGE, DECISIONS);
    const input = payload.input as Array<{ content: Array<{ type: string; text?: string }> }>;
    const text = input[0]?.content
      .filter((part) => part.type === 'input_text')
      .map((part) => part.text ?? '')
      .join('\n');
    expect(text).toContain(ID_A);
    expect(text).toContain(ID_B);
    expect(text).toContain('use only the ids given below');
    expect(text).toContain('Respond with JSON only');
    expect(payload.model).toBe('muse-spark-1.3');
    const imageParts = input[0]?.content.filter((part) => part.type === 'input_image');
    expect(imageParts).toHaveLength(1);
  });

  it('counts an entry for a decision nobody selected instead of trusting it', async () => {
    const result = await review(
      completed(JSON.stringify({ findings: [finding(ID_OUTSIDE)] })),
    ).review(IMAGE, DECISIONS);
    expect(result.findings).toEqual([]);
    expect(result.ignored).toBe(1);
    expect(result.unverified.map((entry) => entry.decision_id).sort()).toEqual([ID_A, ID_B]);
  });

  it('keeps the first answer about a decision and ignores a duplicate', async () => {
    const result = await review(
      completed(
        JSON.stringify({
          findings: [
            finding(ID_A, { evidence: 'first answer' }),
            finding(ID_A, { evidence: 'second answer' }),
          ],
        }),
      ),
    ).review(IMAGE, DECISIONS);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.evidence).toBe('first answer');
    expect(result.ignored).toBe(1);
  });

  it('reports an unassessed decision as unverified, never as consistent', async () => {
    const result = await review(completed(JSON.stringify({ findings: [finding(ID_A)] }))).review(
      IMAGE,
      DECISIONS,
    );
    expect(result.findings).toHaveLength(1);
    expect(result.unverified).toEqual([{ decision_id: ID_B, reason: expect.any(String) }]);
    expect(result.unverified[0]?.reason).toContain('did not report');
  });

  it('refuses a finding that names no evidence in the frame', async () => {
    const result = await review(
      completed(
        JSON.stringify({
          findings: [finding(ID_A, { evidence: '   ' }), finding(ID_B, { evidence: 42 })],
        }),
      ),
    ).review(IMAGE, DECISIONS);
    expect(result.findings).toEqual([]);
    expect(result.unverified).toHaveLength(2);
    for (const entry of result.unverified) expect(entry.reason).toContain('evidence');
  });

  it('refuses a finding that states no uncertainty about a still frame', async () => {
    const result = await review(
      completed(JSON.stringify({ findings: [finding(ID_A, { uncertainty: '' }), finding(ID_B)] })),
    ).review(IMAGE, DECISIONS);
    expect(result.findings.map((entry) => entry.decision_id)).toEqual([ID_B]);
    expect(result.unverified[0]?.decision_id).toBe(ID_A);
    expect(result.unverified[0]?.reason).toContain('uncertainty');
  });

  it('refuses a verdict outside the three allowed ones', async () => {
    for (const verdict of ['approved', 'violation', '', 42, null]) {
      const result = await review(
        completed(
          JSON.stringify({ findings: [finding(ID_A, { verdict }), finding(ID_B, { verdict })] }),
        ),
      ).review(IMAGE, DECISIONS);
      expect(result.findings).toEqual([]);
      for (const entry of result.unverified) expect(entry.reason).toContain('verdict');
    }
  });

  it('bounds a reported confidence instead of trusting it', async () => {
    const result = await review(
      completed(
        JSON.stringify({
          findings: [finding(ID_A, { confidence: 9 }), finding(ID_B, { confidence: 'very sure' })],
        }),
      ),
    ).review(IMAGE, DECISIONS);
    const byId = new Map(result.findings.map((entry) => [entry.decision_id, entry.confidence]));
    expect(byId.get(ID_A)).toBe(1);
    expect(byId.get(ID_B)).toBe(0.5);
  });

  it('truncates oversized evidence and uncertainty instead of echoing them whole', async () => {
    const result = await review(
      completed(
        JSON.stringify({
          findings: [
            finding(ID_A, { evidence: 'e'.repeat(2_000), uncertainty: 'u'.repeat(2_000) }),
            finding(ID_B),
          ],
        }),
      ),
    ).review(IMAGE, DECISIONS);
    const first = result.findings.find((entry) => entry.decision_id === ID_A) as {
      evidence: string;
      uncertainty: string;
    };
    expect(first.evidence.length).toBeLessThanOrEqual(600);
    expect(first.uncertainty.length).toBeLessThanOrEqual(400);
  });

  it('fails closed on non-JSON, refusals, and a missing findings array', async () => {
    const cases: Response[] = [
      completed('the app looks fine to me, nothing to worry about'),
      completed('```json\n{"findings": [oops\n```'),
      completed(JSON.stringify({ results: [] })),
      completed(''),
      jsonResponse({
        id: 'resp_refused',
        status: 'completed',
        output: [
          { type: 'message', content: [{ type: 'refusal', refusal: 'I cannot look at this.' }] },
        ],
      }),
      jsonResponse({ id: 'resp_err', status: 'failed', error: { message: 'upstream said no' } }),
    ];
    for (const body of cases) {
      const failure = await review(body)
        .review(IMAGE, DECISIONS)
        .catch((error: unknown) => error);
      expect(failure).toMatchObject({ code: 'provider_invalid_output' });
    }
  });

  it('makes exactly one provider dispatch when the retry budget is zero', async () => {
    let dispatches = 0;
    const adapter = new MediaAdapter({
      apiKey: 'test-key',
      maxRetries: 0,
      fetchImpl: async () => {
        dispatches += 1;
        return completed(JSON.stringify({ findings: [finding(ID_A), finding(ID_B)] }));
      },
    });
    const result = await new MediaVisualReview(adapter, { model: 'muse-spark-1.3' }).review(
      IMAGE,
      DECISIONS,
    );
    expect(dispatches).toBe(1);
    expect(result.attempts).toBe(1);
  });

  it('refuses to review against an empty decision set', async () => {
    const failure = await review(completed(JSON.stringify({ findings: [] })))
      .review(IMAGE, [])
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: 'invalid_request' });
  });

  it('accepts a fenced JSON payload', async () => {
    const result = await review(
      completed(
        `\`\`\`json\n${JSON.stringify({ findings: [finding(ID_A), finding(ID_B)] })}\n\`\`\``,
      ),
    ).review(IMAGE, DECISIONS);
    expect(result.findings).toHaveLength(2);
  });
});
