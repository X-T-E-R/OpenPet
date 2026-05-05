export const PET_ATLAS = {
  width: 1536,
  height: 1872,
  columns: 8,
  rows: 9,
  cellWidth: 192,
  cellHeight: 208,
} as const;

export type PetAnimationId =
  | 'idle'
  | 'running-right'
  | 'running-left'
  | 'waving'
  | 'jumping'
  | 'failed'
  | 'waiting'
  | 'running'
  | 'review';

export const PET_ACTION_ANIMATION_IDS = [
  'waving',
  'jumping',
  'waiting',
  'running',
  'review',
  'failed',
] as const satisfies readonly PetAnimationId[];

export type PetActionAnimationId = (typeof PET_ACTION_ANIMATION_IDS)[number];

export function isPetActionAnimationId(
  value: string | null | undefined,
): value is PetActionAnimationId {
  return (
    typeof value === 'string' &&
    PET_ACTION_ANIMATION_IDS.includes(value as PetActionAnimationId)
  );
}

export function pickPetActionFromPool(
  pool: readonly PetActionAnimationId[],
  fallback: PetActionAnimationId = 'waving',
): PetActionAnimationId {
  const candidates = pool.filter(isPetActionAnimationId);
  if (candidates.length === 0) return fallback;
  const index = Math.floor(Math.random() * candidates.length);
  return candidates[index] ?? fallback;
}

export const PET_IDLE_SELF_PLAY_ANIMATION_IDS = [
  'waving',
  'jumping',
  'waiting',
  'running',
  'review',
] as const satisfies readonly PetActionAnimationId[];

export const PET_ACTION_LABELS = {
  waving: 'Waving',
  jumping: 'Jumping',
  waiting: 'Waiting',
  running: 'Running in place',
  review: 'Reviewing',
  failed: 'Failed',
} as const satisfies Record<PetActionAnimationId, string>;

export type PetAnimationDefinition = {
  id: PetAnimationId;
  row: number;
  frameCount: number;
  frameDurationsMs: readonly number[];
};

export const PET_ANIMATIONS = {
  idle: {
    id: 'idle',
    row: 0,
    frameCount: 6,
    frameDurationsMs: [280, 110, 110, 140, 140, 320],
  },
  'running-right': {
    id: 'running-right',
    row: 1,
    frameCount: 8,
    frameDurationsMs: [120, 120, 120, 120, 120, 120, 120, 220],
  },
  'running-left': {
    id: 'running-left',
    row: 2,
    frameCount: 8,
    frameDurationsMs: [120, 120, 120, 120, 120, 120, 120, 220],
  },
  waving: {
    id: 'waving',
    row: 3,
    frameCount: 4,
    frameDurationsMs: [140, 140, 140, 280],
  },
  jumping: {
    id: 'jumping',
    row: 4,
    frameCount: 5,
    frameDurationsMs: [140, 140, 140, 140, 280],
  },
  failed: {
    id: 'failed',
    row: 5,
    frameCount: 8,
    frameDurationsMs: [140, 140, 140, 140, 140, 140, 140, 240],
  },
  waiting: {
    id: 'waiting',
    row: 6,
    frameCount: 6,
    frameDurationsMs: [150, 150, 150, 150, 150, 260],
  },
  running: {
    id: 'running',
    row: 7,
    frameCount: 6,
    frameDurationsMs: [120, 120, 120, 120, 120, 220],
  },
  review: {
    id: 'review',
    row: 8,
    frameCount: 6,
    frameDurationsMs: [150, 150, 150, 150, 150, 280],
  },
} as const satisfies Record<PetAnimationId, PetAnimationDefinition>;

export type PetWindowSize = {
  width: number;
  height: number;
};

export type PetSurfaceInsets = {
  left: number;
  right: number;
};

const DISPLAY_SCALE_TO_RENDER_SCALE = 0.75;

export function getPetRenderScale(displayScale: number): number {
  return Math.max(0.25, displayScale * DISPLAY_SCALE_TO_RENDER_SCALE);
}

export function getPetAnimation(id: PetAnimationId): PetAnimationDefinition {
  return PET_ANIMATIONS[id];
}

export function isPetAnimationId(value: string | null | undefined): value is PetAnimationId {
  return typeof value === 'string' && value in PET_ANIMATIONS;
}

export function getPetAnimationDurationMs(animation: PetAnimationDefinition): number {
  return animation.frameDurationsMs.reduce((sum, value) => sum + value, 0);
}

export function getPetFrameAtTime(animation: PetAnimationDefinition, elapsedMs: number): number {
  const totalDuration = getPetAnimationDurationMs(animation);
  if (totalDuration <= 0) return 0;

  const cursor = ((elapsedMs % totalDuration) + totalDuration) % totalDuration;
  let consumed = 0;
  for (let index = 0; index < animation.frameDurationsMs.length; index += 1) {
    consumed += animation.frameDurationsMs[index] ?? 0;
    if (cursor < consumed) return index;
  }
  return Math.max(0, animation.frameCount - 1);
}

export function getPetSpriteSize(scale: number): PetWindowSize {
  const renderScale = getPetRenderScale(scale);
  return {
    width: Math.ceil(PET_ATLAS.cellWidth * renderScale),
    height: Math.ceil(PET_ATLAS.cellHeight * renderScale),
  };
}

export function getPetSurfaceSize(scale: number): PetWindowSize {
  const sprite = getPetSpriteSize(scale);
  return {
    width: Math.max(340, sprite.width),
    height: sprite.height + 140,
  };
}

export function getPetSurfaceInsets(scale: number): PetSurfaceInsets {
  const sprite = getPetSpriteSize(scale);
  const surface = getPetSurfaceSize(scale);
  const horizontalInset = Math.max(0, surface.width - sprite.width);

  return {
    left: Math.floor(horizontalInset / 2),
    right: Math.ceil(horizontalInset / 2),
  };
}

export function getPetFrameOffset(animation: PetAnimationDefinition, frame: number, scale: number) {
  const safeFrame = Math.min(Math.max(0, frame), animation.frameCount - 1);
  const renderScale = getPetRenderScale(scale);
  return {
    x: -safeFrame * PET_ATLAS.cellWidth * renderScale,
    y: -animation.row * PET_ATLAS.cellHeight * renderScale,
  };
}
