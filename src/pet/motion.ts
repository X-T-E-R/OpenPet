import type { PetAnimationId, PetWindowSize } from './animation';

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

export function createRestingPetMotion(workArea: Rect, surfaceSize: PetWindowSize): PetMotionState {
  const left = workArea.x + EDGE_MARGIN;
  const right = workArea.x + workArea.width - surfaceSize.width - EDGE_MARGIN;
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
  direction: PetDirection = 1,
): PetMotionState {
  return {
    x: clamp(workArea.x + EDGE_MARGIN, workArea.x + EDGE_MARGIN, workArea.x + workArea.width),
    y: groundY(workArea, surfaceSize),
    direction,
    animation: toAnimation(direction),
  };
}

export function clampPetMotionToWorkArea(
  state: PetMotionState,
  workArea: Rect,
  surfaceSize: PetWindowSize,
): PetMotionState {
  const left = workArea.x + EDGE_MARGIN;
  const right = workArea.x + workArea.width - surfaceSize.width - EDGE_MARGIN;
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
  speedPx = 8,
  autonomousWalking,
  reducedMotion,
  paused,
}: {
  state: PetMotionState;
  workArea: Rect;
  surfaceSize: PetWindowSize;
  speedPx?: number;
  autonomousWalking: boolean;
  reducedMotion: boolean;
  paused: boolean;
}): PetMotionState {
  if (reducedMotion || !autonomousWalking || paused) {
    return {
      ...clampPetMotionToWorkArea(state, workArea, surfaceSize),
      animation: 'idle',
    };
  }

  const left = workArea.x + EDGE_MARGIN;
  const right = workArea.x + workArea.width - surfaceSize.width - EDGE_MARGIN;
  let direction = state.direction;
  let x = state.x + speedPx * direction;

  if (x <= left) {
    x = left;
    direction = 1;
  } else if (x >= right) {
    x = right;
    direction = -1;
  }

  return {
    x: clamp(x, left, right),
    y: groundY(workArea, surfaceSize),
    direction,
    animation: toAnimation(direction),
  };
}
