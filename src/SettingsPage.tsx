import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import {
  PET_ACTION_ANIMATION_IDS,
  type PetActionAnimationId,
  isPetActionAnimationId,
  pickPetActionFromPool,
} from './pet/animation';
import { isPetId } from './pet/catalog';
import {
  COMPANION_EVENTS,
  COMPANION_EVENT_TYPES,
  type CompanionEventType,
  isCompanionEventType,
} from './pet/events';
import {
  FALLBACK_SNAPSHOT,
  type BubbleStyle,
  type BundledSkill,
  type ClickActionMode,
  type InstallBundledSkillsPayload,
  type IdleActionId,
  type PetLanguage,
  type PetStoragePreset,
  type RuntimeApiConfig,
  type PetSettings,
  type RuntimeSnapshot,
  type SkillInstallResult,
  type UpdateCheckResult,
} from './pet/settings';

const SCALE_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
const BUBBLE_TTL_OPTIONS = [2500, 4000, 7000, 10000] as const;
const IDLE_THRESHOLD_OPTIONS = [30000, 45000, 90000, 180000] as const;
const IDLE_FREQUENCY_OPTIONS = [15000, 30000, 60000, 120000] as const;
const WALKING_SPEED_OPTIONS = [4, 8, 12, 16] as const;
const MIN_API_PORT = 1;
const MAX_API_PORT = 65535;
const SETTINGS_TABS = ['general', 'import', 'pet', 'bubble', 'apiAgent'] as const;
const LANGUAGE_OPTIONS = ['en', 'zh-CN'] as const satisfies readonly PetLanguage[];
const CLICK_ACTION_MODES = ['fixed', 'random'] as const satisfies readonly ClickActionMode[];
const BUBBLE_STYLE_OPTIONS = ['soft', 'comic', 'glass', 'terminal'] as const satisfies readonly BubbleStyle[];
const BUBBLE_FONT_SIZE_OPTIONS = [12, 14, 16, 18, 22] as const;
const BUBBLE_WIDTH_OPTIONS = [220, 292, 360, 440] as const;
const PET_STORAGE_PRESETS = ['codex-custom', 'app-data', 'custom'] as const satisfies readonly PetStoragePreset[];
const SKILL_TARGETS = [
  { id: 'codex', label: 'Codex' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'openclaw', label: 'OpenClaw' },
  { id: 'hermes', label: 'Hermes' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'claude', label: 'Claude Code' },
] as const;
const PET_IMPORT_SOURCE_LINKS = [
  { label: 'Petdex', href: 'https://petdex.crafter.run/' },
  { label: 'Codex Pets', href: 'https://codex-pets.net/' },
  { label: 'SpriteYard', href: 'https://spriteyard.com/' },
  { label: 'Codex Pet Shop', href: 'https://www.codexpetshop.com/' },
] as const;
const PROJECT_LINKS = [
  { key: 'projectAddress', href: 'https://github.com/X-T-E-R/OpenPet' },
  { key: 'milkTea', href: 'https://afdian.com/a/xter123' },
] as const;
const GITHUB_RELEASES_URL = 'https://github.com/X-T-E-R/OpenPet/releases';
const IDLE_ACTION_OPTIONS = [
  'random',
  'active-action',
  ...PET_ACTION_ANIMATION_IDS,
] as const satisfies readonly IdleActionId[];

type UpdateSource = 'tauri' | 'github';
type UpdateInstallPhase = 'idle' | 'downloading' | 'installed';

type UpdateDownloadProgress = {
  downloadedBytes: number;
  contentLength: number | null;
};

