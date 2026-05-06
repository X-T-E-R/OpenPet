import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  LogicalPosition,
  LogicalSize,
  availableMonitors,
  currentMonitor,
  cursorPosition,
  getCurrentWindow,
  primaryMonitor,
} from '@tauri-apps/api/window';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { PetSprite } from './pet/PetSprite';
import {
  PET_IDLE_SELF_PLAY_ANIMATION_IDS,
  type PetAnimationId,
  getPetAnimation,
  getPetAnimationDurationMs,
  getPetSurfaceInsets,
  getPetSurfaceSize,
  isPetAnimationId,
  pickPetActionFromPool,
} from './pet/animation';
import {
  type PetMotionState,
  type Rect,
  clampPetMotionToWorkArea,
  createInitialPetMotion,
  createRestingPetMotion,
  fallbackWorkArea,
  resolvePetMotion,
} from './pet/motion';
import {
  type ActionPayload,
  FALLBACK_SNAPSHOT,
  type BubbleStyle,
  type PetSettings,
  type RuntimeSnapshot,
  type SayPayload,
} from './pet/settings';

const MOVE_TICK_MS = 120;
const WORK_AREA_REFRESH_MS = 4000;
const DEFAULT_BUBBLE_TTL_MS = 4000;
const IDLE_SELF_PLAY_CHECK_MS = 1000;
const DRAG_START_DISTANCE_PX = 4;
const CURSOR_HIT_TEST_MS = 80;
const PET_HIT_TARGET_PADDING_PX = 4;
const CONTEXT_MENU_WIDTH = 188;
const CONTEXT_MENU_HEIGHT = 214;
const CONTEXT_LABELS = {
  en: {
    aria: 'Pet actions',
    openSettings: 'Open settings',
    wave: 'Wave',
    pauseWalking: 'Pause walking',
    roam: 'Let me roam',
    hidePet: 'Hide pet',
  },
  'zh-CN': {
    aria: '宠物操作',
    openSettings: '打开设置',
    wave: '挥手',
    pauseWalking: '暂停移动',
    roam: '自由移动',
    hidePet: '隐藏宠物',
  },
} as const;
const BUBBLE_STYLES = ['soft', 'comic', 'glass', 'terminal'] as const satisfies readonly BubbleStyle[];

type MonitorWorkArea = {
  rect: Rect;
  scaleFactor: number;
};

type DragState = {
  pointerId: number;
  startPointer: { x: number; y: number };
  latestPointer: { x: number; y: number };
  startWindow: { x: number; y: number };
  nativeDragging: boolean;
  started: boolean;
};

type ContextMenuState = {
  x: number;
  y: number;
};

function monitorWorkAreaToLogical(
  area: { position: { x: number; y: number }; size: { width: number; height: number } },
  scaleFactor: number,
): Rect {
  const safeScaleFactor = scaleFactor || 1;
  return {
    x: area.position.x / safeScaleFactor,
    y: area.position.y / safeScaleFactor,
    width: area.size.width / safeScaleFactor,
    height: area.size.height / safeScaleFactor,
  };
}

async function readWorkArea(): Promise<MonitorWorkArea> {
  try {
    const [current, primary, monitors] = await Promise.all([
      currentMonitor(),
      primaryMonitor(),
      availableMonitors(),
    ]);
    const monitor = current ?? primary ?? monitors[0];
    if (monitor?.workArea) {
      const scaleFactor = monitor.scaleFactor || 1;
      return {
        scaleFactor,
        rect: monitorWorkAreaToLogical(monitor.workArea, scaleFactor),
      };
    }
  } catch {
    // Browser preview and unsupported hosts fall back to screen bounds.
  }
  return { rect: fallbackWorkArea(), scaleFactor: 1 };
}

function hasTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function pickIdleAction(settings: PetSettings): PetAnimationId {
  if (settings.idleAction === 'active-action') return settings.clickAction;
  if (settings.idleAction === 'random') {
    const index = Math.floor(Math.random() * PET_IDLE_SELF_PLAY_ANIMATION_IDS.length);
    return PET_IDLE_SELF_PLAY_ANIMATION_IDS[index] ?? 'waving';
  }
  return settings.idleAction;
}

function pickClickAction(settings: PetSettings): PetAnimationId {
  if (settings.clickActionMode === 'fixed') return settings.clickAction;
  return pickPetActionFromPool(settings.clickActionPool, settings.clickAction || 'waving');
}

function bubbleStyleClass(style: BubbleStyle) {
  return BUBBLE_STYLES.includes(style) ? `pet-bubble-${style}` : 'pet-bubble-soft';
}

function pointInElementRect(
  element: HTMLElement | null,
  point: { x: number; y: number },
  padding = 0,
): boolean {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  return (
    point.x >= rect.left - padding &&
    point.x <= rect.right + padding &&
    point.y >= rect.top - padding &&
    point.y <= rect.bottom + padding
  );
}

export function PetWindow() {
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot>(FALLBACK_SNAPSHOT);
  const [animation, setAnimation] = useState<PetAnimationId>('idle');
  const [bubble, setBubble] = useState<string | null>(null);
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const actionTimerRef = useRef<number | null>(null);
  const actionActiveUntilRef = useRef(0);
  const bubbleTimerRef = useRef<number | null>(null);
  const nextClickActionRef = useRef(0);
  const motionRef = useRef<PetMotionState | null>(null);
  const workAreaRef = useRef<Rect>(fallbackWorkArea());
  const workAreaScaleFactorRef = useRef(1);
  const surfaceSizeRef = useRef(getPetSurfaceSize(1));
  const surfaceInsetsRef = useRef(getPetSurfaceInsets(1));
  const spriteHitTargetRef = useRef<HTMLDivElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const draggingRef = useRef(false);
  const hoveredRef = useRef(false);
  const suppressClickRef = useRef(false);
  const cursorEventsIgnoredRef = useRef<boolean | null>(null);
  const lastActivityRef = useRef(Date.now());
  const lastIdleActionAtRef = useRef(0);

  const tauriAvailable = hasTauriRuntime();
  const settings = snapshot.settings;
  const language = settings.language === 'zh-CN' ? 'zh-CN' : 'en';
  const contextLabels = CONTEXT_LABELS[language];

  const markActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
  }, []);

  const setPetHovered = useCallback((active: boolean, markAsActivity = false) => {
    if (hoveredRef.current === active) return;
    hoveredRef.current = active;
    if (active && markAsActivity) markActivity();
    setHovered(active);
  }, [markActivity]);

  const playAction = useCallback((animationId: PetAnimationId, markAsActivity = true) => {
    if (markAsActivity) markActivity();
    if (actionTimerRef.current !== null) window.clearTimeout(actionTimerRef.current);
    const duration = getPetAnimationDurationMs(getPetAnimation(animationId));
    actionActiveUntilRef.current = Date.now() + duration;
    setAnimation(animationId);
    actionTimerRef.current = window.setTimeout(() => {
      actionTimerRef.current = null;
      actionActiveUntilRef.current = 0;
      setAnimation('idle');
    }, duration);
  }, [markActivity]);

  const say = useCallback((payload: SayPayload) => {
    markActivity();
    const text = payload.text.trim();
    if (bubbleTimerRef.current !== null) window.clearTimeout(bubbleTimerRef.current);
    setBubble(text.length > 0 ? text : null);
    if (text.length === 0) return;
    bubbleTimerRef.current = window.setTimeout(() => {
      bubbleTimerRef.current = null;
      setBubble(null);
    }, Math.max(500, payload.ttlMs ?? DEFAULT_BUBBLE_TTL_MS));
  }, [markActivity]);

  const handlePetClick = useCallback(() => {
    if (contextMenu) {
      setContextMenu(null);
      return;
    }
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    const action = pickClickAction(settings);
    nextClickActionRef.current += 1;
    playAction(isPetAnimationId(action) ? action : 'waving');
  }, [contextMenu, playAction, settings]);

  const handlePetKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      handlePetClick();
    },
    [handlePetClick],
  );

  const updatePetSettings = useCallback(async (nextSettings: PetSettings) => {
    setSnapshot((current) => ({ ...current, settings: nextSettings }));
    if (!tauriAvailable) return;
    try {
      const next = await invoke<RuntimeSnapshot>('update_settings', { settings: nextSettings });
      setSnapshot(next);
    } catch {
      // The pet should remain usable even when previewed outside the Tauri runtime.
    }
  }, [tauriAvailable]);

  const openSettings = useCallback(async () => {
    setContextMenu(null);
    if (!tauriAvailable) return;
    await invoke('open_settings').catch(() => {});
  }, [tauriAvailable]);

  const hidePet = useCallback(async () => {
    setContextMenu(null);
    if (!tauriAvailable) return;
    await invoke('hide_pet').catch(() => {});
  }, [tauriAvailable]);

  const setDragActive = useCallback((active: boolean) => {
    draggingRef.current = active;
    setDragging(active);
  }, []);

  const syncMotionWithWindowPosition = useCallback((position: { x: number; y: number }) => {
    const safeScaleFactor = workAreaScaleFactorRef.current || window.devicePixelRatio || 1;
    const current =
      motionRef.current ??
      createRestingPetMotion(
        workAreaRef.current,
        surfaceSizeRef.current,
        surfaceInsetsRef.current,
      );
    const next = clampPetMotionToWorkArea(
      {
        ...current,
        x: position.x / safeScaleFactor,
        y: position.y / safeScaleFactor,
      },
      workAreaRef.current,
      surfaceSizeRef.current,
      surfaceInsetsRef.current,
    );
    motionRef.current = next;

    const dragState = dragStateRef.current;
    if (!dragState?.nativeDragging) return;
    const distance = Math.hypot(next.x - dragState.startWindow.x, next.y - dragState.startWindow.y);
    if (!dragState.started && distance >= DRAG_START_DISTANCE_PX) {
      dragState.started = true;
      suppressClickRef.current = true;
      setDragActive(true);
    }
  }, [setDragActive]);

  const moveManualDrag = useCallback((state: DragState) => {
    const deltaX = state.latestPointer.x - state.startPointer.x;
    const deltaY = state.latestPointer.y - state.startPointer.y;
    const current =
      motionRef.current ??
      createRestingPetMotion(
        workAreaRef.current,
        surfaceSizeRef.current,
        surfaceInsetsRef.current,
      );
    const next = clampPetMotionToWorkArea(
      {
        ...current,
        x: state.startWindow.x + deltaX,
        y: state.startWindow.y + deltaY,
      },
      workAreaRef.current,
      surfaceSizeRef.current,
      surfaceInsetsRef.current,
    );
    motionRef.current = next;
    if (tauriAvailable) {
      void getCurrentWindow()
        .setPosition(new LogicalPosition(Math.round(next.x), Math.round(next.y)))
        .catch(() => {});
    }
  }, [tauriAvailable]);

  const finishDrag = useCallback(
    (pointerId?: number) => {
      const state = dragStateRef.current;
      if (!state || (pointerId !== undefined && state.pointerId !== pointerId)) return;
      state.nativeDragging = false;
      dragStateRef.current = null;
      setDragActive(false);
    },
    [setDragActive],
  );

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    markActivity();
    setContextMenu(null);
    const current =
      motionRef.current ??
      createRestingPetMotion(
        workAreaRef.current,
        surfaceSizeRef.current,
        surfaceInsetsRef.current,
      );
    dragStateRef.current = {
      pointerId: event.pointerId,
      startPointer: { x: event.screenX, y: event.screenY },
      latestPointer: { x: event.screenX, y: event.screenY },
      startWindow: { x: current.x, y: current.y },
      nativeDragging: false,
      started: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [markActivity]);

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const state = dragStateRef.current;
      if (!state || state.pointerId !== event.pointerId) return;
      state.latestPointer = { x: event.screenX, y: event.screenY };
      const distance = Math.hypot(
        state.latestPointer.x - state.startPointer.x,
        state.latestPointer.y - state.startPointer.y,
      );
      if (!state.started && distance >= DRAG_START_DISTANCE_PX) {
        state.started = true;
        suppressClickRef.current = true;
        setDragActive(true);
        if (tauriAvailable) {
          state.nativeDragging = true;
          void getCurrentWindow()
            .startDragging()
            .catch(() => {
              if (dragStateRef.current !== state) return;
              state.nativeDragging = false;
              moveManualDrag(state);
            });
          return;
        }
      }
      if (state.nativeDragging) return;
      if (state.started) moveManualDrag(state);
    },
    [moveManualDrag, setDragActive, tauriAvailable],
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const state = dragStateRef.current;
      if (state?.pointerId === event.pointerId && state.started) event.preventDefault();
      finishDrag(event.pointerId);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [finishDrag],
  );

  const handleContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      finishDrag();
      playAction('review');
      const x = Math.min(
        Math.max(10, event.clientX),
        Math.max(10, window.innerWidth - CONTEXT_MENU_WIDTH - 10),
      );
      const y = Math.min(
        Math.max(10, event.clientY),
        Math.max(10, window.innerHeight - CONTEXT_MENU_HEIGHT - 10),
      );
      setContextMenu({ x, y });
    },
    [finishDrag, playAction],
  );

  useEffect(() => {
    if (!tauriAvailable) return;

    const appWindow = getCurrentWindow();
    let cancelled = false;

    const setIgnoreCursorEvents = async (ignore: boolean) => {
      if (cursorEventsIgnoredRef.current === ignore) return;
      cursorEventsIgnoredRef.current = ignore;
      await appWindow.setIgnoreCursorEvents(ignore).catch(() => {
        cursorEventsIgnoredRef.current = null;
      });
    };

    const syncCursorHitTarget = async () => {
      if (cancelled) return;
      if (draggingRef.current) {
        setPetHovered(true);
        await setIgnoreCursorEvents(false);
        return;
      }

      try {
        const [cursor, windowPosition, scaleFactor] = await Promise.all([
          cursorPosition(),
          appWindow.innerPosition(),
          appWindow.scaleFactor(),
        ]);
        if (cancelled) return;

        const safeScaleFactor = scaleFactor || window.devicePixelRatio || 1;
        const point = {
          x: (cursor.x - windowPosition.x) / safeScaleFactor,
          y: (cursor.y - windowPosition.y) / safeScaleFactor,
        };
        const overSprite = pointInElementRect(
          spriteHitTargetRef.current,
          point,
          PET_HIT_TARGET_PADDING_PX,
        );
        const overContextMenu = pointInElementRect(contextMenuRef.current, point);

        setPetHovered(overSprite, overSprite);
        await setIgnoreCursorEvents(!(overSprite || overContextMenu));
      } catch {
        await setIgnoreCursorEvents(false);
      }
    };

    void syncCursorHitTarget();
    const timer = window.setInterval(() => void syncCursorHitTarget(), CURSOR_HIT_TEST_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      cursorEventsIgnoredRef.current = null;
      void appWindow.setIgnoreCursorEvents(false).catch(() => {});
    };
  }, [setPetHovered, tauriAvailable]);

  useEffect(() => {
    if (!tauriAvailable) return;

    let cancelled = false;
    let unlisten: (() => void) | null = null;
    void getCurrentWindow()
      .onMoved(({ payload }) => {
        if (!cancelled) syncMotionWithWindowPosition(payload);
      })
      .then((nextUnlisten) => {
        if (cancelled) {
          nextUnlisten();
        } else {
          unlisten = nextUnlisten;
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [syncMotionWithWindowPosition, tauriAvailable]);

  useEffect(() => {
    if (!tauriAvailable) return;

    let cancelled = false;
    void invoke<RuntimeSnapshot>('get_runtime_snapshot')
      .then((next) => {
        if (!cancelled) setSnapshot(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [tauriAvailable]);

  useEffect(() => {
    if (!tauriAvailable) return;

    let cancelled = false;
    const unlisteners: Array<() => void> = [];
    void Promise.all([
      listen<ActionPayload>('pet-action', (event) => {
        if (cancelled || !isPetAnimationId(event.payload.animationId)) return;
        playAction(event.payload.animationId);
      }),
      listen<SayPayload>('pet-say', (event) => {
        if (!cancelled) say(event.payload);
      }),
      listen<PetSettings>('pet-settings', (event) => {
        if (!cancelled) {
          setSnapshot((current) => ({ ...current, settings: event.payload }));
        }
      }),
      listen<RuntimeSnapshot>('runtime-status', (event) => {
        if (!cancelled) setSnapshot(event.payload);
      }),
    ])
      .then((next) => unlisteners.push(...next))
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisteners.forEach((unlisten) => unlisten());
      if (actionTimerRef.current !== null) window.clearTimeout(actionTimerRef.current);
      if (bubbleTimerRef.current !== null) window.clearTimeout(bubbleTimerRef.current);
    };
  }, [playAction, say, tauriAvailable]);

  useEffect(() => {
    if (!contextMenu) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null);
    };

    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [contextMenu]);

  useEffect(() => {
    if (!settings.idleSelfPlay || settings.reducedMotion) return;

    const timer = window.setInterval(() => {
      const now = Date.now();
      const pausedByInteraction =
        draggingRef.current || contextMenu !== null || (settings.hoverPause && hovered);
      if (pausedByInteraction || now < actionActiveUntilRef.current) return;
      if (now - lastActivityRef.current < settings.idleThresholdMs) return;
      if (now - lastIdleActionAtRef.current < settings.idleActionFrequencyMs) return;

      lastIdleActionAtRef.current = now;
      playAction(pickIdleAction(settings), false);
    }, IDLE_SELF_PLAY_CHECK_MS);

    return () => window.clearInterval(timer);
  }, [
    contextMenu,
    hovered,
    playAction,
    settings.clickAction,
    settings.clickActionMode,
    settings.clickActionPool,
    settings.hoverPause,
    settings.idleAction,
    settings.idleActionFrequencyMs,
    settings.idleSelfPlay,
    settings.idleThresholdMs,
    settings.reducedMotion,
  ]);

  useEffect(() => {
    const surfaceSize = getPetSurfaceSize(settings.scale);
    const surfaceInsets = getPetSurfaceInsets(settings.scale);
    surfaceSizeRef.current = surfaceSize;
    surfaceInsetsRef.current = surfaceInsets;
    let cancelled = false;
    const walkingPaused = (settings.hoverPause && hovered) || dragging;

    const resizeWindow = () => {
      if (!tauriAvailable) return;
      void getCurrentWindow()
        .setSize(new LogicalSize(surfaceSize.width, surfaceSize.height))
        .catch(() => {});
    };
    const refreshWorkArea = async () => {
      const snapshotWorkArea = await readWorkArea();
      workAreaRef.current = snapshotWorkArea.rect;
      workAreaScaleFactorRef.current = snapshotWorkArea.scaleFactor;
      if (!motionRef.current) {
        motionRef.current = settings.autonomousWalking
          ? createInitialPetMotion(snapshotWorkArea.rect, surfaceSize, surfaceInsets)
          : createRestingPetMotion(snapshotWorkArea.rect, surfaceSize, surfaceInsets);
      } else {
        motionRef.current = clampPetMotionToWorkArea(
          motionRef.current,
          snapshotWorkArea.rect,
          surfaceSize,
          surfaceInsets,
        );
      }
    };
    const move = () => {
      if (cancelled) return;
      const workArea = workAreaRef.current;
      if (!motionRef.current) {
        motionRef.current = settings.autonomousWalking
          ? createInitialPetMotion(workArea, surfaceSize, surfaceInsets)
          : createRestingPetMotion(workArea, surfaceSize, surfaceInsets);
      }
      const next = resolvePetMotion({
        state: motionRef.current,
        workArea,
        surfaceSize,
        surfaceInsets,
        autonomousWalking: settings.autonomousWalking,
        reducedMotion: settings.reducedMotion,
        paused: walkingPaused,
        speedPx: settings.walkingSpeedPx,
      });
      motionRef.current = next;
      if (Date.now() >= actionActiveUntilRef.current) setAnimation(next.animation);
      if (tauriAvailable && !draggingRef.current) {
        void getCurrentWindow()
          .setPosition(new LogicalPosition(Math.round(next.x), Math.round(next.y)))
          .catch(() => {});
      }
    };

    resizeWindow();
    void refreshWorkArea().then(move);
    const moveTimer = window.setInterval(move, settings.autonomousWalking ? MOVE_TICK_MS : 1400);
    const workAreaTimer = window.setInterval(() => void refreshWorkArea(), WORK_AREA_REFRESH_MS);

    return () => {
      cancelled = true;
      window.clearInterval(moveTimer);
      window.clearInterval(workAreaTimer);
    };
  }, [
    dragging,
    hovered,
    settings.autonomousWalking,
    settings.hoverPause,
    settings.reducedMotion,
    settings.scale,
    settings.walkingSpeedPx,
    tauriAvailable,
  ]);

  return (
    <div
      className={`pet-window${dragging ? ' dragging' : ''}`}
      role="button"
      tabIndex={0}
      aria-label="OpenPet desktop pet window"
      onClick={handlePetClick}
      onContextMenu={handleContextMenu}
      onKeyDown={handlePetKeyDown}
      onLostPointerCapture={() => finishDrag()}
      onPointerCancel={() => finishDrag()}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {bubble && (
        <div
          className={`pet-bubble ${bubbleStyleClass(settings.bubbleStyle)}`}
          style={{
            fontFamily: settings.bubbleFontFamily,
            fontSize: `${settings.bubbleFontSizePx}px`,
            maxWidth: `min(${settings.bubbleMaxWidthPx}px, calc(100vw - 24px))`,
          }}
        >
          {bubble}
        </div>
      )}
      <div
        ref={spriteHitTargetRef}
        className="pet-hit-target"
        data-testid="pet-hit-target"
        onMouseEnter={() => setPetHovered(true, true)}
        onMouseLeave={() => setPetHovered(false)}
      >
        <PetSprite
          animationId={animation}
          pet={snapshot.activePet}
          scale={settings.scale}
          reducedMotion={settings.reducedMotion}
        />
      </div>
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="pet-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
          aria-label={contextLabels.aria}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button type="button" role="menuitem" onClick={() => void openSettings()}>
            {contextLabels.openSettings}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setContextMenu(null);
              playAction('waving');
            }}
          >
            {contextLabels.wave}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() =>
              void updatePetSettings({
                ...settings,
                autonomousWalking: !settings.autonomousWalking,
              }).then(() => setContextMenu(null))
            }
          >
            {settings.autonomousWalking ? contextLabels.pauseWalking : contextLabels.roam}
          </button>
          <button type="button" role="menuitem" onClick={() => void hidePet()}>
            {contextLabels.hidePet}
          </button>
        </div>
      )}
    </div>
  );
}
