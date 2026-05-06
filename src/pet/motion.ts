import type { PetAnimationId, PetSurfaceInsets, PetWindowSize } from './animation';

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PetDirection = -1 | 1;

export type PetMotionState = {
  x: number;
  y: number;
  direction: PetDirection;
  animation: PetAnimationId;
};

const EDGE_MARGIN = 8;
const NO_SURFACE_INSETS: PetSurfaceInsets = { left: 0, right: 0 };

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}

function groundY(workArea: Rect, surfaceSize: PetWindowSize): number {
  return workArea.y + workArea.height - surfaceSize.height - EDGE_MARGIN;
}

function toAnimation(direction: PetDirection): PetAnimationId {
  return direction > 0 ? 'running-right' : 'running-left';
}

function horizontalBounds(
  workArea: Rect,
  surfaceSize: PetWindowSize,
  surfaceInsets: PetSurfaceInsets = NO_SURFACE_INSETS,
) {
  return {
    left: workArea.x + EDGE_MARGIN - surfaceInsets.left,
    right: workArea.x + workArea.width - surfaceSize.width - EDGE_MARGIN + surfaceInsets.right,
  };
}

export function fallbackWorkArea(): Rect {
  const screenWithOrigin = window.screen as Screen & {
    availLeft?: number;
    availTop?: number;
  };
  return {
    x: screenWithOrigin.availLeft || 0,
    y: screenWithOrigin.availTop || 0,
    width: window.screen.availWidth || window.innerWidth || 1024,
    height: window.screen.availHeight || window.innerHeight || 768,
  };
}

export function createRestingPetMotion(
  workArea: Rect,
  surfaceSize: PetWindowSize,
  surfaceInsets?: PetSurfaceInsets,
): PetMotionState {
  const { left, right } = horizontalBounds(workArea, surfaceSize, surfaceInsets);
  return {
    x: clamp(right, left, right),
    y: groundY(workArea, surfaceSize),
    direction: -1,
    animation: 'idle',
  };
}

export function createInitialPetMotion(
  workArea: Rect,
  surfaceSize: PetWindowSize,
  directionOrInsets: PetDirection | PetSurfaceInsets = 1,
  surfaceInsets?: PetSurfaceInsets,
): PetMotionState {
  const direction = typeof directionOrInsets === 'number' ? directionOrInsets : 1;
  const resolvedInsets = typeof directionOrInsets === 'number' ? surfaceInsets : directionOrInsets;
  const { left, right } = horizontalBounds(workArea, surfaceSize, resolvedInsets);
  return {
    x: clamp(left, left, right),
    y: groundY(workArea, surfaceSize),
    direction,
    animation: toAnimation(direction),
  };
}

export function clampPetMotionToWorkArea(
  state: PetMotionState,
  workArea: Rect,
  surfaceSize: PetWindowSize,
  surfaceInsets?: PetSurfaceInsets,
): PetMotionState {
  const { left, right } = horizontalBounds(workArea, surfaceSize, surfaceInsets);
  const top = workArea.y + EDGE_MARGIN;
  const bottom = workArea.y + workArea.height - surfaceSize.height - EDGE_MARGIN;
  return {
    ...state,
    x: clamp(state.x, left, right),
    y: clamp(state.y, top, bottom),
  };
}

export function resolvePetMotion({
  state,
  workArea,
  surfaceSize,
  surfaceInsets,
  speedPx = 8,
  autonomousWalking,
  reducedMotion,
  paused,
}: {
  state: PetMotionState;
  workArea: Rect;
  surfaceSize: PetWindowSize;
  surfaceInsets?: PetSurfaceInsets;
  speedPx?: number;
  autonomousWalking: boolean;
  reducedMotion: boolean;
  paused: boolean;
}): PetMotionState {
  if (reducedMotion || !autonomousWalking || paused) {
    return {
      ...clampPetMotionToWorkArea(state, workArea, surfaceSize, surfaceInsets),
      animation: 'idle',
    };
  }

  const { left, right } = horizontalBounds(workArea, surfaceSize, surfaceInsets);
  const clampedState = clampPetMotionToWorkArea(state, workArea, surfaceSize, surfaceInsets);
  let direction = state.direction;
  let x = clampedState.x + speedPx * direction;

  if (x <= left) {
    x = left;
    direction = 1;
  } else if (x >= right) {
    x = right;
    direction = -1;
  }

  return {
    x: clamp(x, left, right),
    y: clampedState.y,
    direction,
    animation: toAnimation(direction),
  };
}