const TRANSLATIONS = {
  en: {
    languages: {
      en: 'English',
      'zh-CN': '简体中文',
    },
    actionLabels: {
      waving: 'Waving',
      jumping: 'Jumping',
      waiting: 'Waiting',
      running: 'Running in place',
      review: 'Reviewing',
      failed: 'Failed',
    },
    eventLabels: {
      thinking: 'Thinking',
      'tool-running': 'Tool running',
      reviewing: 'Reviewing',
      success: 'Success',
      failure: 'Failure',
      attention: 'Attention',
    },
    eventDescriptions: {
      thinking: 'The agent is reading, planning, or reasoning.',
      'tool-running': 'The agent is executing a tool or command.',
      reviewing: 'The agent is checking changes or evaluating output.',
      success: 'A task, check, or milestone completed successfully.',
      failure: 'Something failed or needs user attention.',
      attention: 'The agent needs the user to look at something.',
    },
    eventBubbleDefaults: {
      thinking: 'Thinking...',
      'tool-running': 'Running a tool...',
      reviewing: 'Reviewing changes...',
      success: 'Done!',
      failure: 'Something needs attention.',
      attention: 'Need your attention.',
    },
    idleLabels: {
      random: 'Surprise me',
      'active-action': 'Use click action',
    },
    feedback: {
      ready: 'Ready.',
      previewOnly: 'Browser preview only. Open the Tauri desktop app to control the pet.',
      statusRefreshed: 'Status refreshed.',
      checkingUpdates: 'Checking updates...',
      updateAvailable: 'Update available:',
      noUpdate: 'OpenPet is up to date.',
      signedUpdaterUnavailable:
        'Signed metadata unavailable; using GitHub fallback.',
      nativeUpdateReady: 'Signed update ready:',
      installingUpdate: 'Installing update...',
      updateInstalled: 'Update installed. Restart OpenPet to finish.',
      noSignedUpdate: 'No signed update is ready to install.',
      restarting: 'Restarting OpenPet...',
      autoUpdatesOn: 'Automatic update checks enabled.',
      autoUpdatesOff: 'Automatic update checks disabled.',
      settingsUpdated: 'Settings updated.',
      languageUpdated: 'Language updated.',
      eventAnimationsOn: 'Event animations enabled.',
      eventAnimationsOff: 'Event animations disabled.',
      eventBubblesOn: 'Event bubbles enabled.',
      eventBubblesOff: 'Event bubbles disabled.',
      bubbleSent: 'Bubble sent.',
      importUrlFirst: 'Paste a supported pet page URL first.',
      importing: 'Importing pet from website...',
      importedPrefix: 'Imported',
      fixedMode: 'Click action mode set to fixed.',
      randomMode: 'Click action mode set to random.',
      poolEmpty: 'Random pool is empty. Clicks will fall back to the fixed action.',
      apiConfigSaved: 'API endpoint saved.',
      apiConfigRestart: 'API endpoint saved. Restart OpenPet to apply it.',
      apiConfigInvalid: 'Enter a valid listen address and port.',
      petStorageUpdated: 'Pet storage location updated.',
      customStorageRequired: 'Enter a custom storage path before selecting the custom preset.',
      folderOpened: 'Folder opened.',
      folderSelected: 'Folder selected.',
      linkOpened: 'Opened external link.',
      installSelectFirst: 'Select at least one bundled skill and one target.',
      installingSkills: 'Installing selected skills...',
      skillsInstalled: 'Skill install finished.',
      skillsLoaded: 'Bundled skills loaded.',
      petShown: 'Pet is visible.',
      petHidden: 'Pet is hidden.',
    },
    tabs: {
      general: 'General',
      import: 'Import',
      pet: 'Pet',
      bubble: 'Bubble',
      apiAgent: 'API / Agent',
    },
    heroEyebrow: 'OpenPet',
    heroTitle: 'Settings, imports, and tiny companion behavior.',
    heroLede:
      'A single control room for language, pet behavior, compatible imports, local API debugging, and project links.',
    showPet: 'Show Pet',
    hidePet: 'Hide Pet',
    refresh: 'Refresh Status',
    localApi: 'Local API',
    online: 'Online',
    offline: 'Offline',
    pet: 'Pet',
    listenAddress: 'Listen address',
    port: 'Port',
    configuredEndpoint: 'Configured endpoint',
    uptime: 'Uptime',
    lastAction: 'Last action',
    lastEvent: 'Last event',
    bubble: 'Bubble',
    visible: 'Visible',
    quiet: 'Quiet',
    none: 'None',
    generalEyebrow: 'General',
    generalTitle: 'Language & appearance',
    language: 'Language',
    size: 'Size',
    reducedMotion: 'Reduced motion',
    reducedMotionHint: 'Minimize movement while keeping manual gestures available.',
    bubbleAppearance: 'Bubble appearance',
    bubbleStyle: 'Bubble style',
    bubbleFont: 'Bubble font',
    bubbleFontSize: 'Font size',
    bubbleMaxWidth: 'Max width',
    bubblePreview: 'Bubble preview',
    bubblePreviewText: 'OpenPet can say what the agent is doing in this style.',
    bubbleStyleLabels: {
      soft: 'Soft',
      comic: 'Comic',
      glass: 'Glass',
      terminal: 'Terminal',
    },
    petEyebrow: 'Pet & click behavior',
    petTitle: 'Choose a companion and what clicks do',
    activePet: 'Active pet',
    imported: 'imported',
    petStorage: 'Pet storage location',
    petStorageIntro: 'Imports are written to the selected safe pet folder and then served locally.',
    petStoragePresets: {
      'codex-custom': '.codex pets',
      'app-data': 'OpenPet app data',
      custom: 'Custom folder',
    },
    activeStorage: 'Active storage',
    appDataStorage: 'App-data pets',
    codexStorage: '.codex pets',
    customStoragePath: 'Custom storage path',
    customStoragePlaceholder: 'C:\\Users\\you\\Pets\\OpenPet',
    chooseCustomStorage: 'Choose folder',
    applyStorage: 'Apply storage',
    openActiveStorage: 'Open active folder',
    openAppDataStorage: 'Open app-data folder',
    openCodexStorage: 'Open .codex folder',
    clickMode: 'Click mode',
    fixed: 'Fixed',
    random: 'Random',
    fixedClickAction: 'Fixed click action',
    fallbackClickAction: 'Fallback click action',
    randomPool: 'Random action pool',
    randomPoolHint: 'Choose which animations can play when click mode is random.',
    previewClick: 'Preview click action',
    previewFixedClick: 'Preview fixed click action',
    previewRandomClick: 'Preview random click action',
    randomPreviewPrefix: 'Random click preview',
    movement: 'Movement',
    walkSpeed: 'Walk speed',
    autonomousWalking: 'Autonomous walking',
    autonomousWalkingHint: 'Let the pet roam when you are not interacting with it.',
    pauseOnHover: 'Pause on hover',
    pauseOnHoverHint: 'Keep the pet still while your cursor is nearby.',
    idleLife: 'Idle life',
    idleSelfPlay: 'Self-play after inactivity',
    idleSelfPlayHint: 'After the desktop is quiet, reuse action animations for small moments.',
    after: 'After',
    repeatEvery: 'Repeat every',
    idleAction: 'Idle action',
    importEyebrow: 'Import pets',
    importTitle: 'Bring in compatible gallery pets',
    importIntro:
      'Paste a supported detail page URL. The runtime downloads public metadata and the WebP spritesheet into local storage.',
    supportedSites: 'Supported sites',
    importFromWebsite: 'Import from website',
    importPlaceholder: 'https://petdex.crafter.run/pets/boba',
    importHelp:
      'Supports Petdex and Codex Pets URLs, plus compatible pages that expose a Codex-style spritesheet.webp.',
    importPet: 'Import pet',
    importProgress: 'Import in progress',
    importDisclaimer:
      'Import only pets you have rights to use. Imported artwork remains owned by its creators or rights holders.',
    apiEyebrow: 'API / Agent',
    apiTitle: 'Endpoint and agent integrations',
    agentEyebrow: 'Agent setup',
    agentTitle: 'Install MCP and CLI skills',
    debugEyebrow: 'Agent events / API debug',
    debugTitle: 'Connect agents through MCP, HTTP API, or CLI',
    agentModes: 'Control modes',
    mcpMode: 'MCP',
    mcpModeBody: 'Use the bundled stdio MCP bridge from MCP-capable clients.',
    httpMode: 'HTTP API',
    httpModeBody:
      'Call local runtime routes directly for custom integrations.',
    cliMode: 'CLI',
    cliModeBody: 'Use the Python CLI skill from agents and scripts that can run local commands.',
    skillInstaller: 'Bundled skill installer',
    skillInstallerBody: 'Copy selected OpenPet skill folders to known user-level agent destinations.',
    controlSkillAlternatives:
      'CLI and MCP are alternative control integrations. Most users install one control skill, not both.',
    assetSkillPurpose: 'The asset skill is for creating, packaging, and validating OpenPet pets.',
    directApiGuide:
      'Direct HTTP API users can build other integrations; read README/API guidance for more routes and examples.',
    readApiGuide: 'Read API guide',
    bundledSkills: 'Bundled skills',
    installTargets: 'Targets',
    overwriteSkills: 'Overwrite existing skill folders',
    installSkills: 'Install selected skills',
    installResults: 'Install results',
    noBundledSkills: 'No bundled skills found yet.',
    cursorTargetNote: 'Cursor uses project rules/instructions, so the installer reports guidance instead of copying scripts.',
    eventPreview: 'Event preview',
    optionalBubble: 'Optional event bubble text',
    eventAnimations: 'Event animations',
    eventAnimationsHint: 'Play the mapped Codex action when /api/event arrives.',
    eventBubbles: 'Event bubbles',
    eventBubblesHint: 'Show either the event message or the built-in friendly line.',
    bubbleDuration: 'Bubble duration',
    sendPreviewEvent: 'Send preview event',
    speechBubble: 'Speech bubble',
    bubbleText: 'Bubble text',
    sendBubble: 'Send bubble',
    characters: 'characters',
    recentEvents: 'Recent events',
    noRecentEvents: 'No companion events yet. Send one from the preview or API.',
    defaultBubble: 'Default bubble',
    localOnly:
      'The HTTP API listens on the configured local endpoint. Use 0.0.0.0 only when another trusted device needs access.',
    sharedEndpointNote:
      'All control modes use the configured OpenPet local HTTP endpoint and port:',
    apiEndpoint: 'HTTP API endpoint',
    activeEndpoint: 'Active endpoint',
    desiredEndpoint: 'Configured after restart',
    apiHostHelp:
      'Allowed values are loopback or unspecified IPs such as 127.0.0.1 and 0.0.0.0.',
    apiPortHelp: 'Changing the endpoint is saved for the next OpenPet launch.',
    saveApiEndpoint: 'Save endpoint',
    restartRequired: 'Restart OpenPet to apply this endpoint.',
    aboutEyebrow: 'About / support',
    aboutTitle: 'Project links',
    aboutBody:
      'OpenPet is a local desktop pet runtime for Codex-compatible companions, website imports, and agent-friendly HTTP events.',
    projectAddress: 'GitHub project',
    milkTea: 'Buy me milk tea',
    updatesEyebrow: 'Updates',
    updatesTitle: 'Desktop updates',
    updatesBody: 'Signed updater first; GitHub fallback if metadata is missing.',
    autoUpdateChecks: 'Auto-check',
    autoUpdateChecksHint: 'Check on Settings open.',
    checkForUpdates: 'Check',
    openReleasePage: 'GitHub Releases',
    downloadAndInstallUpdate: 'Install',
    restartOpenPet: 'Restart',
    currentVersion: 'Current',
    latestVersion: 'Latest',
    updateSource: 'Source',
    signedUpdaterSource: 'Signed updater',
    githubFallbackSource: 'GitHub fallback',
    releaseNotes: 'Release notes',
    publishedAt: 'Published',
    downloadProgress: 'Progress',
    updateAvailableTitle: 'Update ready',
    updateUnavailableTitle: 'Up to date',
    neverChecked: 'Not checked',
    lastChecked: 'Checked',
    trayTip: 'Tray tip',
    trayTipBody: 'Use the app tray/menu controls for Open Settings, Show Pet, Hide Pet, and Quit.',
  },
  'zh-CN': {
    languages: {
      en: 'English',
      'zh-CN': '简体中文',
    },
    actionLabels: {
      waving: '挥手',
      jumping: '跳跃',
      waiting: '等待',
      running: '原地跑',
      review: '审查',
      failed: '失败',
    },
    eventLabels: {
      thinking: '思考中',
      'tool-running': '工具运行中',
      reviewing: '审查中',
      success: '成功',
      failure: '失败',
      attention: '需要注意',
    },
    eventDescriptions: {
      thinking: 'Agent 正在阅读、规划或推理。',
      'tool-running': 'Agent 正在执行工具或命令。',
      reviewing: 'Agent 正在检查改动或评估输出。',
      success: '任务、检查或阶段目标已经成功完成。',
      failure: '某个步骤失败，或需要用户处理。',
      attention: 'Agent 需要用户关注当前状态。',
    },
    eventBubbleDefaults: {
      thinking: '思考中...',
      'tool-running': '正在运行工具...',
      reviewing: '正在审查改动...',
      success: '完成！',
      failure: '有问题需要处理。',
      attention: '需要你看一下。',
    },
    idleLabels: {
      random: '随机惊喜',
      'active-action': '使用点击动作',
    },
    feedback: {
      ready: '就绪。',
      previewOnly: '浏览器预览模式。请打开 Tauri 桌面应用来控制宠物。',
      statusRefreshed: '状态已刷新。',
      checkingUpdates: '检查更新中...',
      updateAvailable: '发现更新：',
      noUpdate: 'OpenPet 已是最新版本。',
      signedUpdaterUnavailable: '签名元数据不可用，已回退 GitHub。',
      nativeUpdateReady: '签名更新可安装：',
      installingUpdate: '正在安装更新...',
      updateInstalled: '更新已安装。请重启 OpenPet 完成更新。',
      noSignedUpdate: '当前没有可安装的签名更新。',
      restarting: '正在重启 OpenPet...',
      autoUpdatesOn: '自动检查更新已开启。',
      autoUpdatesOff: '自动检查更新已关闭。',
      settingsUpdated: '设置已更新。',
      languageUpdated: '语言已更新。',
      eventAnimationsOn: '事件动画已开启。',
      eventAnimationsOff: '事件动画已关闭。',
      eventBubblesOn: '事件气泡已开启。',
      eventBubblesOff: '事件气泡已关闭。',
      bubbleSent: '气泡已发送。',
      importUrlFirst: '请先粘贴支持的宠物页面 URL。',
      importing: '正在从网站导入宠物...',
      importedPrefix: '已导入',
      fixedMode: '点击模式已设为固定。',
      randomMode: '点击模式已设为随机。',
      poolEmpty: '随机池为空。点击时会回退到固定动作。',
      apiConfigSaved: 'API 端点已保存。',
      apiConfigRestart: 'API 端点已保存，重启 OpenPet 后生效。',
      apiConfigInvalid: '请输入有效的监听地址和端口。',
      petStorageUpdated: '宠物存储位置已更新。',
      customStorageRequired: '请先输入自定义存储路径，再选择自定义预设。',
      folderOpened: '文件夹已打开。',
      folderSelected: '已选择文件夹。',
      linkOpened: '已打开外部链接。',
      installSelectFirst: '请至少选择一个内置 skill 和一个目标。',
      installingSkills: '正在安装所选 skills...',
      skillsInstalled: 'Skill 安装已完成。',
      skillsLoaded: '内置 skills 已加载。',
      petShown: '宠物已显示。',
      petHidden: '宠物已隐藏。',
    },
    tabs: {
      general: '通用',
      import: '导入',
      pet: '宠物',
      bubble: '气泡',
      apiAgent: 'API / Agent',
    },
    heroEyebrow: 'OpenPet',
    heroTitle: '设置、导入和桌宠行为都在这里。',
    heroLede: '单栏控制台，集中处理语言、宠物、兼容导入、本地 API 调试和项目链接。',
    showPet: '显示宠物',
    hidePet: '隐藏宠物',
    refresh: '刷新状态',
    localApi: '本地 API',
    online: '在线',
    offline: '离线',
    pet: '宠物',
    listenAddress: '监听地址',
    port: '端口',
    configuredEndpoint: '已配置端点',
    uptime: '运行时间',
    lastAction: '最近动作',
    lastEvent: '最近事件',
    bubble: '气泡',
    visible: '显示中',
    quiet: '安静',
    none: '无',
    generalEyebrow: '通用',
    generalTitle: '语言与外观',
    language: '语言',
    size: '尺寸',
    reducedMotion: '减少动态效果',
    reducedMotionHint: '降低移动幅度，同时保留手动动作。',
    bubbleAppearance: '气泡外观',
    bubbleStyle: '气泡样式',
    bubbleFont: '气泡字体',
    bubbleFontSize: '字号',
    bubbleMaxWidth: '最大宽度',
    bubblePreview: '气泡预览',
    bubblePreviewText: 'OpenPet 可以用这个样式展示 agent 正在做什么。',
    bubbleStyleLabels: {
      soft: '柔和',
      comic: '漫画',
      glass: '玻璃',
      terminal: '终端',
    },
    petEyebrow: '宠物与点击行为',
    petTitle: '选择宠物，并配置点击后做什么',
    activePet: '当前宠物',
    imported: '已导入',
    petStorage: '宠物存储位置',
    petStorageIntro: '导入会写入所选安全宠物目录，再由本地运行时加载。',
    petStoragePresets: {
      'codex-custom': '.codex 宠物',
      'app-data': 'OpenPet 应用数据',
      custom: '自定义文件夹',
    },
    activeStorage: '当前存储',
    appDataStorage: 'App-data 宠物',
    codexStorage: '.codex 宠物',
    customStoragePath: '自定义存储路径',
    customStoragePlaceholder: 'C:\\Users\\you\\Pets\\OpenPet',
    chooseCustomStorage: '选择文件夹',
    applyStorage: '应用存储位置',
    openActiveStorage: '打开当前文件夹',
    openAppDataStorage: '打开 app-data 文件夹',
    openCodexStorage: '打开 .codex 文件夹',
    clickMode: '点击模式',
    fixed: '固定',
    random: '随机',
    fixedClickAction: '固定点击动作',
    fallbackClickAction: '回退点击动作',
    randomPool: '随机动作池',
    randomPoolHint: '随机模式下，只会从勾选的动画里选择播放。',
    previewClick: '预览点击动作',
    previewFixedClick: '预览固定点击动作',
    previewRandomClick: '预览随机点击动作',
    randomPreviewPrefix: '随机点击预览',
    movement: '移动',
    walkSpeed: '移动速度',
    autonomousWalking: '自主移动',
    autonomousWalkingHint: '未交互时允许宠物在桌面上移动。',
    pauseOnHover: '悬停暂停',
    pauseOnHoverHint: '鼠标靠近时让宠物保持静止。',
    idleLife: '待机生活',
    idleSelfPlay: '空闲后自娱自乐',
    idleSelfPlayHint: '桌面安静一段时间后，复用动作动画制造小互动。',
    after: '等待',
    repeatEvery: '每隔',
    idleAction: '待机动作',
    importEyebrow: '导入宠物',
    importTitle: '从兼容图库导入桌宠',
    importIntro: '粘贴支持的详情页 URL。运行时会把公开元数据和 WebP 精灵图下载到本地存储。',
    supportedSites: '支持站点',
    importFromWebsite: '从网站导入',
    importPlaceholder: 'https://petdex.crafter.run/pets/boba',
    importHelp: '支持 Petdex、Codex Pets，以及暴露 Codex 风格 spritesheet.webp 的兼容页面。',
    importPet: '导入宠物',
    importProgress: '正在导入',
    importDisclaimer: '请只导入你有权使用的宠物。导入素材仍归原作者或权利方所有。',
    apiEyebrow: 'API / Agent',
    apiTitle: '端点与 Agent 接入',
    agentEyebrow: 'Agent 设置',
    agentTitle: '安装 MCP 和 CLI skills',
    debugEyebrow: 'Agent 事件 / API 调试',
    debugTitle: '通过 MCP、HTTP API 或 CLI 接入 Agent',
    agentModes: '控制模式',
    mcpMode: 'MCP',
    mcpModeBody: '支持 MCP 的客户端可使用内置 stdio MCP bridge。',
    httpMode: 'HTTP API',
    httpModeBody: '直接调用本地 runtime 路由来做自定义集成。',
    cliMode: 'CLI',
    cliModeBody: '能运行本地命令的 agent 和脚本可使用 Python CLI skill。',
    skillInstaller: '内置 Skill 安装器',
    skillInstallerBody: '把选中的 OpenPet skill 文件夹复制到已知的用户级 agent 目录。',
    controlSkillAlternatives: 'CLI 和 MCP 是二选一的控制接入方式。多数用户只需要安装其中一个控制 skill。',
    assetSkillPurpose: 'Asset skill 用于创建、打包和校验 OpenPet 宠物。',
    directApiGuide: '直接 HTTP API 可以实现更多自定义集成；更多路由和示例请阅读 README/API 指引。',
    readApiGuide: '阅读 API 指引',
    bundledSkills: '内置 Skills',
    installTargets: '安装目标',
    overwriteSkills: '覆盖已存在的 skill 文件夹',
    installSkills: '安装所选 skills',
    installResults: '安装结果',
    noBundledSkills: '尚未找到内置 skills。',
    cursorTargetNote: 'Cursor 使用项目规则 / 指令，安装器会返回指引而不是复制脚本。',
    eventPreview: '事件预览',
    optionalBubble: '可选事件气泡文本',
    eventAnimations: '事件动画',
    eventAnimationsHint: '/api/event 到达时播放映射的 Codex 动作。',
    eventBubbles: '事件气泡',
    eventBubblesHint: '显示事件消息，或内置友好提示。',
    bubbleDuration: '气泡时长',
    sendPreviewEvent: '发送预览事件',
    speechBubble: '说一句话',
    bubbleText: '气泡文本',
    sendBubble: '发送气泡',
    characters: '字符',
    recentEvents: '最近事件',
    noRecentEvents: '还没有 companion events。可以从预览区或 API 发送一个。',
    defaultBubble: '默认气泡',
    localOnly: 'HTTP API 会监听已配置的本地端点。只有受信任设备需要访问时才使用 0.0.0.0。',
    sharedEndpointNote: '所有控制方式都使用同一个已配置的 OpenPet 本地 HTTP 端点和端口：',
    apiEndpoint: 'HTTP API 端点',
    activeEndpoint: '当前端点',
    desiredEndpoint: '重启后配置',
    apiHostHelp: '允许使用回环或未指定 IP，例如 127.0.0.1 和 0.0.0.0。',
    apiPortHelp: '修改端点会保存到下一次 OpenPet 启动时生效。',
    saveApiEndpoint: '保存端点',
    restartRequired: '重启 OpenPet 后应用这个端点。',
    aboutEyebrow: '关于 / 支持',
    aboutTitle: '项目链接',
    aboutBody: 'OpenPet 是一个本地桌宠运行时，支持 Codex 兼容宠物、网站导入和 Agent 友好的 HTTP 事件。',
    projectAddress: 'GitHub 项目',
    milkTea: '请作者喝奶茶',
    updatesEyebrow: '更新',
    updatesTitle: '桌面更新',
    updatesBody: '优先签名更新；元数据缺失时回退 GitHub。',
    autoUpdateChecks: '自动检查',
    autoUpdateChecksHint: '打开设置时检查。',
    checkForUpdates: '检查更新',
    openReleasePage: 'GitHub 发布页',
    downloadAndInstallUpdate: '安装',
    restartOpenPet: '重启',
    currentVersion: '当前',
    latestVersion: '最新',
    updateSource: '来源',
    signedUpdaterSource: '签名更新器',
    githubFallbackSource: 'GitHub fallback',
    releaseNotes: '更新说明',
    publishedAt: '发布',
    downloadProgress: '进度',
    updateAvailableTitle: '可更新',
    updateUnavailableTitle: '已是最新',
    neverChecked: '未检查',
    lastChecked: '检查',
    trayTip: '托盘提示',
    trayTipBody: '通过应用托盘 / 菜单可打开设置、显示宠物、隐藏宠物和退出。',
  },
} as const;

