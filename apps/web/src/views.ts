import type { IconName } from './components/Icon.tsx';

export type ViewId = 'studio' | 'memories' | 'conversations' | 'system';

export interface ViewDefinition {
  id: ViewId;
  label: string;
  icon: IconName;
  /** One line describing the surface, shown under the page title. */
  description: string;
}

/**
 * Primary surfaces only.
 *
 * Earlier revisions listed unbuilt phases in the navigation; that made a
 * working product read like a prototype roadmap. A surface appears here when
 * it works in this build.
 */
export const VIEWS: ViewDefinition[] = [
  {
    id: 'studio',
    label: 'HTML Studio',
    icon: 'spark',
    description: 'From prompt to working browser application.',
  },
  {
    id: 'memories',
    label: 'Memory',
    icon: 'memory',
    description: 'The decisions Muse Recall remembers, and where they came from.',
  },
  {
    id: 'conversations',
    label: 'Conversations',
    icon: 'chat',
    description: 'Work with the agent; each turn retrieves the memories that matter.',
  },
  {
    id: 'system',
    label: 'System',
    icon: 'system',
    description: 'Runtime health, the Muse integration, and the safety posture.',
  },
];

export function viewById(id: ViewId): ViewDefinition {
  const found = VIEWS.find((view) => view.id === id);
  if (!found) {
    throw new Error(`Unknown view: ${id}`);
  }
  return found;
}
