import type { IconName } from './components/Icon.tsx';

export type ViewId =
  | 'overview'
  | 'conversations'
  | 'projects'
  | 'memories'
  | 'tools'
  | 'evaluations'
  | 'settings';

export interface ViewDefinition {
  id: ViewId;
  label: string;
  icon: IconName;
  /** Delivery phase from the build brief. 1 means it works today. */
  phase: number;
  /** One line describing what the section will do, shown while unimplemented. */
  description: string;
}

export const VIEWS: ViewDefinition[] = [
  {
    id: 'overview',
    label: 'System',
    icon: 'system',
    phase: 1,
    description: 'Runtime status for the API, the database, and the Muse integration.',
  },
  {
    id: 'conversations',
    label: 'Conversations',
    icon: 'chat',
    phase: 3,
    description: 'Chat with the agent harness, with each turn retrieving the memories that matter.',
  },
  {
    id: 'projects',
    label: 'Projects',
    icon: 'projects',
    phase: 4,
    description: 'Project workspaces, generated dashboards, and planning interfaces.',
  },
  {
    id: 'memories',
    label: 'Memories',
    icon: 'memory',
    phase: 2,
    description: 'Inspect stored memories with provenance, confidence, and correction history.',
  },
  {
    id: 'tools',
    label: 'Tools',
    icon: 'tools',
    phase: 5,
    description: 'The tool registry, permission policy, and an audit log of every call.',
  },
  {
    id: 'evaluations',
    label: 'Evaluations',
    icon: 'eval',
    phase: 6,
    description: 'Baseline versus memory-enabled runs, scored on the same tasks.',
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: 'settings',
    phase: 6,
    description: 'Provider, persistence, and safety configuration for this install.',
  },
];

export function viewById(id: ViewId): ViewDefinition {
  const found = VIEWS.find((view) => view.id === id);
  if (!found) {
    throw new Error(`Unknown view: ${id}`);
  }
  return found;
}