function isAction(value: string): value is PetActionAnimationId {
  return isPetActionAnimationId(value);
}

function isIdleAction(value: string): value is IdleActionId {
  return IDLE_ACTION_OPTIONS.includes(value as IdleActionId);
}

function isLanguage(value: string): value is PetLanguage {
  return LANGUAGE_OPTIONS.includes(value as PetLanguage);
}

function isClickActionMode(value: string): value is ClickActionMode {
  return CLICK_ACTION_MODES.includes(value as ClickActionMode);
}

function isPetStoragePreset(value: string): value is PetStoragePreset {
  return PET_STORAGE_PRESETS.includes(value as PetStoragePreset);
}

function hasTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function formatDuration(ms: number, language: PetLanguage) {
  const seconds = Math.round(ms / 1000);
  if (language === 'zh-CN') {
    if (seconds < 60) return `${seconds}秒`;
    return `${Math.round(seconds / 60)}分钟`;
  }
  if (seconds < 60) return `${seconds}s`;
  return `${Math.round(seconds / 60)}m`;
}

function formatApiBaseUrl(listenAddress: string, port: number) {
  const host =
    listenAddress === '0.0.0.0'
      ? '127.0.0.1'
      : listenAddress === '::'
        ? '[::1]'
        : listenAddress.includes(':') && !listenAddress.startsWith('[')
          ? `[${listenAddress}]`
          : listenAddress;
  return `http://${host}:${port}`;
}

