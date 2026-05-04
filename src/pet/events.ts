import type { PetActionAnimationId } from './animation';

export const COMPANION_EVENT_TYPES = [
  'thinking',
  'tool-running',
  'reviewing',
  'success',
  'failure',
  'attention',
] as const;

export type CompanionEventType = (typeof COMPANION_EVENT_TYPES)[number];

export type CompanionEventDefinition = {
  type: CompanionEventType;
  label: string;
  description: string;
  animationId: PetActionAnimationId;
  defaultBubble: string;
};

export const COMPANION_EVENTS = {
  thinking: {
    type: 'thinking',
    label: 'Thinking',
    description: 'Codex or an agent is reasoning through the next step.',
    animationId: 'waiting',
    defaultBubble: 'Thinking...',
  },
  'tool-running': {
    type: 'tool-running',
    label: 'Tool running',
    description: 'A command, build, test, or tool call is in progress.',
    animationId: 'running',
    defaultBubble: 'Running a tool...',
  },
  reviewing: {
    type: 'reviewing',
    label: 'Reviewing',
    description: 'Changes are being checked or reviewed.',
    animationId: 'review',
    defaultBubble: 'Reviewing changes...',
  },
  success: {
    type: 'success',
    label: 'Success',
    description: 'The current task or check completed successfully.',
    animationId: 'jumping',
    defaultBubble: 'Done!',
  },
  failure: {
    type: 'failure',
    label: 'Failure',
    description: 'A command failed or the agent needs to recover.',
    animationId: 'failed',
    defaultBubble: 'Something needs attention.',
  },
  attention: {
    type: 'attention',
    label: 'Attention',
    description: 'The agent needs the user to look at something.',
    animationId: 'waving',
    defaultBubble: 'Need your attention.',
  },
} as const satisfies Record<CompanionEventType, CompanionEventDefinition>;

export type CompanionEventPayload = {
  type: CompanionEventType;
  message?: string | null;
  ttlMs?: number | null;
};

export type RecentCompanionEvent = {
  eventType: CompanionEventType;
  message: string | null;
  animationId: PetActionAnimationId;
  bubbleText: string | null;
  receivedAtMs: number;
};

export function isCompanionEventType(value: string): value is CompanionEventType {
  return COMPANION_EVENT_TYPES.includes(value as CompanionEventType);
}
