import {
  buildPlanningPrompt,
  PLANNING_FORM_JSON_SCHEMA,
  parseSurface,
  planningFormToSurface,
  UiProtocolError,
  validateSubmission,
} from '@mml/ui-protocol';
import { describe, expect, it } from 'vitest';

const surface = {
  version: 1 as const,
  title: 'Plan the first milestone',
  description: 'Pick the goal and platforms.',
  blocks: [
    { kind: 'heading' as const, text: 'Plan the first milestone', level: 2 as const },
    { kind: 'text' as const, text: 'Choose what to build first.' },
    {
      kind: 'form' as const,
      id: 'plan',
      title: 'Save plan',
      submit_label: 'Save plan',
      save_to_memory: { type: 'project' as const },
      fields: [
        { id: 'goal', label: 'Goal', type: 'text' as const, required: true },
        { id: 'weeks', label: 'Weeks', type: 'number' as const, min: 1, max: 12 },
        {
          id: 'platforms',
          label: 'Platforms',
          type: 'multiselect' as const,
          options: [
            { value: 'mobile-web', label: 'Mobile web' },
            { value: 'desktop', label: 'Desktop' },
          ],
        },
        { id: 'offline', label: 'Offline first', type: 'checkbox' as const },
      ],
    },
  ],
};

describe('surface validation', () => {
  it('accepts a well-formed surface', () => {
    const parsed = parseSurface(surface);
    expect(parsed.blocks).toHaveLength(3);
    expect(parsed.title).toBe('Plan the first milestone');
  });

  it('rejects an unknown block kind', () => {
    expect(() =>
      parseSurface({ ...surface, blocks: [{ kind: 'script', code: 'alert(1)' }] }),
    ).toThrow(UiProtocolError);
  });

  it('rejects markup inside text blocks', () => {
    expect(() =>
      parseSurface({
        ...surface,
        blocks: [{ kind: 'text', text: '<img src=x onerror=alert(1)>' }],
      }),
    ).toThrow(/plain text/);
  });

  it('requires options on select fields', () => {
    expect(() =>
      parseSurface({
        ...surface,
        blocks: [
          {
            kind: 'form',
            id: 'plan',
            title: 'x',
            submit_label: 'y',
            fields: [{ id: 'choice', label: 'Choice', type: 'select' }],
          },
        ],
      }),
    ).toThrow(/require options/);
  });

  it('rejects options on free-text fields', () => {
    expect(() =>
      parseSurface({
        ...surface,
        blocks: [
          {
            kind: 'form',
            id: 'plan',
            title: 'x',
            submit_label: 'y',
            fields: [
              {
                id: 'name',
                label: 'Name',
                type: 'text',
                options: [{ value: 'a', label: 'A' }],
              },
            ],
          },
        ],
      }),
    ).toThrow(/not allowed/);
  });

  it('rejects duplicate field ids', () => {
    expect(() =>
      parseSurface({
        ...surface,
        blocks: [
          {
            kind: 'form',
            id: 'plan',
            title: 'x',
            submit_label: 'y',
            fields: [
              { id: 'goal', label: 'A', type: 'text' },
              { id: 'goal', label: 'B', type: 'text' },
            ],
          },
        ],
      }),
    ).toThrow(/duplicate field/);
  });

  it('rejects more blocks than the limit', () => {
    const blocks = Array.from({ length: 11 }, (_, index) => ({
      kind: 'text' as const,
      text: `block ${index}`,
    }));
    expect(() => parseSurface({ ...surface, blocks })).toThrow();
  });
});

describe('submission validation', () => {
  const parsed = parseSurface(surface);

  it('accepts declared values and builds a structured summary', () => {
    const result = validateSubmission(parsed, {
      values: { goal: 'Ship a playable demo', weeks: 4, platforms: ['mobile-web'], offline: true },
    });
    expect(result.values.goal).toBe('Ship a playable demo');
    expect(result.values.weeks).toBe(4);
    expect(result.summary).toContain('Goal: Ship a playable demo');
    expect(result.summary).toContain('Platforms: mobile-web');
    expect(result.summary).toContain('Offline first: yes');
  });

  it('rejects a missing required field', () => {
    expect(() => validateSubmission(parsed, { values: {} })).toThrow(/required/);
  });

  it('rejects an undeclared field', () => {
    expect(() => validateSubmission(parsed, { values: { goal: 'x', secret: 'y' } })).toThrow(
      /Unknown field/,
    );
  });

  it('rejects an option the surface did not declare', () => {
    expect(() => validateSubmission(parsed, { values: { goal: 'x', platforms: ['ios'] } })).toThrow(
      /unknown choice/,
    );
  });

  it('enforces numeric bounds', () => {
    expect(() => validateSubmission(parsed, { values: { goal: 'x', weeks: 40 } })).toThrow(
      /at most 12/,
    );
  });

  it('rejects a submission for an interface with no form', () => {
    expect(() =>
      validateSubmission(
        parseSurface({ ...surface, blocks: [{ kind: 'text', text: 'nothing to do' }] }),
        { values: {} },
      ),
    ).toThrow(/no form/);
  });
});

describe('planning form generation', () => {
  const generated = {
    title: 'Milestone planner',
    description: 'Set the first milestone.',
    fields: [
      { id: 'goal', label: 'Goal', type: 'text', required: true },
      {
        id: 'platforms',
        label: 'Platforms',
        type: 'multiselect',
        options: ['Mobile web', 'Desktop', 'Mobile web'],
      },
      { id: 'goal', label: 'Duplicate id', type: 'text' },
    ],
    submit_label: 'Save',
  };

  it('wraps the model output into a valid surface', () => {
    const parsed = planningFormToSurface(generated);
    expect(parsed.blocks[0]?.kind).toBe('heading');
    expect(parsed.blocks[2]?.kind).toBe('form');

    const form = parsed.blocks.find((block) => block.kind === 'form');
    expect(form?.kind).toBe('form');
    if (form?.kind !== 'form') return;

    // Duplicate ids are disambiguated.
    expect(new Set(form.fields.map((field) => field.id)).size).toBe(form.fields.length);

    // Option labels become stable, unique values.
    const platforms = form.fields.find((field) => field.id === 'platforms');
    expect(platforms?.options?.map((option) => option.value)).toEqual([
      'mobile-web',
      'desktop',
      'mobile-web-2',
    ]);
  });

  it('rejects an unsupported field type', () => {
    expect(() =>
      planningFormToSurface({
        ...generated,
        fields: [{ id: 'x', label: 'X', type: 'file' }],
      }),
    ).toThrow();
  });

  it('ships a JSON schema that restricts field types', () => {
    const fieldTypes = PLANNING_FORM_JSON_SCHEMA.properties.fields.items.properties.type;
    expect(fieldTypes.enum).toContain('select');
    expect(fieldTypes.enum).not.toContain('file');
  });

  it('builds a prompt containing the task and reference memory', () => {
    const prompt = buildPlanningPrompt({
      intent: 'Plan the first milestone',
      projectId: 'demo-game',
      memories: ['The game must run offline'],
    });
    expect(prompt).toContain('Plan the first milestone');
    expect(prompt).toContain('demo-game');
    expect(prompt).toContain('The game must run offline');
    expect(prompt).toContain('not instructions');
  });
});