function formatEventTime(receivedAtMs: number) {
  return new Date(receivedAtMs).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function unknownToMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function errorToMessage(error: unknown, previewOnlyMessage: string) {
  const message = unknownToMessage(error);

  if (
    message.includes('Cannot read properties of undefined') &&
    (message.includes('invoke') || message.includes('transformCallback'))
  ) {
    return previewOnlyMessage;
  }

  return message;
}

function formatBytes(bytes: number) {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'] as const;
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function formatDownloadProgress(progress: UpdateDownloadProgress) {
  if (!progress.contentLength) return formatBytes(progress.downloadedBytes);
  const percent = Math.min(
    100,
    Math.round((progress.downloadedBytes / progress.contentLength) * 100),
  );
  return `${percent}% (${formatBytes(progress.downloadedBytes)} / ${formatBytes(
    progress.contentLength,
  )})`;
}

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<(typeof SETTINGS_TABS)[number]>('general');
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot>(FALLBACK_SNAPSHOT);
  const [message, setMessage] = useState('Hello from OpenPet.');
  const [eventMessage, setEventMessage] = useState('');
  const [websiteImportUrl, setWebsiteImportUrl] = useState('');
  const [previewEvent, setPreviewEvent] = useState<CompanionEventType>('thinking');
  const [feedback, setFeedback] = useState<string>(TRANSLATIONS.en.feedback.ready);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [runtimeReady, setRuntimeReady] = useState(false);
  const [updateCheckResult, setUpdateCheckResult] = useState<UpdateCheckResult | null>(null);
  const [updateSource, setUpdateSource] = useState<UpdateSource | null>(null);
  const [pendingTauriUpdate, setPendingTauriUpdate] = useState<Update | null>(null);
  const [updateNotes, setUpdateNotes] = useState<string | null>(null);
  const [updateInstallPhase, setUpdateInstallPhase] = useState<UpdateInstallPhase>('idle');
  const [updateDownloadProgress, setUpdateDownloadProgress] =
    useState<UpdateDownloadProgress | null>(null);
  const [lastUpdateCheckAt, setLastUpdateCheckAt] = useState<string | null>(null);
  const [bundledSkills, setBundledSkills] = useState<BundledSkill[]>([]);
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [selectedSkillTargetIds, setSelectedSkillTargetIds] = useState<string[]>(['codex']);
  const [skillInstallResults, setSkillInstallResults] = useState<SkillInstallResult[]>([]);
  const [overwriteSkills, setOverwriteSkills] = useState(false);
  const [petStoragePresetDraft, setPetStoragePresetDraft] = useState<PetStoragePreset>(
    FALLBACK_SNAPSHOT.settings.petStoragePreset,
  );
  const [apiListenAddressInput, setApiListenAddressInput] = useState(
    FALLBACK_SNAPSHOT.configuredListenAddress,
  );
  const [apiPortInput, setApiPortInput] = useState(String(FALLBACK_SNAPSHOT.configuredPort));
  const [customPetStorageInput, setCustomPetStorageInput] = useState(
    FALLBACK_SNAPSHOT.settings.customPetStorageDir ?? '',
  );
  const autoUpdateCheckStartedRef = useRef(false);

  const tauriAvailable = hasTauriRuntime();
  const settings = snapshot.settings;
  const language = isLanguage(settings.language) ? settings.language : 'en';
  const t = TRANSLATIONS[language];
  const configuredListenAddress =
    snapshot.configuredListenAddress || FALLBACK_SNAPSHOT.configuredListenAddress;
  const configuredPort = snapshot.configuredPort || FALLBACK_SNAPSHOT.configuredPort;
  const apiBaseUrl = snapshot.apiBaseUrl || FALLBACK_SNAPSHOT.apiBaseUrl;
  const configuredApiBaseUrl = formatApiBaseUrl(configuredListenAddress, configuredPort);
  const activePet = snapshot.activePet;
  const petCatalog =
    snapshot.petCatalog.length > 0 ? snapshot.petCatalog : FALLBACK_SNAPSHOT.petCatalog;
  const petStorage = snapshot.petStorage ?? FALLBACK_SNAPSHOT.petStorage;
  const petVisible = snapshot.petVisible ?? FALLBACK_SNAPSHOT.petVisible;
  const clickActionLabel = t.actionLabels[settings.clickAction];
  const selectedPool = settings.clickActionPool.filter(isAction);
  const poolIsEmpty = settings.clickActionMode === 'random' && selectedPool.length === 0;
  const usingCustomPetStorage = petStoragePresetDraft === 'custom';
  const updateProgressText = updateDownloadProgress
    ? formatDownloadProgress(updateDownloadProgress)
    : null;
  const updateProgressPercent = updateDownloadProgress?.contentLength
    ? Math.min(
        100,
        Math.round(
          (updateDownloadProgress.downloadedBytes / updateDownloadProgress.contentLength) * 100,
        ),
      )
    : null;
  const latestUpdateLabel =
    updateCheckResult?.latestVersion ?? updateCheckResult?.releaseName ?? 'GitHub Release';
  const updateSourceLabel = updateSource
    ? updateSource === 'tauri'
      ? t.signedUpdaterSource
      : t.githubFallbackSource
    : null;
  const updatePublishedAt = updateCheckResult?.publishedAt
    ? new Date(updateCheckResult.publishedAt).toLocaleString()
    : null;
  const updateMetaItems = [
    updateSourceLabel ? `${t.updateSource}: ${updateSourceLabel}` : null,
    updatePublishedAt ? `${t.publishedAt}: ${updatePublishedAt}` : null,
    lastUpdateCheckAt ? `${t.lastChecked}: ${lastUpdateCheckAt}` : null,
  ].filter(Boolean);

  const actionLabel = (action: PetActionAnimationId) => t.actionLabels[action];
  const eventLabel = (eventType: CompanionEventType) => t.eventLabels[eventType];
  const idleActionLabel = (action: IdleActionId) => {
    if (action === 'random' || action === 'active-action') return t.idleLabels[action];
    return actionLabel(action);
  };

  useEffect(() => {
    if (!tauriAvailable) {
      setRuntimeReady(false);
      setFeedback(t.feedback.previewOnly);
      return;
    }

    let cancelled = false;
    void invoke<RuntimeSnapshot>('get_runtime_snapshot')
      .then((next) => {
        if (!cancelled) {
          setSnapshot(next);
          setRuntimeReady(true);
        }
      })
      .catch((error) => {
        setRuntimeReady(false);
        setFeedback(errorToMessage(error, t.feedback.previewOnly));
      });

    let unlisten: (() => void) | null = null;
    void listen<RuntimeSnapshot>('runtime-status', (event) => {
      setSnapshot(event.payload);
      setRuntimeReady(true);
    }).then((next) => {
      unlisten = next;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [tauriAvailable, t.feedback.previewOnly]);

  useEffect(() => {
    setApiListenAddressInput(configuredListenAddress);
    setApiPortInput(String(configuredPort));
  }, [configuredListenAddress, configuredPort]);

  useEffect(() => {
    setCustomPetStorageInput(settings.customPetStorageDir ?? '');
  }, [settings.customPetStorageDir]);

  useEffect(() => {
    setPetStoragePresetDraft(settings.petStoragePreset);
  }, [settings.petStoragePreset]);

  useEffect(() => {
    if (!tauriAvailable) return;
    let cancelled = false;
    void invoke<BundledSkill[]>('list_bundled_skills')
      .then((skills) => {
        if (cancelled) return;
        setBundledSkills(skills);
        setSelectedSkillIds((current) => {
          if (current.length > 0) return current;
          const preferredIds = ['openpet-cli', 'openpet-asset'];
          return preferredIds.filter((id) => skills.some((skill) => skill.id === id));
        });
      })
      .catch((error) => setFeedback(errorToMessage(error, t.feedback.previewOnly)));
    return () => {
      cancelled = true;
    };
  }, [tauriAvailable, t.feedback.previewOnly]);

  const runCommand = async (action: string, task: () => Promise<void>) => {
    if (!tauriAvailable) {
      setFeedback(t.feedback.previewOnly);
      return;
    }

    setBusyAction(action);
    if (action === 'website-import') setFeedback(t.feedback.importing);
    try {
      await task();
    } catch (error) {
      setFeedback(errorToMessage(error, t.feedback.previewOnly));
    } finally {
      setBusyAction(null);
    }
  };

  const resetUpdateInstallState = () => {
    setPendingTauriUpdate(null);
    setUpdateNotes(null);
    setUpdateInstallPhase('idle');
    setUpdateDownloadProgress(null);
  };

  const describeUpdateResult = (result: UpdateCheckResult, source: UpdateSource) => {
    if (result.updateAvailable) {
      if (source === 'tauri') {
        return `${t.feedback.nativeUpdateReady} ${
          result.latestVersion ?? result.releaseName ?? ''
        }`.trim();
      }
      return `${t.feedback.updateAvailable} ${result.latestVersion ?? result.releaseName ?? ''}`.trim();
    }
    return `${t.feedback.noUpdate} (${result.currentVersion})`;
  };

  const checkGithubReleaseFallback = async (prefix?: string) => {
    const result = await invoke<UpdateCheckResult>('check_for_update');
    setUpdateCheckResult(result);
    setUpdateSource('github');
    setPendingTauriUpdate(null);
    setUpdateNotes(null);
    setLastUpdateCheckAt(new Date().toLocaleString());
    setFeedback(`${prefix ? `${prefix} ` : ''}${describeUpdateResult(result, 'github')}`.trim());
  };

  const checkForUpdates = async () => {
    await runCommand('update-check', async () => {
      setFeedback(t.feedback.checkingUpdates);
      resetUpdateInstallState();

      try {
        const update = await check();
        if (!update) {
          await checkGithubReleaseFallback();
          return;
        }

        const result: UpdateCheckResult = {
          currentVersion: update.currentVersion,
          latestVersion: update.version,
          releaseName: null,
          releaseUrl: GITHUB_RELEASES_URL,
          publishedAt: update.date ?? null,
          updateAvailable: true,
        };
        setPendingTauriUpdate(update);
        setUpdateNotes(update.body ?? null);
        setUpdateSource('tauri');
        setUpdateCheckResult(result);
        setLastUpdateCheckAt(new Date().toLocaleString());
        setFeedback(describeUpdateResult(result, 'tauri'));
      } catch (updaterError) {
        try {
          await checkGithubReleaseFallback(t.feedback.signedUpdaterUnavailable);
        } catch (fallbackError) {
          throw new Error(
            `${t.feedback.signedUpdaterUnavailable} ${unknownToMessage(
              updaterError,
            )}; GitHub fallback failed: ${unknownToMessage(fallbackError)}`,
          );
        }
      }
    });
  };

  const installPendingUpdate = async () => {
    if (!pendingTauriUpdate) {
      setFeedback(t.feedback.noSignedUpdate);
      return;
    }

    await runCommand('update-install', async () => {
      setFeedback(t.feedback.installingUpdate);
      setUpdateInstallPhase('downloading');
      setUpdateDownloadProgress({ downloadedBytes: 0, contentLength: null });
      let downloadedBytes = 0;
      let contentLength: number | null = null;
      await pendingTauriUpdate.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === 'Started') {
          downloadedBytes = 0;
          contentLength = event.data.contentLength ?? null;
          setUpdateDownloadProgress({ downloadedBytes, contentLength });
          return;
        }
        if (event.event === 'Progress') {
          downloadedBytes += event.data.chunkLength;
          setUpdateDownloadProgress({ downloadedBytes, contentLength });
          return;
        }
        setUpdateDownloadProgress({ downloadedBytes, contentLength });
      });
      setUpdateInstallPhase('installed');
      setFeedback(t.feedback.updateInstalled);
    });
  };

  const restartOpenPet = async () => {
    await runCommand('update-restart', async () => {
      setFeedback(t.feedback.restarting);
      await relaunch();
    });
  };

  useEffect(() => {
    if (
      !tauriAvailable ||
      !runtimeReady ||
      !settings.autoUpdateChecks ||
      autoUpdateCheckStartedRef.current
    ) {
      return;
    }

    autoUpdateCheckStartedRef.current = true;
    void checkForUpdates();
  }, [runtimeReady, settings.autoUpdateChecks, tauriAvailable]);

  const refreshStatus = async () => {
    await runCommand('refresh', async () => {
      const next = await invoke<RuntimeSnapshot>('get_runtime_snapshot');
      setSnapshot(next);
      setFeedback(t.feedback.statusRefreshed);
    });
  };

  const updateSettings = async (
    nextSettings: PetSettings,
    successMessage: string = t.feedback.settingsUpdated,
  ) => {
    const previousSettings = settings;
    setSnapshot((current) => ({ ...current, settings: nextSettings }));

    await runCommand('settings', async () => {
      try {
        const next = await invoke<RuntimeSnapshot>('update_settings', { settings: nextSettings });
        setSnapshot(next);
        setFeedback(successMessage);
      } catch (error) {
        setSnapshot((current) => ({ ...current, settings: previousSettings }));
        throw error;
      }
    });
  };

  const previewClickAction = async () => {
    const action =
      settings.clickActionMode === 'random'
        ? pickPetActionFromPool(selectedPool, settings.clickAction)
        : settings.clickAction;
    await runCommand('preview', async () => {
      const next = await invoke<RuntimeSnapshot>('trigger_action', { animationId: action });
      setSnapshot(next);
      setFeedback(
        settings.clickActionMode === 'random'
          ? `${t.randomPreviewPrefix}: ${actionLabel(action)}.`
          : `${actionLabel(action)}.`,
      );
    });
  };

  const triggerCompanionEvent = async () => {
    await runCommand('event', async () => {
      const trimmedMessage = eventMessage.trim();
      const next = await invoke<RuntimeSnapshot>('trigger_event', {
        eventType: previewEvent,
        message: trimmedMessage.length > 0 ? trimmedMessage : null,
        ttlMs: settings.eventBubbleTtlMs,
      });
      setSnapshot(next);
      setFeedback(`${eventLabel(previewEvent)}.`);
    });
  };

  const sayMessage = async () => {
    await runCommand('say', async () => {
      const next = await invoke<RuntimeSnapshot>('say', {
        text: message,
        ttlMs: settings.eventBubbleTtlMs,
      });
      setSnapshot(next);
      setFeedback(t.feedback.bubbleSent);
    });
  };

  const importPetFromWebsite = async () => {
    const url = websiteImportUrl.trim();
    if (!url) {
      setFeedback(t.feedback.importUrlFirst);
      return;
    }

    await runCommand('website-import', async () => {
      const next = await invoke<RuntimeSnapshot>('import_pet_from_website', { url });
      setSnapshot(next);
      setWebsiteImportUrl('');
      setFeedback(`${t.feedback.importedPrefix} ${next.activePet.displayName}.`);
    });
  };

  const updateApiConfig = async () => {
    const nextPort = Number(apiPortInput);
    const nextConfig: RuntimeApiConfig = {
      listenAddress: apiListenAddressInput.trim(),
      port: nextPort,
    };

    if (
      !nextConfig.listenAddress ||
      !Number.isInteger(nextPort) ||
      nextPort < MIN_API_PORT ||
      nextPort > MAX_API_PORT
    ) {
      setFeedback(t.feedback.apiConfigInvalid);
      return;
    }

    await runCommand('api-config', async () => {
      const next = await invoke<RuntimeSnapshot>('update_api_config', { config: nextConfig });
      setSnapshot(next);
      setFeedback(
        next.apiRestartRequired ? t.feedback.apiConfigRestart : t.feedback.apiConfigSaved,
      );
    });
  };

  const updatePetStoragePreset = (value: string) => {
    if (!isPetStoragePreset(value)) return;
    setPetStoragePresetDraft(value);
    const customDir = customPetStorageInput.trim() || settings.customPetStorageDir;
    if (value === 'custom' && !customDir) {
      setFeedback(t.feedback.customStorageRequired);
      return;
    }
    void updateSettings(
      {
        ...settings,
        petStoragePreset: value,
        customPetStorageDir: value === 'custom' ? customDir : null,
      },
      t.feedback.petStorageUpdated,
    );
  };

  const chooseCustomPetStorage = async () => {
    await runCommand('choose-storage', async () => {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: t.chooseCustomStorage,
      });
      const selectedPath = Array.isArray(selected) ? selected[0] : selected;
      if (!selectedPath) return;
      setPetStoragePresetDraft('custom');
      setCustomPetStorageInput(selectedPath);
      setFeedback(`${t.feedback.folderSelected} ${selectedPath}`);
    });
  };

  const applyCustomPetStorage = () => {
    const customDir = customPetStorageInput.trim();
    setPetStoragePresetDraft('custom');
    if (!customDir) {
      setFeedback(t.feedback.customStorageRequired);
      return;
    }
    void updateSettings(
      {
        ...settings,
        petStoragePreset: 'custom',
        customPetStorageDir: customDir,
      },
      t.feedback.petStorageUpdated,
    );
  };

  const openPetStorageFolder = async (folder: 'active' | 'app-data' | 'codex-custom') => {
    await runCommand(`open-${folder}`, async () => {
      const opened = await invoke<string>('open_pet_storage_folder', { folder });
      setFeedback(`${t.feedback.folderOpened} ${opened}`);
    });
  };

  const openExternalLink = async (event: MouseEvent<HTMLAnchorElement>, url: string) => {
    if (!tauriAvailable) return;
    event.preventDefault();
    await runCommand('open-external', async () => {
      await invoke<void>('open_external_url', { url });
      setFeedback(t.feedback.linkOpened);
    });
  };

  const openReleasePage = async (event: MouseEvent<HTMLAnchorElement>) => {
    const url = updateCheckResult?.releaseUrl || GITHUB_RELEASES_URL;
    await openExternalLink(event, url);
  };

  const toggleSkillSelection = (skillId: string, checked: boolean) => {
    setSelectedSkillIds((current) =>
      checked ? [...new Set([...current, skillId])] : current.filter((id) => id !== skillId),
    );
  };

  const toggleSkillTarget = (targetId: string, checked: boolean) => {
    setSelectedSkillTargetIds((current) =>
      checked ? [...new Set([...current, targetId])] : current.filter((id) => id !== targetId),
    );
  };

  const installBundledSkills = async () => {
    if (selectedSkillIds.length === 0 || selectedSkillTargetIds.length === 0) {
      setFeedback(t.feedback.installSelectFirst);
      return;
    }

    const payload: InstallBundledSkillsPayload = {
      skillIds: selectedSkillIds,
      targetIds: selectedSkillTargetIds,
      force: overwriteSkills,
    };
    await runCommand('skill-install', async () => {
      setFeedback(t.feedback.installingSkills);
      const results = await invoke<SkillInstallResult[]>('install_bundled_skills', { payload });
      setSkillInstallResults(results);
      setFeedback(t.feedback.skillsInstalled);
    });
  };

  const togglePetVisibility = async () => {
    await runCommand('toggle-pet', async () => {
      const next = await invoke<RuntimeSnapshot>('toggle_pet_visibility');
      setSnapshot(next);
      setFeedback(next.petVisible ? t.feedback.petShown : t.feedback.petHidden);
    });
  };

  const updateLanguage = (value: string) => {
    if (!isLanguage(value)) return;
    void updateSettings(
      { ...settings, language: value },
      TRANSLATIONS[value].feedback.languageUpdated,
    );
  };

  const updateClickMode = (value: string) => {
    if (!isClickActionMode(value)) return;
    void updateSettings(
      { ...settings, clickActionMode: value },
      value === 'fixed' ? t.feedback.fixedMode : t.feedback.randomMode,
    );
  };

  const togglePoolAction = (action: PetActionAnimationId, checked: boolean) => {
    const nextPool = checked
      ? [...new Set([...selectedPool, action])]
      : selectedPool.filter((item) => item !== action);
    const successMessage =
      settings.clickActionMode === 'random' && nextPool.length === 0
        ? t.feedback.poolEmpty
        : t.feedback.settingsUpdated;
    void updateSettings({ ...settings, clickActionPool: nextPool }, successMessage);
  };

  return (
    <main className="settings-shell">
      <section className="settings-hero">
        <div className="hero-copy">
          <p className="eyebrow">{t.heroEyebrow}</p>
          <h1>{t.heroTitle}</h1>
          <p className="hero-lede">{t.heroLede}</p>
          <div className="hero-actions" aria-label="Primary pet actions">
            <button
              className="primary-action"
              type="button"
              onClick={() => void togglePetVisibility()}
              disabled={!tauriAvailable || busyAction === 'toggle-pet'}
            >
              {petVisible ? t.hidePet : t.showPet}
            </button>
            <button
              className="ghost-action"
              type="button"
              onClick={() => void refreshStatus()}
              disabled={!tauriAvailable || busyAction === 'refresh'}
            >
              {t.refresh}
            </button>
          </div>
          <p className="feedback hero-feedback" aria-live="polite">
            {feedback}
          </p>
        </div>
      </section>

      <nav className="settings-tabs" aria-label="Settings sections">
        {SETTINGS_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            className={activeTab === tab ? 'selected' : ''}
            onClick={() => setActiveTab(tab)}
            aria-pressed={activeTab === tab}
          >
            {t.tabs[tab]}
          </button>
        ))}
      </nav>

      <section className="workspace-grid">
        {activeTab === 'general' && (
        <article className="panel general-panel">
          <div className="section-heading">
            <p className="eyebrow">{t.generalEyebrow}</p>
            <h2>{t.generalTitle}</h2>
          </div>

          <label className="field-stack">
            {t.language}
            <select
              value={language}
              onChange={(event) => updateLanguage(event.target.value)}
              disabled={!tauriAvailable || busyAction === 'settings'}
            >
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {t.languages[option]}
                </option>
              ))}
            </select>
          </label>

          <div className="control-group">
            <span className="control-label">{t.size}</span>
            <div className="segmented-control six" role="group" aria-label={t.size}>
              {SCALE_OPTIONS.map((scale) => (
                <button
                  key={scale}
                  type="button"
                  className={settings.scale === scale ? 'selected' : ''}
                  onClick={() => void updateSettings({ ...settings, scale }, `${scale}x`)}
                  disabled={!tauriAvailable || busyAction === 'settings'}
                  aria-pressed={settings.scale === scale}
                >
                  {scale}x
                </button>
              ))}
            </div>
          </div>

          <label className="toggle-card">
            <input
              type="checkbox"
              checked={settings.reducedMotion}
              onChange={(event) =>
                void updateSettings({ ...settings, reducedMotion: event.target.checked })
              }
              disabled={!tauriAvailable || busyAction === 'settings'}
            />
            <span>
              <strong>{t.reducedMotion}</strong>
              <small>{t.reducedMotionHint}</small>
            </span>
          </label>

          <div className="subsection-divider" />

          <div className="section-heading compact-heading">
            <p className="eyebrow">{t.aboutEyebrow}</p>
            <h3>{t.aboutTitle}</h3>
          </div>
          <p className="helper-text">{t.aboutBody}</p>
          <nav className="support-links" aria-label={t.aboutTitle}>
            {PROJECT_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => void openExternalLink(event, link.href)}
              >
                {t[link.key]}
              </a>
            ))}
          </nav>
          <div className="update-strip">
            <div className="update-strip-main">
              <div className="update-strip-copy">
                <p className="eyebrow">{t.updatesEyebrow}</p>
                <h3>{t.updatesTitle}</h3>
                <span>{t.updatesBody}</span>
              </div>
              <div className="update-strip-controls">
                <label className="compact-switch">
                  <input
                    type="checkbox"
                    checked={settings.autoUpdateChecks}
                    onChange={(event) => {
                      const enabled = event.target.checked;
                      void updateSettings(
                        { ...settings, autoUpdateChecks: enabled },
                        enabled ? t.feedback.autoUpdatesOn : t.feedback.autoUpdatesOff,
                      );
                    }}
                    disabled={!tauriAvailable || busyAction === 'settings'}
                  />
                  <span>{t.autoUpdateChecks}</span>
                </label>
                <button
                  type="button"
                  onClick={() => void checkForUpdates()}
                  disabled={!tauriAvailable || busyAction === 'update-check'}
                >
                  {busyAction === 'update-check' ? t.feedback.checkingUpdates : t.checkForUpdates}
                </button>
                {pendingTauriUpdate && updateInstallPhase !== 'installed' && (
                  <button
                    type="button"
                    onClick={() => void installPendingUpdate()}
                    disabled={
                      !tauriAvailable ||
                      busyAction === 'update-check' ||
                      busyAction === 'update-install'
                    }
                  >
                    {busyAction === 'update-install'
                      ? t.feedback.installingUpdate
                      : t.downloadAndInstallUpdate}
                  </button>
                )}
                {updateInstallPhase === 'installed' && (
                  <button
                    type="button"
                    onClick={() => void restartOpenPet()}
                    disabled={!tauriAvailable || busyAction === 'update-restart'}
                  >
                    {busyAction === 'update-restart' ? t.feedback.restarting : t.restartOpenPet}
                  </button>
                )}
                {updateCheckResult?.updateAvailable && (
                  <a
                    href={updateCheckResult.releaseUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(event) => void openReleasePage(event)}
                  >
                    {t.openReleasePage}
                  </a>
                )}
              </div>
            </div>
            {updateCheckResult ? (
              <div
                className={`update-result-line ${
                  updateCheckResult.updateAvailable ? 'available' : 'current'
                }`}
              >
                <div className="update-result-summary">
                  <strong>
                    {updateCheckResult.updateAvailable
                      ? t.updateAvailableTitle
                      : t.updateUnavailableTitle}
                  </strong>
                  <span>
                    {t.currentVersion}: {updateCheckResult.currentVersion} - {t.latestVersion}:{' '}
                    {latestUpdateLabel}
                  </span>
                </div>
                {updateMetaItems.length > 0 && (
                  <small className="update-result-meta">{updateMetaItems.join(' · ')}</small>
                )}
                {(updateProgressText || updateNotes) && (
                  <div className="update-result-detail">
                    {updateProgressText && (
                      <div className="update-progress" aria-live="polite">
                        <small>
                          {t.downloadProgress}: {updateProgressText}
                        </small>
                        {updateProgressPercent !== null && (
                          <div className="update-progress-track">
                            <span style={{ width: `${updateProgressPercent}%` }} />
                          </div>
                        )}
                      </div>
                    )}
                    {updateNotes && (
                      <details className="update-notes">
                        <summary>{t.releaseNotes}</summary>
                        <small>{updateNotes}</small>
                      </details>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <p className="update-empty">{t.neverChecked}</p>
            )}
          </div>
          <div className="tray-note">
            <strong>{t.trayTip}</strong>
            <span>{t.trayTipBody}</span>
          </div>
        </article>
        )}

        {activeTab === 'import' && (
        <article className="panel pet-panel">
          <div className="section-heading">
            <p className="eyebrow">{t.importEyebrow}</p>
            <h2>{t.importTitle}</h2>
          </div>

          <div className="sub-panel import-inline">
            <div className="section-heading compact-heading">
              <p className="eyebrow">{t.importEyebrow}</p>
              <h3>{t.importTitle}</h3>
            </div>
            <p className="helper-text">{t.importIntro}</p>
            <div className="source-links" aria-label={t.supportedSites}>
              <span>{t.supportedSites}</span>
              {PET_IMPORT_SOURCE_LINKS.map((source) => (
                <a
                  key={source.href}
                  href={source.href}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(event) => void openExternalLink(event, source.href)}
                >
                  {source.label}
                </a>
              ))}
            </div>

            <form
              className="import-card"
              onSubmit={(event) => {
                event.preventDefault();
                void importPetFromWebsite();
              }}
            >
              <label className="field-stack">
                {t.importFromWebsite}
                <input
                  type="url"
                  value={websiteImportUrl}
                  onChange={(event) => setWebsiteImportUrl(event.target.value)}
                  placeholder={t.importPlaceholder}
                  disabled={!tauriAvailable || busyAction === 'website-import'}
                />
              </label>
              <p className="helper-text">{t.importHelp}</p>
              {busyAction === 'website-import' && (
                <div className="import-progress" role="progressbar" aria-label={t.importProgress}>
                  <span />
                </div>
              )}
              <button type="submit" disabled={!tauriAvailable || busyAction === 'website-import'}>
                {busyAction === 'website-import' ? t.feedback.importing : t.importPet}
              </button>
            </form>
            <p className="helper-text">{t.importDisclaimer}</p>
          </div>

          <div className="sub-panel storage-panel">
            <div className="section-heading compact-heading">
              <h3>{t.petStorage}</h3>
            </div>
            <p className="helper-text">{t.petStorageIntro}</p>
            <div className="segmented-control three" role="group" aria-label={t.petStorage}>
              {PET_STORAGE_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={petStoragePresetDraft === preset ? 'selected' : ''}
                  onClick={() => updatePetStoragePreset(preset)}
                  disabled={!tauriAvailable || busyAction === 'settings'}
                  aria-pressed={petStoragePresetDraft === preset}
                >
                  {t.petStoragePresets[preset]}
                </button>
              ))}
            </div>
            {usingCustomPetStorage && (
            <div className="path-action-row">
              <label className="field-stack">
                {t.customStoragePath}
                <input
                  type="text"
                  value={customPetStorageInput}
                  onChange={(event) => setCustomPetStorageInput(event.target.value)}
                  placeholder={t.customStoragePlaceholder}
                  disabled={!tauriAvailable || busyAction === 'settings'}
                />
              </label>
              <button
                className="icon-action"
                type="button"
                onClick={() => void chooseCustomPetStorage()}
                disabled={!tauriAvailable || busyAction === 'choose-storage'}
                title={t.chooseCustomStorage}
                aria-label={t.chooseCustomStorage}
              >
                📁
              </button>
              <button
                className="icon-action"
                type="button"
                onClick={applyCustomPetStorage}
                disabled={!tauriAvailable || busyAction === 'settings' || !customPetStorageInput.trim()}
                title={t.applyStorage}
                aria-label={t.applyStorage}
              >
                💾
              </button>
            </div>
            )}
            <div className="storage-readout">
              <span>
                {t.activeStorage}: <code>{petStorage.activeDir}</code>
              </span>
              <span>
                {t.appDataStorage}: <code>{petStorage.appDataDir}</code>
              </span>
              <span>
                {t.codexStorage}: <code>{petStorage.codexDir}</code>
              </span>
            </div>
            <div className="button-row">
              <button
                className="ghost-action compact-action"
                type="button"
                onClick={() => void openPetStorageFolder('active')}
                disabled={!tauriAvailable || busyAction?.startsWith('open-')}
              >
                {t.openActiveStorage}
              </button>
              <button
                type="button"
                className="ghost-action compact-action"
                onClick={() => void openPetStorageFolder('app-data')}
                disabled={!tauriAvailable || busyAction?.startsWith('open-')}
              >
                {t.openAppDataStorage}
              </button>
              <button
                type="button"
                className="ghost-action compact-action"
                onClick={() => void openPetStorageFolder('codex-custom')}
                disabled={!tauriAvailable || busyAction?.startsWith('open-')}
              >
                {t.openCodexStorage}
              </button>
            </div>
          </div>

        </article>
        )}

        {activeTab === 'pet' && (
        <article className="panel pet-panel">
          <div className="section-heading">
            <p className="eyebrow">{t.petEyebrow}</p>
            <h2>{t.petTitle}</h2>
          </div>

          <label className="field-stack">
            {t.activePet}
            <select
              value={settings.activePetId}
              onChange={(event) => {
                const value = event.target.value;
                if (!isPetId(value, petCatalog)) return;
                const nextPet = petCatalog.find((pet) => pet.id === value);
                void updateSettings(
                  { ...settings, activePetId: value },
                  nextPet?.displayName ?? value,
                );
              }}
              disabled={!tauriAvailable || busyAction === 'settings'}
            >
              {petCatalog.map((pet) => (
                <option key={pet.id} value={pet.id}>
                  {pet.displayName}
                  {pet.imported ? ` (${t.imported})` : ''}
                </option>
              ))}
            </select>
          </label>

          <div className="catalog-card">
            <strong>{activePet.displayName}</strong>
            <span>{activePet.description}</span>
            <code>{activePet.spritesheetUrl}</code>
            {activePet.sourceName && (
              <small>
                {activePet.sourceUrl ? (
                  <a
                    href={activePet.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(event) => void openExternalLink(event, activePet.sourceUrl ?? '')}
                  >
                    {activePet.sourceName}
                  </a>
                ) : (
                  activePet.sourceName
                )}
              </small>
            )}
          </div>

          <div className="subsection-divider" />

          <div className="control-group">
            <span className="control-label">{t.clickMode}</span>
            <div className="segmented-control two" role="group" aria-label={t.clickMode}>
              {CLICK_ACTION_MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={settings.clickActionMode === mode ? 'selected' : ''}
                  onClick={() => updateClickMode(mode)}
                  disabled={!tauriAvailable || busyAction === 'settings'}
                  aria-pressed={settings.clickActionMode === mode}
                >
                  {mode === 'fixed' ? t.fixed : t.random}
                </button>
              ))}
            </div>
          </div>

          {settings.clickActionMode === 'fixed' && (
            <label className="field-stack">
              {t.fixedClickAction}
              <select
                value={settings.clickAction}
                onChange={(event) => {
                  const value = event.target.value;
                  if (isAction(value)) {
                    void updateSettings(
                      { ...settings, clickAction: value },
                      `${actionLabel(value)}.`,
                    );
                  }
                }}
                disabled={!tauriAvailable || busyAction === 'settings'}
              >
                {PET_ACTION_ANIMATION_IDS.map((action) => (
                  <option key={action} value={action}>
                    {actionLabel(action)}
                  </option>
                ))}
              </select>
            </label>
          )}

          {settings.clickActionMode === 'random' && (
            <div className="field-stack">
              <span>{t.randomPool}</span>
              <p className="helper-text">{t.randomPoolHint}</p>
              <div className="action-pool">
                {PET_ACTION_ANIMATION_IDS.map((action) => (
                  <label className="check-pill" key={action}>
                    <input
                      type="checkbox"
                      checked={selectedPool.includes(action)}
                      onChange={(event) => togglePoolAction(action, event.target.checked)}
                      disabled={!tauriAvailable || busyAction === 'settings'}
                    />
                    <span>{actionLabel(action)}</span>
                  </label>
                ))}
              </div>
              {poolIsEmpty && (
                <label className="field-stack fallback-field">
                  {t.fallbackClickAction}
                  <select
                    value={settings.clickAction}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (isAction(value)) void updateSettings({ ...settings, clickAction: value });
                    }}
                    disabled={!tauriAvailable || busyAction === 'settings'}
                  >
                    {PET_ACTION_ANIMATION_IDS.map((action) => (
                      <option key={action} value={action}>
                        {actionLabel(action)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {poolIsEmpty && <p className="warn-text">{t.feedback.poolEmpty}</p>}
            </div>
          )}

          <button
            className="compact-action"
            type="button"
            onClick={() => void previewClickAction()}
            disabled={!tauriAvailable || busyAction === 'preview'}
          >
            {settings.clickActionMode === 'random'
              ? t.previewRandomClick
              : `${t.previewFixedClick}: ${clickActionLabel}`}
          </button>

          <div className="subsection-divider" />

          <div className="section-heading compact-heading">
            <h3>{t.movement}</h3>
          </div>
          <div className="control-group">
            <span className="control-label">{t.walkSpeed}</span>
            <div className="segmented-control four" role="group" aria-label={t.walkSpeed}>
              {WALKING_SPEED_OPTIONS.map((speed) => (
                <button
                  key={speed}
                  type="button"
                  className={settings.walkingSpeedPx === speed ? 'selected' : ''}
                  onClick={() => void updateSettings({ ...settings, walkingSpeedPx: speed })}
                  disabled={!tauriAvailable || busyAction === 'settings'}
                  aria-pressed={settings.walkingSpeedPx === speed}
                >
                  {speed}px
                </button>
              ))}
            </div>
          </div>

          <div className="toggle-list three">
            <label className="toggle-card">
              <input
                type="checkbox"
                checked={settings.autonomousWalking}
                onChange={(event) =>
                  void updateSettings({ ...settings, autonomousWalking: event.target.checked })
                }
                disabled={!tauriAvailable || busyAction === 'settings'}
              />
              <span>
                <strong>{t.autonomousWalking}</strong>
                <small>{t.autonomousWalkingHint}</small>
              </span>
            </label>

            <label className="toggle-card">
              <input
                type="checkbox"
                checked={settings.hoverPause}
                onChange={(event) =>
                  void updateSettings({ ...settings, hoverPause: event.target.checked })
                }
                disabled={!tauriAvailable || busyAction === 'settings'}
              />
              <span>
                <strong>{t.pauseOnHover}</strong>
                <small>{t.pauseOnHoverHint}</small>
              </span>
            </label>

            <label className="toggle-card feature-toggle">
              <input
                type="checkbox"
                checked={settings.idleSelfPlay}
                onChange={(event) =>
                  void updateSettings({ ...settings, idleSelfPlay: event.target.checked })
                }
                disabled={!tauriAvailable || busyAction === 'settings'}
              />
              <span>
                <strong>{t.idleSelfPlay}</strong>
                <small>{t.idleSelfPlayHint}</small>
              </span>
            </label>
          </div>

          <div className="control-columns three">
            <label className="field-stack">
              {t.after}
              <select
                value={settings.idleThresholdMs}
                onChange={(event) =>
                  void updateSettings({
                    ...settings,
                    idleThresholdMs: Number(event.target.value),
                  })
                }
                disabled={!tauriAvailable || busyAction === 'settings'}
              >
                {IDLE_THRESHOLD_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {formatDuration(value, language)}
                  </option>
                ))}
              </select>
            </label>

            <label className="field-stack">
              {t.repeatEvery}
              <select
                value={settings.idleActionFrequencyMs}
                onChange={(event) =>
                  void updateSettings({
                    ...settings,
                    idleActionFrequencyMs: Number(event.target.value),
                  })
                }
                disabled={!tauriAvailable || busyAction === 'settings'}
              >
                {IDLE_FREQUENCY_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {formatDuration(value, language)}
                  </option>
                ))}
              </select>
            </label>

            <label className="field-stack">
              {t.idleAction}
              <select
                value={settings.idleAction}
                onChange={(event) => {
                  const value = event.target.value;
                  if (isIdleAction(value)) void updateSettings({ ...settings, idleAction: value });
                }}
                disabled={!tauriAvailable || busyAction === 'settings'}
              >
                {IDLE_ACTION_OPTIONS.map((action) => (
                  <option key={action} value={action}>
                    {idleActionLabel(action)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </article>
        )}

        {activeTab === 'bubble' && (
        <article className="panel debug-panel">
          <div className="section-heading">
            <p className="eyebrow">{t.bubble}</p>
            <h2>{t.speechBubble}</h2>
          </div>

          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            rows={4}
            aria-label={t.bubbleText}
          />
          <div className="panel-footer">
            <span>
              {message.trim().length}/512 {t.characters}
            </span>
            <button
              className="compact-action"
              type="button"
              onClick={() => void sayMessage()}
              disabled={!tauriAvailable || busyAction === 'say'}
            >
              {t.sendBubble}
            </button>
          </div>

          <div className="subsection-divider" />

          <label className="field-stack">
            {t.eventPreview}
            <select
              value={previewEvent}
              onChange={(event) => {
                const value = event.target.value;
                if (isCompanionEventType(value)) setPreviewEvent(value);
              }}
            >
              {COMPANION_EVENT_TYPES.map((eventType) => (
                <option key={eventType} value={eventType}>
                  {eventLabel(eventType)} {'->'}{' '}
                  {actionLabel(COMPANION_EVENTS[eventType].animationId)}
                </option>
              ))}
            </select>
          </label>

          <p className="helper-text">{t.eventDescriptions[previewEvent]}</p>

          <textarea
            value={eventMessage}
            onChange={(event) => setEventMessage(event.target.value)}
            rows={3}
            aria-label={t.optionalBubble}
            placeholder={t.eventBubbleDefaults[previewEvent]}
          />

          <div className="toggle-list compact">
            <label className="toggle-card">
              <input
                type="checkbox"
                checked={settings.eventReactions}
                onChange={(event) =>
                  void updateSettings(
                    { ...settings, eventReactions: event.target.checked },
                    event.target.checked
                      ? t.feedback.eventAnimationsOn
                      : t.feedback.eventAnimationsOff,
                  )
                }
                disabled={!tauriAvailable || busyAction === 'settings'}
              />
              <span>
                <strong>{t.eventAnimations}</strong>
                <small>{t.eventAnimationsHint}</small>
              </span>
            </label>

            <label className="toggle-card">
              <input
                type="checkbox"
                checked={settings.eventBubbles}
                onChange={(event) =>
                  void updateSettings(
                    { ...settings, eventBubbles: event.target.checked },
                    event.target.checked ? t.feedback.eventBubblesOn : t.feedback.eventBubblesOff,
                  )
                }
                disabled={!tauriAvailable || busyAction === 'settings'}
              />
              <span>
                <strong>{t.eventBubbles}</strong>
                <small>{t.eventBubblesHint}</small>
              </span>
            </label>
          </div>

          <div className="control-group">
            <span className="control-label">{t.bubbleDuration}</span>
            <div className="segmented-control four" role="group" aria-label={t.bubbleDuration}>
              {BUBBLE_TTL_OPTIONS.map((ttlMs) => (
                <button
                  key={ttlMs}
                  type="button"
                  className={settings.eventBubbleTtlMs === ttlMs ? 'selected' : ''}
                  onClick={() => void updateSettings({ ...settings, eventBubbleTtlMs: ttlMs })}
                  disabled={!tauriAvailable || busyAction === 'settings'}
                  aria-pressed={settings.eventBubbleTtlMs === ttlMs}
                >
                  {formatDuration(ttlMs, language)}
                </button>
              ))}
            </div>
          </div>

          <button
            className="compact-action"
            type="button"
            onClick={() => void triggerCompanionEvent()}
            disabled={!tauriAvailable || busyAction === 'event'}
          >
            {t.sendPreviewEvent}
          </button>

          <div className="subsection-divider" />

          <div className="section-heading compact-heading">
            <h3>{t.bubbleAppearance}</h3>
          </div>
          <div className="control-group">
            <span className="control-label">{t.bubbleStyle}</span>
            <div className="segmented-control four" role="group" aria-label={t.bubbleStyle}>
              {BUBBLE_STYLE_OPTIONS.map((style) => (
                <button
                  key={style}
                  type="button"
                  className={settings.bubbleStyle === style ? 'selected' : ''}
                  onClick={() => void updateSettings({ ...settings, bubbleStyle: style })}
                  disabled={!tauriAvailable || busyAction === 'settings'}
                  aria-pressed={settings.bubbleStyle === style}
                >
                  {t.bubbleStyleLabels[style]}
                </button>
              ))}
            </div>
          </div>
          <div className="control-columns three">
            <label className="field-stack">
              {t.bubbleFont}
              <input
                type="text"
                value={settings.bubbleFontFamily}
                onChange={(event) =>
                  void updateSettings({ ...settings, bubbleFontFamily: event.target.value })
                }
                disabled={!tauriAvailable || busyAction === 'settings'}
              />
            </label>
            <label className="field-stack">
              {t.bubbleFontSize}
              <select
                value={settings.bubbleFontSizePx}
                onChange={(event) =>
                  void updateSettings({
                    ...settings,
                    bubbleFontSizePx: Number(event.target.value),
                  })
                }
                disabled={!tauriAvailable || busyAction === 'settings'}
              >
                {BUBBLE_FONT_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>
                    {size}px
                  </option>
                ))}
              </select>
            </label>
            <label className="field-stack">
              {t.bubbleMaxWidth}
              <select
                value={settings.bubbleMaxWidthPx}
                onChange={(event) =>
                  void updateSettings({
                    ...settings,
                    bubbleMaxWidthPx: Number(event.target.value),
                  })
                }
                disabled={!tauriAvailable || busyAction === 'settings'}
              >
                {BUBBLE_WIDTH_OPTIONS.map((width) => (
                  <option key={width} value={width}>
                    {width}px
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="bubble-preview-card">
            <span>{t.bubblePreview}</span>
            <div
              className={`pet-bubble preview-bubble pet-bubble-${settings.bubbleStyle}`}
              style={{
                fontFamily: settings.bubbleFontFamily,
                fontSize: `${settings.bubbleFontSizePx}px`,
                maxWidth: `${settings.bubbleMaxWidthPx}px`,
              }}
            >
              {t.bubblePreviewText}
            </div>
          </div>

          <div className="subsection-divider" />

          <div className="section-heading compact-heading">
            <h3>{t.recentEvents}</h3>
          </div>
          {snapshot.recentEvents.length === 0 ? (
            <p className="helper-text">{t.noRecentEvents}</p>
          ) : (
            <ol className="event-list">
              {snapshot.recentEvents.map((event) => (
                <li key={`${event.eventType}:${event.receivedAtMs}`}>
                  <span>{formatEventTime(event.receivedAtMs)}</span>
                  <strong>{eventLabel(event.eventType)}</strong>
                  <em>{actionLabel(event.animationId)}</em>
                  <small>{event.message || event.bubbleText || t.defaultBubble}</small>
                </li>
              ))}
            </ol>
          )}
        </article>
        )}

        {activeTab === 'apiAgent' && (
        <article className="panel debug-panel">
          <div className="section-heading">
            <p className="eyebrow">{t.apiEyebrow}</p>
            <h2>{t.apiTitle}</h2>
          </div>

          <div className="mode-grid" aria-label={t.agentModes}>
            <div className="mode-card">
              <strong>{t.httpMode}</strong>
              <span>{t.httpModeBody}</span>
            </div>
            <div className="mode-card">
              <strong>{t.mcpMode}</strong>
              <span>{t.mcpModeBody}</span>
            </div>
            <div className="mode-card">
              <strong>{t.cliMode}</strong>
              <span>{t.cliModeBody}</span>
            </div>
          </div>
          <p className="helper-text endpoint-shared-note">
            {t.sharedEndpointNote} <code>{configuredApiBaseUrl}</code>
          </p>

          <div className="subsection-divider" />

          <div className="section-heading compact-heading">
            <h3>{t.apiEndpoint}</h3>
          </div>
          <div className="api-config-card">
            <div className="endpoint-readout">
              <span>
                {t.activeEndpoint}: <code>{apiBaseUrl}</code>
              </span>
              <span>
                {t.desiredEndpoint}: <code>{configuredApiBaseUrl}</code>
              </span>
            </div>
            <div className="control-columns two">
              <label className="field-stack">
                {t.listenAddress}
                <input
                  type="text"
                  value={apiListenAddressInput}
                  onChange={(event) => setApiListenAddressInput(event.target.value)}
                  disabled={!tauriAvailable || busyAction === 'api-config'}
                />
              </label>
              <label className="field-stack">
                {t.port}
                <input
                  type="number"
                  min={MIN_API_PORT}
                  max={MAX_API_PORT}
                  value={apiPortInput}
                  onChange={(event) => setApiPortInput(event.target.value)}
                  disabled={!tauriAvailable || busyAction === 'api-config'}
                />
              </label>
            </div>
            <p className="helper-text">
              {t.apiHostHelp} {t.apiPortHelp}
            </p>
            {snapshot.apiRestartRequired && <p className="warn-text">{t.restartRequired}</p>}
            <button
              className="compact-action"
              type="button"
              onClick={() => void updateApiConfig()}
              disabled={!tauriAvailable || busyAction === 'api-config'}
            >
              {t.saveApiEndpoint}
            </button>
          </div>
          <p className="helper-text">
            {t.localOnly} <code>{apiBaseUrl}</code>
          </p>
          <p className="helper-text">
            {t.directApiGuide}{' '}
            <a
              href="https://github.com/X-T-E-R/OpenPet#direct-http-api"
              target="_blank"
              rel="noreferrer"
              onClick={(event) =>
                void openExternalLink(event, 'https://github.com/X-T-E-R/OpenPet#direct-http-api')
              }
            >
              {t.readApiGuide}
            </a>
          </p>

          <div className="subsection-divider" />

          <div className="section-heading compact-heading">
            <h3>{t.skillInstaller}</h3>
          </div>
          <p className="helper-text">{t.skillInstallerBody}</p>
          <p className="helper-text">{t.controlSkillAlternatives}</p>
          <p className="helper-text">{t.assetSkillPurpose}</p>
          <div className="installer-grid">
            <div>
              <span className="control-label">{t.bundledSkills}</span>
              <div className="action-pool">
                {bundledSkills.length === 0 ? (
                  <p className="helper-text">{t.noBundledSkills}</p>
                ) : (
                  bundledSkills.map((skill) => (
                    <label className="check-pill tall-pill" key={skill.id}>
                      <input
                        type="checkbox"
                        checked={selectedSkillIds.includes(skill.id)}
                        onChange={(event) => toggleSkillSelection(skill.id, event.target.checked)}
                        disabled={!tauriAvailable || busyAction === 'skill-install'}
                      />
                      <span>
                        <strong>{skill.displayName}</strong>
                        <small>{skill.description}</small>
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>
            <div>
              <span className="control-label">{t.installTargets}</span>
              <div className="action-pool">
                {SKILL_TARGETS.map((target) => (
                  <label className="check-pill" key={target.id}>
                    <input
                      type="checkbox"
                      checked={selectedSkillTargetIds.includes(target.id)}
                      onChange={(event) => toggleSkillTarget(target.id, event.target.checked)}
                      disabled={!tauriAvailable || busyAction === 'skill-install'}
                    />
                    <span>{target.label}</span>
                  </label>
                ))}
              </div>
              <p className="helper-text">{t.cursorTargetNote}</p>
            </div>
          </div>
          <label className="toggle-card compact-toggle">
            <input
              type="checkbox"
              checked={overwriteSkills}
              onChange={(event) => setOverwriteSkills(event.target.checked)}
              disabled={!tauriAvailable || busyAction === 'skill-install'}
            />
            <span>
              <strong>{t.overwriteSkills}</strong>
            </span>
          </label>
          <button
            className="compact-action"
            type="button"
            onClick={() => void installBundledSkills()}
            disabled={!tauriAvailable || busyAction === 'skill-install'}
          >
            {busyAction === 'skill-install' ? t.feedback.installingSkills : t.installSkills}
          </button>
          {skillInstallResults.length > 0 && (
            <div className="install-results">
              <strong>{t.installResults}</strong>
              <ol>
                {skillInstallResults.map((result, index) => (
                  <li key={`${result.skillId}:${result.targetId}:${index}`}>
                    <span className={`result-status ${result.status}`}>{result.status}</span>
                    <span>
                      {result.skillId} → {result.targetLabel}
                    </span>
                    {result.targetPath && <code>{result.targetPath}</code>}
                    <small>{result.message}</small>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </article>
        )}
      </section>
    </main>
  );
}
