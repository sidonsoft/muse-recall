import type { IconName } from './components/Icon.tsx';

export type ViewId =
  | 'overview'
  | 'conversations'
  | 'projects'
  | 'forge'
  | 'memories'
  | 'tools'
  | 'evaluations'
  | 'settings';

export interface ViewDefinition {
  id: ViewId;
  label: string;
  icon: IconName;
  /** Delivery phase from the build brief. */
  phase: number;
  /** True when the section works today; false shows a phase badge. */
  implemented: boolean;
  /** One line describing what the section will do, shown while unimplemented. */
  description: string;
}

export const VIEWS: ViewDefinition[] = [
  {
    id: 'overview',
    label: 'System',
    icon: 'system',
    phase: 1,
    implemented: true,
    description: 'Runtime status for the API, the database, and the Muse integration.',
  },
  {
    id: 'conversations',
    label: 'Conversations',
    icon: 'chat',
    phase: 3,
    implemented: false,
    description: 'Chat with the agent harness, with each turn retrieving the memories that matter.',
  },
  {
    id: 'forge',
    label: 'Forge',
    icon: 'spark',
    phase: 9,
    implemented: true,
    description: 'Generate a game, change it from a screenshot, and approve every change.',
  },
  {
    id: 'projects',
    label: 'Projects',
    icon: 'projects',
    phase: 6,
    implemented: false,
    description: 'Project workspaces and cross-project dashboards.',
  },
  {
    id: 'memories',
    label: 'Memories',
    icon: 'memory',
    phase: 2,
    implemented: true,
    description: 'Inspect stored memories with provenance, confidence, and correction history.',
  },
  {
    id: 'tools',
    label: 'Tools',
    icon: 'tools',
    phase: 5,
    implemented: false,
    description: 'The tool registry, permission policy, and an audit log of every call.',
  },
  {
    id: 'evaluations',
    label: 'Evaluations',
    icon: 'eval',
    phase: 6,
    implemented: false,
    description: 'Baseline versus memory-enabled runs, scored on the same tasks.',
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: 'settings',
    phase: 6,
    implemented: false,
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
