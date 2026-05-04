import type { PetActionAnimationId } from './animation';
import { PET_CATALOG, type PetCatalogItem, type PetId } from './catalog';
import type { RecentCompanionEvent } from './events';

export type PetLanguage = 'en' | 'zh-CN';
export type ClickActionMode = 'fixed' | 'random';
export type IdleActionId = 'random' | 'active-action' | PetActionAnimationId;
export type BubbleStyle = 'soft' | 'comic' | 'glass' | 'terminal';
export type PetStoragePreset = 'app-data' | 'codex-custom' | 'custom';

export type PetSettings = {
  language: PetLanguage;
  scale: number;
  reducedMotion: boolean;
  autoUpdateChecks: boolean;
  autonomousWalking: boolean;
  hoverPause: boolean;
  activePetId: PetId;
  clickActionMode: ClickActionMode;
  clickAction: PetActionAnimationId;
  clickActionPool: PetActionAnimationId[];
  eventReactions: boolean;
  eventBubbles: boolean;
  eventBubbleTtlMs: number;
  bubbleStyle: BubbleStyle;
  bubbleFontFamily: string;
  bubbleFontSizePx: number;
  bubbleMaxWidthPx: number;
  idleSelfPlay: boolean;
  idleThresholdMs: number;
  idleActionFrequencyMs: number;
  idleAction: IdleActionId;
  walkingSpeedPx: number;
  petStoragePreset: PetStoragePreset;
  customPetStorageDir: string | null;
};

export type PetStorageSnapshot = {
  preset: PetStoragePreset;
  customDir: string | null;
  activeDir: string;
  appDataDir: string;
  codexDir: string;
};

export type RuntimeSnapshot = {
  listenAddress: string;
  port: number;
  configuredListenAddress: string;
  configuredPort: number;
  apiBaseUrl: string;
  apiListening: boolean;
  apiError: string | null;
  apiRestartRequired: boolean;
  petVisible: boolean;
  settings: PetSettings;
  petStorage: PetStorageSnapshot;
  activePet: PetCatalogItem;
  petCatalog: PetCatalogItem[];
  lastAction: string | null;
  bubbleText: string | null;
  recentEvents: RecentCompanionEvent[];
  startedAtMs: number;
};

export type RuntimeApiConfig = {
  listenAddress: string;
  port: number;
};

export type UpdateCheckResult = {
  currentVersion: string;
  latestVersion: string | null;
  releaseName: string | null;
  releaseUrl: string;
  publishedAt: string | null;
  updateAvailable: boolean;
};

export type BundledSkill = {
  id: string;
  displayName: string;
  description: string;
};

export type InstallBundledSkillsPayload = {
  skillIds: string[];
  targetIds: string[];
  force: boolean;
};

export type SkillInstallResult = {
  skillId: string;
  targetId: string;
  targetLabel: string;
  targetPath: string | null;
  status: string;
  message: string;
};

export type ActionPayload = {
  animationId: string;
};

export type SayPayload = {
  text: string;
  ttlMs?: number | null;
};

export const DEFAULT_SETTINGS: PetSettings = {
  language: 'en',
  scale: 1,
  reducedMotion: false,
  autoUpdateChecks: true,
  autonomousWalking: false,
  hoverPause: true,
  activePetId: 'nia',
  clickActionMode: 'random',
  clickAction: 'waving',
  clickActionPool: ['waving', 'jumping', 'waiting', 'running', 'review'],
  eventReactions: true,
  eventBubbles: true,
  eventBubbleTtlMs: 4000,
  bubbleStyle: 'soft',
  bubbleFontFamily: 'Aptos Display',
  bubbleFontSizePx: 14,
  bubbleMaxWidthPx: 292,
  idleSelfPlay: true,
  idleThresholdMs: 45000,
  idleActionFrequencyMs: 30000,
  idleAction: 'random',
  walkingSpeedPx: 8,
  petStoragePreset: 'codex-custom',
  customPetStorageDir: null,
};

export const FALLBACK_SNAPSHOT: RuntimeSnapshot = {
  listenAddress: '127.0.0.1',
  port: 17321,
  configuredListenAddress: '127.0.0.1',
  configuredPort: 17321,
  apiBaseUrl: 'http://127.0.0.1:17321',
  apiListening: false,
  apiError: 'Not connected to Tauri runtime',
  apiRestartRequired: false,
  petVisible: true,
  settings: DEFAULT_SETTINGS,
  petStorage: {
    preset: 'codex-custom',
    customDir: null,
    activeDir: '~/.codex/pets',
    appDataDir: 'OpenPet app data/pets',
    codexDir: '~/.codex/pets',
  },
  activePet: PET_CATALOG[0],
  petCatalog: [...PET_CATALOG],
  lastAction: null,
  bubbleText: null,
  recentEvents: [],
  startedAtMs: Date.now(),
};
