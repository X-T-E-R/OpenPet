mod http_api;

use serde::{Deserialize, Serialize};
use std::{
    fs,
    net::{IpAddr, ToSocketAddrs},
    path::{Component, Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{
    menu::{Menu, MenuItem},
    path::BaseDirectory,
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, WindowEvent,
};

const DEFAULT_PORT: u16 = 17321;
const DEFAULT_LISTEN_ADDRESS: &str = "127.0.0.1";
const DEFAULT_BUBBLE_TTL_MS: u64 = 4000;
const EVENT_PET_ACTION: &str = "pet-action";
const EVENT_PET_SAY: &str = "pet-say";
const EVENT_PET_SETTINGS: &str = "pet-settings";
const EVENT_RUNTIME_STATUS: &str = "runtime-status";
const RUNTIME_CONFIG_FILE: &str = "data/runtime-config.toml";
const LEGACY_RUNTIME_CONFIG_FILE: &str = "runtime-config.json";
const SETTINGS_CONFIG_FILE: &str = "data/settings.toml";
const RECENT_EVENT_LIMIT: usize = 12;
const DEFAULT_PET_ID: &str = "nia";
const MAX_HTML_BYTES: usize = 2 * 1024 * 1024;
const MAX_JSON_BYTES: usize = 1024 * 1024;
const MAX_SPRITESHEET_BYTES: usize = 12 * 1024 * 1024;
const BUNDLED_SKILL_IDS: &[&str] = &["openpet-cli", "openpet-mcp", "openpet-asset"];
const GITHUB_RELEASES_URL: &str = "https://github.com/X-T-E-R/OpenPet/releases";
const GITHUB_LATEST_RELEASE_API: &str =
    "https://api.github.com/repos/X-T-E-R/OpenPet/releases/latest";
const UPDATE_CHECK_TIMEOUT_SECS: u64 = 10;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PetActionAnimationId {
    Waving,
    Jumping,
    Failed,
    Waiting,
    Running,
    Review,
}

impl PetActionAnimationId {
    fn as_str(self) -> &'static str {
        match self {
            Self::Waving => "waving",
            Self::Jumping => "jumping",
            Self::Failed => "failed",
            Self::Waiting => "waiting",
            Self::Running => "running",
            Self::Review => "review",
        }
    }
}

impl Default for PetActionAnimationId {
    fn default() -> Self {
        Self::Waving
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum PetLanguage {
    #[serde(rename = "en")]
    En,
    #[serde(rename = "zh-CN")]
    ZhCn,
}

impl Default for PetLanguage {
    fn default() -> Self {
        Self::En
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ClickActionMode {
    Fixed,
    Random,
}

impl Default for ClickActionMode {
    fn default() -> Self {
        Self::Random
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum IdleActionId {
    Random,
    ActiveAction,
    Waving,
    Jumping,
    Failed,
    Waiting,
    Running,
    Review,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum BubbleStyle {
    Soft,
    Comic,
    Glass,
    Terminal,
}

impl Default for BubbleStyle {
    fn default() -> Self {
        Self::Soft
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PetStoragePreset {
    AppData,
    CodexCustom,
    Custom,
}

impl Default for PetStoragePreset {
    fn default() -> Self {
        Self::CodexCustom
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum CompanionEventType {
    Thinking,
    ToolRunning,
    Reviewing,
    Success,
    Failure,
    Attention,
}

impl CompanionEventType {
    fn animation_id(self) -> PetActionAnimationId {
        match self {
            Self::Thinking => PetActionAnimationId::Waiting,
            Self::ToolRunning => PetActionAnimationId::Running,
            Self::Reviewing => PetActionAnimationId::Review,
            Self::Success => PetActionAnimationId::Jumping,
            Self::Failure => PetActionAnimationId::Failed,
            Self::Attention => PetActionAnimationId::Waving,
        }
    }

    fn default_bubble(self) -> &'static str {
        match self {
            Self::Thinking => "Thinking...",
            Self::ToolRunning => "Running a tool...",
            Self::Reviewing => "Reviewing changes...",
            Self::Success => "Done!",
            Self::Failure => "Something needs attention.",
            Self::Attention => "Need your attention.",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetManifest {
    pub id: String,
    pub display_name: String,
    pub description: String,
    pub spritesheet_path: String,
    #[serde(default)]
    pub source_name: Option<String>,
    #[serde(default)]
    pub source_url: Option<String>,
    #[serde(default)]
    pub imported: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetCatalogItem {
    pub id: String,
    pub display_name: String,
    pub description: String,
    pub spritesheet_path: String,
    pub spritesheet_url: String,
    pub source_name: Option<String>,
    pub source_url: Option<String>,
    pub imported: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct RuntimeApiConfig {
    pub listen_address: String,
    pub port: u16,
}

impl Default for RuntimeApiConfig {
    fn default() -> Self {
        Self {
            listen_address: DEFAULT_LISTEN_ADDRESS.to_string(),
            port: DEFAULT_PORT,
        }
    }
}

fn bundled_pet_manifests() -> Vec<PetManifest> {
    vec![PetManifest {
        id: DEFAULT_PET_ID.to_string(),
        display_name: "Nia".to_string(),
        description:
            "A larger elf-eared blonde Nia pet with independently generated action animations."
                .to_string(),
        spritesheet_path: "spritesheet.webp".to_string(),
        source_name: None,
        source_url: None,
        imported: false,
    }]
}

fn url_host_for_listen_address(listen_address: &str) -> String {
    match listen_address {
        "0.0.0.0" => "127.0.0.1".to_string(),
        "::" => "[::1]".to_string(),
        value if value.contains(':') && !value.starts_with('[') => format!("[{value}]"),
        value => value.to_string(),
    }
}

fn api_base_url(config: &RuntimeApiConfig) -> String {
    format!(
        "http://{}:{}",
        url_host_for_listen_address(&config.listen_address),
        config.port
    )
}

fn catalog_item(pet: &PetManifest, config: &RuntimeApiConfig) -> PetCatalogItem {
    let spritesheet_url = if pet.imported {
        format!("{}/api/pets/{}/spritesheet", api_base_url(config), pet.id)
    } else {
        format!("/pets/{}/{}", pet.id, pet.spritesheet_path)
    };

    PetCatalogItem {
        id: pet.id.clone(),
        display_name: pet.display_name.clone(),
        description: pet.description.clone(),
        spritesheet_path: pet.spritesheet_path.clone(),
        spritesheet_url,
        source_name: pet.source_name.clone(),
        source_url: pet.source_url.clone(),
        imported: pet.imported,
    }
}

fn path_to_display(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn user_home_dir() -> Result<PathBuf, String> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .ok_or_else(|| "failed to resolve user home directory".to_string())
}

fn codex_pet_storage_dir() -> Result<PathBuf, String> {
    Ok(user_home_dir()?.join(".codex").join("pets"))
}

fn app_data_pet_storage_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("pets")
}

fn resolve_pet_storage_dir(app_data_dir: &Path, settings: &PetSettings) -> Result<PathBuf, String> {
    match settings.pet_storage_preset {
        PetStoragePreset::AppData => Ok(app_data_pet_storage_dir(app_data_dir)),
        PetStoragePreset::CodexCustom => codex_pet_storage_dir(),
        PetStoragePreset::Custom => settings
            .custom_pet_storage_dir
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .ok_or_else(|| "custom pet storage directory is required".to_string()),
    }
}

fn normalize_pet_settings(mut settings: PetSettings) -> PetSettings {
    settings.scale = settings.scale.clamp(0.5, 2.0);
    settings.event_bubble_ttl_ms = settings.event_bubble_ttl_ms.clamp(500, 60_000);
    settings.bubble_font_size_px = settings.bubble_font_size_px.clamp(10, 28);
    settings.bubble_max_width_px = settings.bubble_max_width_px.clamp(180, 520);
    settings.walking_speed_px = settings.walking_speed_px.clamp(1.0, 32.0);
    settings.idle_threshold_ms = settings.idle_threshold_ms.max(5_000);
    settings.idle_action_frequency_ms = settings.idle_action_frequency_ms.max(5_000);
    settings.bubble_font_family = settings
        .bubble_font_family
        .trim()
        .chars()
        .take(80)
        .collect::<String>();
    if settings.bubble_font_family.is_empty() {
        settings.bubble_font_family = PetSettings::default().bubble_font_family;
    }
    settings.custom_pet_storage_dir = settings.custom_pet_storage_dir.and_then(|value| {
        let trimmed = value.trim().chars().take(512).collect::<String>();
        (!trimmed.is_empty()).then_some(trimmed)
    });
    settings
}

fn default_auto_update_checks() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct PetSettings {
    pub language: PetLanguage,
    pub scale: f64,
    pub reduced_motion: bool,
    #[serde(default = "default_auto_update_checks")]
    pub auto_update_checks: bool,
    pub autonomous_walking: bool,
    pub hover_pause: bool,
    pub active_pet_id: String,
    pub click_action_mode: ClickActionMode,
    pub click_action: PetActionAnimationId,
    pub click_action_pool: Vec<PetActionAnimationId>,
    pub event_reactions: bool,
    pub event_bubbles: bool,
    pub event_bubble_ttl_ms: u64,
    pub bubble_style: BubbleStyle,
    pub bubble_font_family: String,
    pub bubble_font_size_px: u16,
    pub bubble_max_width_px: u16,
    pub idle_self_play: bool,
    pub idle_threshold_ms: u64,
    pub idle_action_frequency_ms: u64,
    pub idle_action: IdleActionId,
    pub walking_speed_px: f64,
    pub pet_storage_preset: PetStoragePreset,
    pub custom_pet_storage_dir: Option<String>,
}

impl Default for PetSettings {
    fn default() -> Self {
        Self {
            language: PetLanguage::default(),
            scale: 1.0,
            reduced_motion: false,
            auto_update_checks: true,
            autonomous_walking: false,
            hover_pause: true,
            active_pet_id: DEFAULT_PET_ID.to_string(),
            click_action_mode: ClickActionMode::Random,
            click_action: PetActionAnimationId::Waving,
            click_action_pool: vec![
                PetActionAnimationId::Waving,
                PetActionAnimationId::Jumping,
                PetActionAnimationId::Waiting,
                PetActionAnimationId::Running,
                PetActionAnimationId::Review,
            ],
            event_reactions: true,
            event_bubbles: true,
            event_bubble_ttl_ms: 4000,
            bubble_style: BubbleStyle::Soft,
            bubble_font_family: "Aptos Display".to_string(),
            bubble_font_size_px: 14,
            bubble_max_width_px: 292,
            idle_self_play: true,
            idle_threshold_ms: 45_000,
            idle_action_frequency_ms: 30_000,
            idle_action: IdleActionId::Random,
            walking_speed_px: 8.0,
            pet_storage_preset: PetStoragePreset::CodexCustom,
            custom_pet_storage_dir: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionPayload {
    pub animation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SayPayload {
    pub text: String,
    pub ttl_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionEventPayload {
    #[serde(rename = "type")]
    pub event_type: CompanionEventType,
    pub message: Option<String>,
    pub ttl_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalImportPayload {
    pub source: String,
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub force: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebsiteImportPayload {
    pub url: String,
    #[serde(default)]
    pub force: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentCompanionEvent {
    pub event_type: CompanionEventType,
    pub message: Option<String>,
    pub animation_id: PetActionAnimationId,
    pub bubble_text: Option<String>,
    pub received_at_ms: u128,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetStorageSnapshot {
    pub preset: PetStoragePreset,
    pub custom_dir: Option<String>,
    pub active_dir: String,
    pub app_data_dir: String,
    pub codex_dir: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSnapshot {
    pub listen_address: String,
    pub port: u16,
    pub configured_listen_address: String,
    pub configured_port: u16,
    pub api_base_url: String,
    pub api_listening: bool,
    pub api_error: Option<String>,
    pub api_restart_required: bool,
    pub pet_visible: bool,
    pub settings: PetSettings,
    pub pet_storage: PetStorageSnapshot,
    pub active_pet: PetCatalogItem,
    pub pet_catalog: Vec<PetCatalogItem>,
    pub last_action: Option<String>,
    pub bubble_text: Option<String>,
    pub recent_events: Vec<RecentCompanionEvent>,
    pub started_at_ms: u128,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundledSkill {
    pub id: String,
    pub display_name: String,
    pub description: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallBundledSkillsPayload {
    pub skill_ids: Vec<String>,
    pub target_ids: Vec<String>,
    #[serde(default)]
    pub force: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInstallResult {
    pub skill_id: String,
    pub target_id: String,
    pub target_label: String,
    pub target_path: Option<String>,
    pub status: String,
    pub message: String,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PetStorageFolderKind {
    Active,
    AppData,
    CodexCustom,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
struct GithubRelease {
    tag_name: String,
    html_url: String,
    name: Option<String>,
    published_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub current_version: String,
    pub latest_version: Option<String>,
    pub release_name: Option<String>,
    pub release_url: String,
    pub published_at: Option<String>,
    pub update_available: bool,
}

#[derive(Debug)]
struct RuntimeState {
    active_api_config: RuntimeApiConfig,
    configured_api_config: RuntimeApiConfig,
    runtime_config_path: Option<PathBuf>,
    settings_config_path: Option<PathBuf>,
    app_data_dir: Option<PathBuf>,
    api_listening: bool,
    api_error: Option<String>,
    pet_visible: bool,
    settings: PetSettings,
    pet_catalog: Vec<PetManifest>,
    imported_pets_dir: Option<PathBuf>,
    last_action: Option<String>,
    bubble_text: Option<String>,
    bubble_expires_at_ms: Option<u128>,
    recent_events: Vec<RecentCompanionEvent>,
    started_at_ms: u128,
}

#[derive(Clone)]
pub struct AppState {
    inner: Arc<Mutex<RuntimeState>>,
}

fn pet_storage_snapshot_from_state(state: &RuntimeState) -> PetStorageSnapshot {
    let fallback_app_data = PathBuf::from(".");
    let app_data_dir = state.app_data_dir.as_ref().unwrap_or(&fallback_app_data);
    let app_data_pets = app_data_pet_storage_dir(app_data_dir);
    let codex_dir = codex_pet_storage_dir().unwrap_or_else(|_| app_data_pets.clone());
    let active_dir = state
        .imported_pets_dir
        .clone()
        .unwrap_or_else(|| codex_dir.clone());

    PetStorageSnapshot {
        preset: state.settings.pet_storage_preset,
        custom_dir: state.settings.custom_pet_storage_dir.clone(),
        active_dir: path_to_display(&active_dir),
        app_data_dir: path_to_display(&app_data_pets),
        codex_dir: path_to_display(&codex_dir),
    }
}

impl AppState {
    fn new(api_config: RuntimeApiConfig) -> Self {
        Self {
            inner: Arc::new(Mutex::new(RuntimeState {
                active_api_config: api_config.clone(),
                configured_api_config: api_config,
                runtime_config_path: None,
                settings_config_path: None,
                app_data_dir: None,
                api_listening: false,
                api_error: None,
                pet_visible: true,
                settings: PetSettings::default(),
                pet_catalog: bundled_pet_manifests(),
                imported_pets_dir: None,
                last_action: None,
                bubble_text: None,
                bubble_expires_at_ms: None,
                recent_events: Vec::new(),
                started_at_ms: now_ms(),
            })),
        }
    }

    pub fn port(&self) -> u16 {
        self.inner
            .lock()
            .expect("runtime state poisoned")
            .active_api_config
            .port
    }

    pub fn api_bind_config(&self) -> RuntimeApiConfig {
        self.inner
            .lock()
            .expect("runtime state poisoned")
            .active_api_config
            .clone()
    }

    pub fn snapshot(&self) -> RuntimeSnapshot {
        let mut state = self.inner.lock().expect("runtime state poisoned");
        if state
            .bubble_expires_at_ms
            .is_some_and(|expires_at_ms| now_ms() >= expires_at_ms)
        {
            state.bubble_text = None;
            state.bubble_expires_at_ms = None;
        }
        let active_api_config = state.active_api_config.clone();
        let pet_catalog = state
            .pet_catalog
            .iter()
            .map(|pet| catalog_item(pet, &active_api_config))
            .collect::<Vec<_>>();
        let active_pet = pet_catalog
            .iter()
            .find(|pet| pet.id == state.settings.active_pet_id)
            .cloned()
            .or_else(|| pet_catalog.first().cloned())
            .unwrap_or_else(|| catalog_item(&bundled_pet_manifests()[0], &active_api_config));
        let pet_storage = pet_storage_snapshot_from_state(&state);

        RuntimeSnapshot {
            listen_address: active_api_config.listen_address.clone(),
            port: active_api_config.port,
            configured_listen_address: state.configured_api_config.listen_address.clone(),
            configured_port: state.configured_api_config.port,
            api_base_url: api_base_url(&active_api_config),
            api_listening: state.api_listening,
            api_error: state.api_error.clone(),
            api_restart_required: state.configured_api_config != active_api_config,
            pet_visible: state.pet_visible,
            settings: state.settings.clone(),
            pet_storage,
            active_pet,
            pet_catalog,
            last_action: state.last_action.clone(),
            bubble_text: state.bubble_text.clone(),
            recent_events: state.recent_events.clone(),
            started_at_ms: state.started_at_ms,
        }
    }

    pub fn mark_api_listening(&self, listen_address: String, port: u16) {
        let mut state = self.inner.lock().expect("runtime state poisoned");
        state.active_api_config = RuntimeApiConfig {
            listen_address,
            port,
        };
        state.api_listening = true;
        state.api_error = None;
    }

    pub fn mark_api_error(&self, error: String) {
        let mut state = self.inner.lock().expect("runtime state poisoned");
        state.api_listening = false;
        state.api_error = Some(error);
    }

    pub fn set_pet_visible(&self, visible: bool) {
        let mut state = self.inner.lock().expect("runtime state poisoned");
        state.pet_visible = visible;
    }

    pub fn pet_visible(&self) -> bool {
        self.inner
            .lock()
            .expect("runtime state poisoned")
            .pet_visible
    }

    fn configure_app_paths(
        &self,
        app_data_dir: PathBuf,
        settings_config_path: Option<PathBuf>,
    ) -> Result<(), String> {
        let next_imported_dir = {
            let state = self.inner.lock().expect("runtime state poisoned");
            resolve_pet_storage_dir(&app_data_dir, &state.settings)?
        };
        let mut state = self.inner.lock().expect("runtime state poisoned");
        state.app_data_dir = Some(app_data_dir);
        state.settings_config_path = settings_config_path;
        state.imported_pets_dir = Some(next_imported_dir);
        Ok(())
    }

    fn configure_settings(&self, settings: PetSettings) -> Result<(), String> {
        let next_settings = normalize_pet_settings(settings);
        let next_imported_dir = {
            let state = self.inner.lock().expect("runtime state poisoned");
            state
                .app_data_dir
                .as_deref()
                .map(|app_data_dir| resolve_pet_storage_dir(app_data_dir, &next_settings))
                .transpose()?
        };
        let mut state = self.inner.lock().expect("runtime state poisoned");
        state.settings = next_settings;
        if let Some(imported_dir) = next_imported_dir {
            state.imported_pets_dir = Some(imported_dir);
        }
        Ok(())
    }

    fn configure_runtime_api(
        &self,
        config: RuntimeApiConfig,
        runtime_config_path: Option<PathBuf>,
    ) {
        let mut state = self.inner.lock().expect("runtime state poisoned");
        state.active_api_config = config.clone();
        state.configured_api_config = config;
        state.runtime_config_path = runtime_config_path;
    }

    fn update_runtime_api_config(
        &self,
        config: RuntimeApiConfig,
    ) -> Result<RuntimeApiConfig, String> {
        let normalized = normalize_api_config(config)?;
        let config_path = {
            let mut state = self.inner.lock().expect("runtime state poisoned");
            state.configured_api_config = normalized.clone();
            state.runtime_config_path.clone()
        };

        if let Some(path) = config_path {
            save_runtime_api_config(&path, &normalized)?;
        }

        Ok(normalized)
    }

    pub fn record_action(&self, animation_id: String) {
        let mut state = self.inner.lock().expect("runtime state poisoned");
        state.last_action = Some(animation_id);
    }

    pub fn record_say(&self, text: String, ttl_ms: Option<u64>) {
        let mut state = self.inner.lock().expect("runtime state poisoned");
        state.bubble_text = if text.trim().is_empty() {
            None
        } else {
            Some(text)
        };
        state.bubble_expires_at_ms = state
            .bubble_text
            .as_ref()
            .map(|_| now_ms() + u128::from(ttl_ms.unwrap_or(DEFAULT_BUBBLE_TTL_MS).max(500)));
    }

    pub fn record_companion_event(
        &self,
        event: RecentCompanionEvent,
        record_action: bool,
        visible_bubble_text: Option<String>,
        bubble_ttl_ms: Option<u64>,
    ) {
        let mut state = self.inner.lock().expect("runtime state poisoned");
        if record_action {
            state.last_action = Some(event.animation_id.as_str().to_string());
        }
        if let Some(text) = visible_bubble_text.filter(|text| !text.trim().is_empty()) {
            state.bubble_text = Some(text);
            state.bubble_expires_at_ms = Some(
                now_ms() + u128::from(bubble_ttl_ms.unwrap_or(DEFAULT_BUBBLE_TTL_MS).max(500)),
            );
        }
        state.recent_events.insert(0, event);
        state.recent_events.truncate(RECENT_EVENT_LIMIT);
    }

    pub fn settings(&self) -> PetSettings {
        self.inner
            .lock()
            .expect("runtime state poisoned")
            .settings
            .clone()
    }

    fn update_settings(&self, settings: PetSettings) -> Result<PetSettings, String> {
        let mut next_settings = normalize_pet_settings(settings);
        let (config_path, app_data_dir) = {
            let state = self.inner.lock().expect("runtime state poisoned");
            if !state
                .pet_catalog
                .iter()
                .any(|pet| pet.id == next_settings.active_pet_id)
            {
                next_settings.active_pet_id = state
                    .pet_catalog
                    .first()
                    .map(|pet| pet.id.clone())
                    .unwrap_or_else(|| DEFAULT_PET_ID.to_string());
            }
            (
                state.settings_config_path.clone(),
                state.app_data_dir.clone(),
            )
        };
        let next_imported_dir = app_data_dir
            .as_deref()
            .map(|dir| resolve_pet_storage_dir(dir, &next_settings))
            .transpose()?;

        {
            let mut state = self.inner.lock().expect("runtime state poisoned");
            state.settings = next_settings.clone();
            if let Some(imported_dir) = next_imported_dir {
                state.imported_pets_dir = Some(imported_dir);
            }
        }

        if let Some(path) = config_path {
            save_pet_settings(&path, &next_settings)?;
        }

        Ok(next_settings)
    }

    fn persist_settings(&self) -> Result<(), String> {
        let (settings, path) = {
            let state = self.inner.lock().expect("runtime state poisoned");
            (state.settings.clone(), state.settings_config_path.clone())
        };
        if let Some(path) = path {
            save_pet_settings(&path, &settings)?;
        }
        Ok(())
    }

    fn refresh_imported_pets(&self) -> Result<(), String> {
        let imported_dir = {
            self.inner
                .lock()
                .expect("runtime state poisoned")
                .imported_pets_dir
                .clone()
        };
        let mut catalog = bundled_pet_manifests();

        if let Some(dir) = imported_dir {
            fs::create_dir_all(&dir)
                .map_err(|error| format!("failed to create imported pets dir: {error}"))?;
            let entries = fs::read_dir(&dir)
                .map_err(|error| format!("failed to read imported pets dir: {error}"))?;
            let mut imported = Vec::new();
            for entry in entries.flatten() {
                let pet_dir = entry.path();
                if !pet_dir.is_dir() {
                    continue;
                }
                let manifest_path = pet_dir.join("pet.json");
                let Ok(raw) = fs::read_to_string(&manifest_path) else {
                    continue;
                };
                let Ok(mut manifest) = serde_json::from_str::<PetManifest>(&raw) else {
                    continue;
                };
                if !is_valid_pet_id(&manifest.id)
                    || manifest.spritesheet_path.trim().is_empty()
                    || manifest.display_name.trim().is_empty()
                {
                    continue;
                }
                manifest.imported = true;
                manifest.spritesheet_path = "spritesheet.webp".to_string();
                if pet_dir.join(&manifest.spritesheet_path).is_file() {
                    imported.push(manifest);
                }
            }
            imported.sort_by(|left, right| left.display_name.cmp(&right.display_name));
            catalog.extend(imported);
        }

        let mut state = self.inner.lock().expect("runtime state poisoned");
        state.pet_catalog = catalog;
        if !state
            .pet_catalog
            .iter()
            .any(|pet| pet.id == state.settings.active_pet_id)
        {
            state.settings.active_pet_id = DEFAULT_PET_ID.to_string();
        }
        Ok(())
    }

    pub(crate) fn imported_pet_spritesheet_path(&self, id: &str) -> Option<PathBuf> {
        let state = self.inner.lock().expect("runtime state poisoned");
        let imported_dir = state.imported_pets_dir.as_ref()?;
        let pet = state
            .pet_catalog
            .iter()
            .find(|pet| pet.imported && pet.id == id)?;
        let path = imported_dir.join(&pet.id).join(&pet.spritesheet_path);
        path.is_file().then_some(path)
    }

    fn imported_pets_dir(&self) -> Option<PathBuf> {
        self.inner
            .lock()
            .expect("runtime state poisoned")
            .imported_pets_dir
            .clone()
    }

    fn has_bundled_pet_id(&self, id: &str) -> bool {
        bundled_pet_manifests().iter().any(|pet| pet.id == id)
    }
}

#[derive(Debug)]
struct ResolvedPetSource {
    id: String,
    display_name: String,
    description: String,
    spritesheet_url: url::Url,
    source_name: String,
    source_url: String,
}

#[derive(Debug)]
struct ResolvedLocalPetSource {
    id: String,
    display_name: String,
    description: String,
    spritesheet_path: PathBuf,
    source_name: Option<String>,
    source_url: Option<String>,
    force: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalPetManifest {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    display_name: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    spritesheet_path: Option<String>,
    #[serde(default)]
    source_name: Option<String>,
    #[serde(default)]
    source_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PetdexManifest {
    pets: Vec<PetdexPet>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PetdexPet {
    slug: String,
    display_name: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    page_url: Option<String>,
    spritesheet_url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexPetsDetail {
    pet: CodexPetsPet,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexPetsPet {
    id: String,
    display_name: String,
    description: String,
    spritesheet_url: String,
}

fn is_valid_pet_id(value: &str) -> bool {
    let len = value.len();
    (2..=72).contains(&len)
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        && !value.starts_with('-')
        && !value.ends_with('-')
}

fn sanitize_pet_id(value: &str) -> String {
    let mut output = String::new();
    let mut previous_dash = false;
    for character in value.chars().flat_map(char::to_lowercase) {
        if character.is_ascii_alphanumeric() {
            output.push(character);
            previous_dash = false;
        } else if !previous_dash && !output.is_empty() {
            output.push('-');
            previous_dash = true;
        }
        if output.len() >= 64 {
            break;
        }
    }
    let trimmed = output.trim_matches('-').to_string();
    if trimmed.len() >= 2 {
        trimmed
    } else {
        "imported-pet".to_string()
    }
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    value.trim().chars().take(max_chars).collect()
}

fn option_trimmed(value: &Option<String>) -> Option<String> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn parse_safe_import_url(raw_url: &str) -> Result<url::Url, String> {
    let trimmed = raw_url.trim();
    if trimmed.is_empty() {
        return Err("Enter a pet page URL first.".to_string());
    }

    let url = url::Url::parse(trimmed).map_err(|_| "Enter a valid absolute URL.".to_string())?;
    if url.scheme() != "https" {
        return Err("Only HTTPS pet pages are supported for website import.".to_string());
    }

    let host = url
        .host_str()
        .ok_or_else(|| "URL must include a host.".to_string())?;
    if is_blocked_host(host) {
        return Err("Local, private, and special network hosts are not allowed.".to_string());
    }

    Ok(url)
}

fn is_blocked_host(host: &str) -> bool {
    let normalized = host.trim_matches(['[', ']']).to_ascii_lowercase();
    if normalized == "localhost" || normalized.ends_with(".localhost") {
        return true;
    }
    if let Ok(ip) = normalized.parse::<IpAddr>() {
        return is_blocked_ip(ip);
    }
    match (normalized.as_str(), 443).to_socket_addrs() {
        Ok(addrs) => addrs.map(|addr| addr.ip()).any(is_blocked_ip),
        Err(_) => false,
    }
}

fn is_blocked_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || ip.is_multicast()
                || ip.is_unspecified()
        }
        IpAddr::V6(ip) => {
            ip.is_loopback()
                || ip.is_multicast()
                || ip.is_unspecified()
                || ip.is_unique_local()
                || ip.is_unicast_link_local()
        }
    }
}

async fn fetch_json<T>(
    client: &reqwest::Client,
    url: url::Url,
    max_bytes: usize,
) -> Result<T, String>
where
    T: for<'de> Deserialize<'de>,
{
    let bytes = fetch_bytes(client, url, max_bytes).await?;
    serde_json::from_slice::<T>(&bytes).map_err(|error| format!("invalid JSON response: {error}"))
}

async fn fetch_text(
    client: &reqwest::Client,
    url: url::Url,
    max_bytes: usize,
) -> Result<String, String> {
    let bytes = fetch_bytes(client, url, max_bytes).await?;
    String::from_utf8(bytes).map_err(|_| "response was not valid UTF-8 text".to_string())
}

async fn fetch_bytes(
    client: &reqwest::Client,
    url: url::Url,
    max_bytes: usize,
) -> Result<Vec<u8>, String> {
    let response = client
        .get(url.clone())
        .send()
        .await
        .map_err(|error| format!("failed to fetch {url}: {error}"))?;
    let final_url = response.url();
    if final_url.scheme() != "https"
        || final_url
            .host_str()
            .is_none_or(|host| is_blocked_host(host))
    {
        return Err("remote URL redirected to an unsafe location".to_string());
    }
    if !response.status().is_success() {
        return Err(format!("failed to fetch {url}: HTTP {}", response.status()));
    }
    if response
        .content_length()
        .is_some_and(|length| length > max_bytes as u64)
    {
        return Err(format!(
            "remote file is larger than {} MB",
            max_bytes / 1024 / 1024
        ));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("failed to read {url}: {error}"))?;
    if bytes.len() > max_bytes {
        return Err(format!(
            "remote file is larger than {} MB",
            max_bytes / 1024 / 1024
        ));
    }
    Ok(bytes.to_vec())
}

async fn resolve_pet_source(
    client: &reqwest::Client,
    url: &url::Url,
) -> Result<ResolvedPetSource, String> {
    match url.host_str().unwrap_or_default() {
        "petdex.crafter.run" => resolve_petdex_source(client, url).await,
        "codex-pets.net" | "www.codex-pets.net" => resolve_codex_pets_source(client, url).await,
        _ => resolve_generic_pet_page(client, url).await,
    }
}

async fn resolve_petdex_source(
    client: &reqwest::Client,
    source_url: &url::Url,
) -> Result<ResolvedPetSource, String> {
    let slug = path_segment_after(source_url, "pets")
        .ok_or_else(|| "Open a Petdex pet detail page, for example /pets/boba.".to_string())?;
    let manifest = fetch_json::<PetdexManifest>(
        client,
        url::Url::parse("https://petdex.crafter.run/api/manifest").expect("static URL is valid"),
        MAX_JSON_BYTES,
    )
    .await?;
    let pet = manifest
        .pets
        .into_iter()
        .find(|pet| pet.slug == slug)
        .ok_or_else(|| format!("Petdex pet '{slug}' was not found in the public manifest."))?;
    let spritesheet_url = parse_safe_import_url(&pet.spritesheet_url)?;
    let description = match option_trimmed(&pet.description) {
        Some(description) => description,
        None => fetch_page_description(client, source_url)
            .await
            .unwrap_or_else(|| "Imported from Petdex.".to_string()),
    };
    let source_url =
        option_trimmed(&pet.page_url).unwrap_or_else(|| source_url.as_str().to_string());

    Ok(ResolvedPetSource {
        id: sanitize_pet_id(&pet.slug),
        display_name: truncate_chars(&pet.display_name, 96),
        description: truncate_chars(&description, 280),
        spritesheet_url,
        source_name: "Petdex".to_string(),
        source_url,
    })
}

async fn resolve_codex_pets_source(
    client: &reqwest::Client,
    source_url: &url::Url,
) -> Result<ResolvedPetSource, String> {
    let id = extract_codex_pets_id(source_url).ok_or_else(|| {
        "Open a Codex Pets share/detail URL, for example /share/<pet-id> or #/pets/<pet-id>."
            .to_string()
    })?;
    let detail_url = url::Url::parse(&format!(
        "https://ihzwckyzfcuktrljwpha.supabase.co/functions/v1/petshare/api/pets/{}",
        id
    ))
    .expect("static URL is valid");
    let detail = fetch_json::<CodexPetsDetail>(client, detail_url, MAX_JSON_BYTES).await?;
    let spritesheet_url = parse_safe_import_url(&detail.pet.spritesheet_url)?;

    Ok(ResolvedPetSource {
        id: sanitize_pet_id(&detail.pet.id),
        display_name: truncate_chars(&detail.pet.display_name, 96),
        description: truncate_chars(&detail.pet.description, 280),
        spritesheet_url,
        source_name: "Codex Pets".to_string(),
        source_url: format!("https://codex-pets.net/share/{}", detail.pet.id),
    })
}

async fn fetch_page_description(client: &reqwest::Client, source_url: &url::Url) -> Option<String> {
    let html = fetch_text(client, source_url.clone(), MAX_HTML_BYTES)
        .await
        .ok()?;
    extract_page_description(&html)
}

async fn resolve_generic_pet_page(
    client: &reqwest::Client,
    source_url: &url::Url,
) -> Result<ResolvedPetSource, String> {
    let html = fetch_text(client, source_url.clone(), MAX_HTML_BYTES).await?;
    let display_name = extract_page_display_name(&html)
        .map(|value| clean_title(&value))
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "Imported Pet".to_string());
    let description = extract_page_description(&html)
        .unwrap_or_else(|| "Imported Codex-compatible pet.".to_string());
    let spritesheet_url = extract_page_spritesheet_url(&html, source_url).ok_or_else(|| {
        "Could not find a Codex-compatible spritesheet.webp on this page.".to_string()
    })?;
    let id_hint = source_url
        .path_segments()
        .and_then(|segments| segments.filter(|segment| !segment.is_empty()).last())
        .unwrap_or(display_name.as_str());

    Ok(ResolvedPetSource {
        id: sanitize_pet_id(id_hint),
        display_name: truncate_chars(&display_name, 96),
        description: truncate_chars(&description, 280),
        spritesheet_url,
        source_name: source_url
            .host_str()
            .unwrap_or("Website")
            .trim_start_matches("www.")
            .to_string(),
        source_url: source_url.as_str().to_string(),
    })
}

fn extract_page_display_name(html: &str) -> Option<String> {
    let json_ld = extract_json_ld_values(html);
    json_ld
        .iter()
        .find_map(|value| find_json_string(value, "name"))
        .or_else(|| extract_meta_content(html, "og:title"))
        .or_else(|| extract_title(html))
}

fn extract_page_description(html: &str) -> Option<String> {
    let json_ld = extract_json_ld_values(html);
    json_ld
        .iter()
        .find_map(|value| find_json_string(value, "description"))
        .or_else(|| extract_meta_content(html, "description"))
}

fn extract_page_spritesheet_url(html: &str, base_url: &url::Url) -> Option<url::Url> {
    let json_ld = extract_json_ld_values(html);
    json_ld
        .iter()
        .filter_map(find_json_webp)
        .find(|candidate| is_likely_spritesheet(candidate))
        .and_then(|candidate| base_url.join(&candidate).ok())
        .or_else(|| extract_webp_url(html, base_url))
}

fn path_segment_after(url: &url::Url, prefix: &str) -> Option<String> {
    let mut segments = url.path_segments()?;
    while let Some(segment) = segments.next() {
        if segment == prefix {
            return segments.next().map(ToString::to_string);
        }
    }
    None
}

fn extract_codex_pets_id(url: &url::Url) -> Option<String> {
    if let Some(id) = path_segment_after(url, "share") {
        return Some(id);
    }
    let fragment = url.fragment()?.trim_start_matches('/');
    let id = fragment.strip_prefix("pets/")?;
    Some(id.split('?').next().unwrap_or(id).to_string())
}

fn extract_json_ld_values(html: &str) -> Vec<serde_json::Value> {
    let mut values = Vec::new();
    let mut offset = 0;
    let lower = html.to_ascii_lowercase();
    while let Some(script_start) = lower[offset..].find("<script") {
        let script_start = offset + script_start;
        let Some(open_end) = lower[script_start..].find('>') else {
            break;
        };
        let open_end = script_start + open_end;
        let open_tag = &lower[script_start..=open_end];
        let Some(close_start) = lower[open_end + 1..].find("</script>") else {
            break;
        };
        let close_start = open_end + 1 + close_start;
        if open_tag.contains("application/ld+json") {
            let raw = html[open_end + 1..close_start].trim();
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) {
                values.push(value);
            }
        }
        offset = close_start + "</script>".len();
    }
    values
}

fn find_json_string(value: &serde_json::Value, key: &str) -> Option<String> {
    match value {
        serde_json::Value::Object(map) => {
            if let Some(serde_json::Value::String(value)) = map.get(key) {
                return Some(value.clone());
            }
            map.values().find_map(|value| find_json_string(value, key))
        }
        serde_json::Value::Array(values) => {
            values.iter().find_map(|value| find_json_string(value, key))
        }
        _ => None,
    }
}

fn find_json_webp(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(value) => {
            if value.to_ascii_lowercase().contains(".webp") {
                Some(value.clone())
            } else {
                None
            }
        }
        serde_json::Value::Object(map) => map.values().find_map(find_json_webp),
        serde_json::Value::Array(values) => values.iter().find_map(find_json_webp),
        _ => None,
    }
}

fn extract_meta_content(html: &str, name_or_property: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let needle = name_or_property.to_ascii_lowercase();
    let mut offset = 0;
    while let Some(meta_start) = lower[offset..].find("<meta") {
        let meta_start = offset + meta_start;
        let Some(meta_end) = lower[meta_start..].find('>') else {
            break;
        };
        let meta_end = meta_start + meta_end;
        let tag = &html[meta_start..=meta_end];
        let lower_tag = &lower[meta_start..=meta_end];
        if lower_tag.contains(&format!("name=\"{needle}\""))
            || lower_tag.contains(&format!("property=\"{needle}\""))
        {
            if let Some(content) = extract_attr(tag, "content") {
                return Some(html_decode_minimal(&content));
            }
        }
        offset = meta_end + 1;
    }
    None
}

fn extract_attr(tag: &str, attr: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let needle = format!("{attr}=");
    let start = lower.find(&needle)? + needle.len();
    let quote = tag[start..].chars().next()?;
    if quote != '"' && quote != '\'' {
        return None;
    }
    let value_start = start + quote.len_utf8();
    let value_end = tag[value_start..].find(quote)? + value_start;
    Some(tag[value_start..value_end].to_string())
}

fn extract_title(html: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let start = lower.find("<title>")? + "<title>".len();
    let end = lower[start..].find("</title>")? + start;
    Some(html_decode_minimal(&html[start..end]))
}

fn clean_title(value: &str) -> String {
    value
        .split(" - ")
        .next()
        .unwrap_or(value)
        .split(" | ")
        .next()
        .unwrap_or(value)
        .trim()
        .to_string()
}

fn html_decode_minimal(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#x27;", "'")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}

fn extract_webp_url(html: &str, base_url: &url::Url) -> Option<url::Url> {
    let mut candidates = html
        .split(|character: char| {
            character.is_whitespace()
                || matches!(character, '"' | '\'' | '(' | ')' | '<' | '>' | ';' | ',')
        })
        .filter(|part| part.to_ascii_lowercase().contains(".webp"))
        .filter(|part| is_likely_spritesheet(part))
        .filter_map(|part| base_url.join(part.trim()).ok())
        .collect::<Vec<_>>();
    candidates.sort_by_key(|url| {
        let value = url.as_str().to_ascii_lowercase();
        if value.contains("spritesheet.webp") {
            0
        } else if value.contains("/sprites/") {
            1
        } else {
            2
        }
    });
    candidates.into_iter().next()
}

fn is_likely_spritesheet(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    lower.contains(".webp")
        && !lower.contains("preview")
        && !lower.contains("share")
        && !lower.contains("social")
        && !lower.contains("icon")
        && !lower.contains("logo")
        && !lower.contains("screenshot")
}

fn validate_webp(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() < 16 {
        return Err("spritesheet is too small to be a valid WebP file".to_string());
    }
    if &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WEBP" {
        return Err("spritesheet must be a WebP image".to_string());
    }
    Ok(())
}

fn validate_webp_file(path: &Path) -> Result<Vec<u8>, String> {
    let metadata =
        fs::metadata(path).map_err(|error| format!("failed to inspect spritesheet: {error}"))?;
    if metadata.len() > MAX_SPRITESHEET_BYTES as u64 {
        return Err(format!(
            "spritesheet is larger than {} MB",
            MAX_SPRITESHEET_BYTES / 1024 / 1024
        ));
    }
    let bytes =
        fs::read(path).map_err(|error| format!("failed to read spritesheet.webp: {error}"))?;
    validate_webp(&bytes)?;
    Ok(bytes)
}

fn read_local_manifest(path: &Path) -> Result<LocalPetManifest, String> {
    let raw =
        fs::read_to_string(path).map_err(|error| format!("failed to read pet.json: {error}"))?;
    serde_json::from_str::<LocalPetManifest>(&raw)
        .map_err(|error| format!("invalid pet.json: {error}"))
}

fn safe_package_path(base: &Path, value: &str) -> Result<PathBuf, String> {
    let raw = Path::new(value);
    if raw.is_absolute()
        || raw
            .components()
            .any(|component| matches!(component, Component::ParentDir))
    {
        return Err("spritesheetPath must stay inside the package directory".to_string());
    }
    let base = fs::canonicalize(base)
        .map_err(|error| format!("failed to resolve package directory: {error}"))?;
    let candidate = fs::canonicalize(base.join(raw))
        .map_err(|error| format!("failed to resolve spritesheetPath: {error}"))?;
    if !candidate.starts_with(&base) {
        return Err("spritesheetPath must stay inside the package directory".to_string());
    }
    Ok(candidate)
}

fn resolve_local_pet_source(payload: LocalImportPayload) -> Result<ResolvedLocalPetSource, String> {
    let source = PathBuf::from(payload.source.trim());
    if payload.source.trim().is_empty() {
        return Err("source path is required".to_string());
    }
    let source = fs::canonicalize(&source)
        .map_err(|error| format!("source path does not exist or cannot be read: {error}"))?;

    let mut manifest: Option<LocalPetManifest> = None;
    let mut package_dir: Option<PathBuf> = None;
    let mut spritesheet_path: Option<PathBuf> = None;

    if source.is_dir() {
        let manifest_path = source.join("pet.json");
        if !manifest_path.is_file() {
            return Err("package directory must contain pet.json".to_string());
        }
        manifest = Some(read_local_manifest(&manifest_path)?);
        package_dir = Some(source.clone());
    } else if source.is_file()
        && source
            .file_name()
            .and_then(|value| value.to_str())
            .is_some_and(|name| name.eq_ignore_ascii_case("pet.json"))
    {
        manifest = Some(read_local_manifest(&source)?);
        package_dir = source.parent().map(Path::to_path_buf);
    } else if source.is_file() {
        spritesheet_path = Some(source.clone());
    } else {
        return Err(
            "source path must be a package directory, pet.json, or spritesheet.webp".to_string(),
        );
    }

    if let Some(manifest) = manifest.as_ref() {
        let dir = package_dir
            .as_deref()
            .ok_or_else(|| "package directory could not be resolved".to_string())?;
        let spritesheet_value = manifest
            .spritesheet_path
            .as_deref()
            .unwrap_or("spritesheet.webp");
        spritesheet_path = Some(safe_package_path(dir, spritesheet_value)?);
    }

    let spritesheet_path =
        spritesheet_path.ok_or_else(|| "spritesheet path could not be resolved".to_string())?;
    if spritesheet_path
        .extension()
        .and_then(|value| value.to_str())
        .is_none_or(|extension| !extension.eq_ignore_ascii_case("webp"))
    {
        return Err("current runtime imports require a .webp spritesheet".to_string());
    }

    let manifest_ref = manifest.as_ref();
    let id_hint = option_trimmed(&payload.id)
        .or_else(|| manifest_ref.and_then(|manifest| option_trimmed(&manifest.id)))
        .or_else(|| {
            package_dir
                .as_ref()
                .and_then(|dir| dir.file_name())
                .and_then(|value| value.to_str())
                .map(ToString::to_string)
        })
        .or_else(|| {
            spritesheet_path
                .file_stem()
                .and_then(|value| value.to_str())
                .map(ToString::to_string)
        })
        .unwrap_or_else(|| "imported-pet".to_string());
    let id = sanitize_pet_id(&id_hint);
    if !is_valid_pet_id(&id) {
        return Err(format!("invalid pet id after sanitization: {id}"));
    }

    let display_name = option_trimmed(&payload.display_name)
        .or_else(|| manifest_ref.and_then(|manifest| option_trimmed(&manifest.display_name)))
        .unwrap_or_else(|| id.replace('-', " "));
    if display_name.trim().is_empty() {
        return Err("displayName is required".to_string());
    }

    Ok(ResolvedLocalPetSource {
        id,
        display_name: truncate_chars(&display_name, 96),
        description: truncate_chars(
            &option_trimmed(&payload.description)
                .or_else(|| manifest_ref.and_then(|manifest| option_trimmed(&manifest.description)))
                .unwrap_or_else(|| "Imported local pet.".to_string()),
            280,
        ),
        spritesheet_path,
        source_name: manifest_ref
            .and_then(|manifest| option_trimmed(&manifest.source_name))
            .or_else(|| Some("Local".to_string())),
        source_url: manifest_ref.and_then(|manifest| option_trimmed(&manifest.source_url)),
        force: payload.force,
    })
}

fn reserve_import_id(state: &AppState, requested_id: &str) -> String {
    if state.has_bundled_pet_id(requested_id) {
        sanitize_pet_id(&format!("imported-{requested_id}"))
    } else {
        requested_id.to_string()
    }
}

async fn install_resolved_pet(
    app: &AppHandle,
    state: &AppState,
    client: &reqwest::Client,
    resolved: ResolvedPetSource,
    force: bool,
) -> Result<RuntimeSnapshot, String> {
    let spritesheet_bytes = fetch_bytes(
        client,
        resolved.spritesheet_url.clone(),
        MAX_SPRITESHEET_BYTES,
    )
    .await?;
    validate_webp(&spritesheet_bytes)?;

    let id = reserve_import_id(state, &sanitize_pet_id(&resolved.id));
    let pets_dir = state
        .imported_pets_dir()
        .ok_or_else(|| "imported pet storage is not configured".to_string())?;
    let pet_dir = pets_dir.join(&id);
    if pet_dir.exists() && !force {
        return Err(format!(
            "imported pet '{id}' already exists; pass force to overwrite pet.json and spritesheet.webp"
        ));
    }
    fs::create_dir_all(&pet_dir)
        .map_err(|error| format!("failed to create imported pet directory: {error}"))?;
    fs::write(pet_dir.join("spritesheet.webp"), &spritesheet_bytes)
        .map_err(|error| format!("failed to write spritesheet.webp: {error}"))?;

    let manifest = PetManifest {
        id: id.clone(),
        display_name: truncate_chars(&resolved.display_name, 96),
        description: truncate_chars(&resolved.description, 280),
        spritesheet_path: "spritesheet.webp".to_string(),
        source_name: Some(resolved.source_name),
        source_url: Some(resolved.source_url),
        imported: true,
    };
    let manifest_json = serde_json::to_string_pretty(&manifest)
        .map_err(|error| format!("failed to serialize pet.json: {error}"))?;
    fs::write(pet_dir.join("pet.json"), manifest_json)
        .map_err(|error| format!("failed to write pet.json: {error}"))?;

    state.refresh_imported_pets()?;
    let mut settings = state.settings();
    settings.active_pet_id = id;
    let settings = state.update_settings(settings)?;
    let _ = app.emit_to("pet", EVENT_PET_SETTINGS, settings);
    emit_status(app, state);
    Ok(state.snapshot())
}

pub(crate) fn import_local_pet(
    app: &AppHandle,
    state: &AppState,
    payload: LocalImportPayload,
) -> Result<RuntimeSnapshot, String> {
    let resolved = resolve_local_pet_source(payload)?;
    let spritesheet_bytes = validate_webp_file(&resolved.spritesheet_path)?;
    let id = reserve_import_id(state, &resolved.id);
    let pets_dir = state
        .imported_pets_dir()
        .ok_or_else(|| "imported pet storage is not configured".to_string())?;
    let pet_dir = pets_dir.join(&id);
    if pet_dir.exists() && !resolved.force {
        return Err(format!(
            "imported pet '{id}' already exists; pass force to overwrite pet.json and spritesheet.webp"
        ));
    }
    fs::create_dir_all(&pet_dir)
        .map_err(|error| format!("failed to create imported pet directory: {error}"))?;
    fs::write(pet_dir.join("spritesheet.webp"), spritesheet_bytes)
        .map_err(|error| format!("failed to write spritesheet.webp: {error}"))?;

    let manifest = PetManifest {
        id: id.clone(),
        display_name: resolved.display_name,
        description: resolved.description,
        spritesheet_path: "spritesheet.webp".to_string(),
        source_name: resolved.source_name,
        source_url: resolved.source_url,
        imported: true,
    };
    let manifest_json = serde_json::to_string_pretty(&manifest)
        .map_err(|error| format!("failed to serialize pet.json: {error}"))?;
    fs::write(pet_dir.join("pet.json"), manifest_json)
        .map_err(|error| format!("failed to write pet.json: {error}"))?;

    state.refresh_imported_pets()?;
    let mut settings = state.settings();
    settings.active_pet_id = id;
    let settings = state.update_settings(settings)?;
    let _ = app.emit_to("pet", EVENT_PET_SETTINGS, settings);
    emit_status(app, state);
    Ok(state.snapshot())
}

pub(crate) async fn import_website_pet(
    app: &AppHandle,
    state: &AppState,
    payload: WebsiteImportPayload,
) -> Result<RuntimeSnapshot, String> {
    let url = parse_safe_import_url(&payload.url)?;
    let client = website_import_client()?;
    let resolved = resolve_pet_source(&client, &url).await?;
    install_resolved_pet(app, state, &client, resolved, payload.force).await
}

fn website_import_client() -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .user_agent("OpenPet/0.1 website-import")
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(25));

    let certificates = native_tls_root_certificates();
    if !certificates.is_empty() {
        builder = builder.tls_certs_only(certificates);
    }

    builder
        .build()
        .map_err(|error| format!("failed to create HTTP client: {error}"))
}

fn native_tls_root_certificates() -> Vec<reqwest::Certificate> {
    rustls_native_certs::load_native_certs()
        .certs
        .into_iter()
        .filter_map(|cert| reqwest::Certificate::from_der(cert.as_ref()).ok())
        .collect()
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

fn normalize_listen_address(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("listenAddress is required".to_string());
    }

    let ip = trimmed
        .parse::<IpAddr>()
        .map_err(|_| "listenAddress must be an IP address".to_string())?;
    let allowed = match ip {
        IpAddr::V4(address) => address.is_loopback() || address.is_unspecified(),
        IpAddr::V6(address) => address.is_loopback() || address.is_unspecified(),
    };

    if !allowed {
        return Err(
            "listenAddress must be loopback or unspecified, such as 127.0.0.1 or 0.0.0.0"
                .to_string(),
        );
    }

    Ok(ip.to_string())
}

fn normalize_api_config(config: RuntimeApiConfig) -> Result<RuntimeApiConfig, String> {
    if config.port == 0 {
        return Err("port must be between 1 and 65535".to_string());
    }

    Ok(RuntimeApiConfig {
        listen_address: normalize_listen_address(&config.listen_address)?,
        port: config.port,
    })
}

fn runtime_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join(RUNTIME_CONFIG_FILE))
        .map_err(|error| format!("failed to resolve runtime config path: {error}"))
}

fn legacy_runtime_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join(LEGACY_RUNTIME_CONFIG_FILE))
        .map_err(|error| format!("failed to resolve legacy runtime config path: {error}"))
}

fn settings_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join(SETTINGS_CONFIG_FILE))
        .map_err(|error| format!("failed to resolve settings config path: {error}"))
}

fn load_runtime_api_config(path: &Path, legacy_path: Option<&Path>) -> RuntimeApiConfig {
    let toml_config = fs::read_to_string(path)
        .ok()
        .and_then(|raw| toml::from_str::<RuntimeApiConfig>(&raw).ok());
    let legacy_config = || {
        legacy_path
            .and_then(|path| fs::read_to_string(path).ok())
            .and_then(|raw| serde_json::from_str::<RuntimeApiConfig>(&raw).ok())
    };

    toml_config
        .or_else(legacy_config)
        .and_then(|config| normalize_api_config(config).ok())
        .unwrap_or_default()
}

fn save_runtime_api_config(path: &Path, config: &RuntimeApiConfig) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create runtime config directory: {error}"))?;
    }
    let raw = toml::to_string_pretty(config)
        .map_err(|error| format!("failed to serialize runtime config: {error}"))?;
    fs::write(path, raw).map_err(|error| format!("failed to save runtime config: {error}"))
}

fn load_pet_settings(path: &Path) -> PetSettings {
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| toml::from_str::<PetSettings>(&raw).ok())
        .map(normalize_pet_settings)
        .unwrap_or_default()
}

fn save_pet_settings(path: &Path, settings: &PetSettings) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create settings config directory: {error}"))?;
    }
    let raw = toml::to_string_pretty(settings)
        .map_err(|error| format!("failed to serialize settings config: {error}"))?;
    fs::write(path, raw).map_err(|error| format!("failed to save settings config: {error}"))
}

fn env_runtime_api_config(mut config: RuntimeApiConfig) -> RuntimeApiConfig {
    if let Ok(value) = std::env::var("CODEX_PET_RUNTIME_HOST") {
        if let Ok(listen_address) = normalize_listen_address(&value) {
            config.listen_address = listen_address;
        }
    }

    if let Ok(value) = std::env::var("CODEX_PET_RUNTIME_PORT") {
        if let Ok(port) = value.parse::<u16>() {
            if port > 0 {
                config.port = port;
            }
        }
    }

    config
}

fn bundled_skill_metadata(id: &str) -> Option<BundledSkill> {
    let (display_name, description) = match id {
        "openpet-cli" => (
            "OpenPet CLI skill",
            "Control OpenPet through the bundled Python CLI for local command-capable agents.",
        ),
        "openpet-mcp" => (
            "OpenPet MCP skill",
            "Configure MCP clients to use the bundled OpenPet stdio bridge.",
        ),
        "openpet-asset" => (
            "OpenPet asset skill",
            "Create, validate, and package Codex-compatible pet spritesheets.",
        ),
        _ => return None,
    };

    Some(BundledSkill {
        id: id.to_string(),
        display_name: display_name.to_string(),
        description: description.to_string(),
    })
}

fn bundled_skills_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let resource_skills = app
        .path()
        .resolve("skills", BaseDirectory::Resource)
        .map_err(|error| format!("failed to resolve bundled skills resource: {error}"))?;
    if resource_skills.is_dir() {
        return Ok(resource_skills);
    }

    let repo_skills = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("skills");
    if cfg!(debug_assertions) && repo_skills.is_dir() {
        return Ok(repo_skills);
    }

    Err(format!(
        "bundled skills directory not found: {}",
        resource_skills.display()
    ))
}

fn skill_source_dir(app: &AppHandle, skill_id: &str) -> Result<PathBuf, String> {
    if !BUNDLED_SKILL_IDS.contains(&skill_id) {
        return Err(format!("unknown bundled skill '{skill_id}'"));
    }
    let path = bundled_skills_dir(app)?.join(skill_id);
    if path.join("SKILL.md").is_file() {
        Ok(path)
    } else {
        Err(format!("bundled skill '{skill_id}' is missing SKILL.md"))
    }
}

#[derive(Debug)]
struct SkillTarget {
    id: &'static str,
    label: &'static str,
    root: Option<PathBuf>,
    unsupported_message: Option<&'static str>,
}

fn skill_target(target_id: &str) -> SkillTarget {
    let home = user_home_dir().ok();
    match target_id {
        "codex" => SkillTarget {
            id: "codex",
            label: "Codex",
            root: home.map(|path| path.join(".codex").join("skills")),
            unsupported_message: None,
        },
        "cursor" => SkillTarget {
            id: "cursor",
            label: "Cursor",
            root: None,
            unsupported_message: Some(
                "Cursor uses rules/instructions rather than SKILL.md folders; add the OpenPet note to .cursor/rules or AGENTS.md manually.",
            ),
        },
        "openclaw" => SkillTarget {
            id: "openclaw",
            label: "OpenClaw",
            root: home.map(|path| path.join(".openclaw").join("skills")),
            unsupported_message: None,
        },
        "hermes" => SkillTarget {
            id: "hermes",
            label: "Hermes",
            root: home.map(|path| path.join(".hermes").join("skills").join("openpet")),
            unsupported_message: None,
        },
        "opencode" => SkillTarget {
            id: "opencode",
            label: "OpenCode",
            root: home.map(|path| path.join(".config").join("opencode").join("skills")),
            unsupported_message: None,
        },
        "claude" => SkillTarget {
            id: "claude",
            label: "Claude Code",
            root: home.map(|path| path.join(".claude").join("skills")),
            unsupported_message: None,
        },
        _ => SkillTarget {
            id: "unknown",
            label: "Unknown",
            root: None,
            unsupported_message: Some("Unknown target; no files were written."),
        },
    }
}

fn copy_dir_recursive(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target)
        .map_err(|error| format!("failed to create {}: {error}", target.display()))?;
    for entry in fs::read_dir(source)
        .map_err(|error| format!("failed to read {}: {error}", source.display()))?
    {
        let entry = entry.map_err(|error| format!("failed to read skill entry: {error}"))?;
        let file_name = entry.file_name();
        let file_name_lossy = file_name.to_string_lossy();
        if file_name_lossy == "__pycache__" || file_name_lossy.ends_with(".pyc") {
            continue;
        }
        let source_path = entry.path();
        let target_path = target.join(&file_name);
        if source_path.is_dir() {
            copy_dir_recursive(&source_path, &target_path)?;
        } else if source_path.is_file() {
            fs::copy(&source_path, &target_path).map_err(|error| {
                format!(
                    "failed to copy {} to {}: {error}",
                    source_path.display(),
                    target_path.display()
                )
            })?;
        }
    }
    Ok(())
}

fn install_one_skill(
    app: &AppHandle,
    skill_id: &str,
    target_id: &str,
    force: bool,
) -> SkillInstallResult {
    let target = skill_target(target_id);
    let Some(root) = target.root.clone() else {
        return SkillInstallResult {
            skill_id: skill_id.to_string(),
            target_id: target.id.to_string(),
            target_label: target.label.to_string(),
            target_path: None,
            status: "skipped".to_string(),
            message: target
                .unsupported_message
                .unwrap_or("target has no supported automatic skill-folder destination")
                .to_string(),
        };
    };

    let result = (|| -> Result<PathBuf, String> {
        let source = skill_source_dir(app, skill_id)?;
        fs::create_dir_all(&root)
            .map_err(|error| format!("failed to create target root: {error}"))?;
        let target_dir = root.join(skill_id);
        if target_dir.exists() && !force {
            return Err(format!(
                "{} already exists; enable overwrite to replace files inside this skill folder",
                target_dir.display()
            ));
        }
        copy_dir_recursive(&source, &target_dir)?;
        Ok(target_dir)
    })();

    match result {
        Ok(path) => SkillInstallResult {
            skill_id: skill_id.to_string(),
            target_id: target.id.to_string(),
            target_label: target.label.to_string(),
            target_path: Some(path_to_display(&path)),
            status: "installed".to_string(),
            message: "Installed. Start a new agent session if the skill is not detected."
                .to_string(),
        },
        Err(error) => SkillInstallResult {
            skill_id: skill_id.to_string(),
            target_id: target.id.to_string(),
            target_label: target.label.to_string(),
            target_path: Some(path_to_display(&root.join(skill_id))),
            status: "failed".to_string(),
            message: error,
        },
    }
}

fn normalize_release_version(raw_version: &str) -> Option<String> {
    let trimmed = raw_version.trim();
    let start = trimmed
        .char_indices()
        .find_map(|(index, ch)| ch.is_ascii_digit().then_some(index))?;
    let version = &trimmed[start..];
    let core = version
        .split(['+', '-'])
        .next()
        .unwrap_or(version)
        .trim()
        .trim_matches('.');
    (!core.is_empty()).then(|| core.to_string())
}

fn parse_version_parts(version: &str) -> Vec<u64> {
    normalize_release_version(version)
        .unwrap_or_else(|| version.trim().to_string())
        .split('.')
        .map(|part| {
            part.chars()
                .take_while(|ch| ch.is_ascii_digit())
                .collect::<String>()
                .parse::<u64>()
                .unwrap_or(0)
        })
        .collect()
}

fn is_newer_release(latest_version: &str, current_version: &str) -> bool {
    let latest_parts = parse_version_parts(latest_version);
    let current_parts = parse_version_parts(current_version);
    let max_len = latest_parts.len().max(current_parts.len()).max(3);

    for index in 0..max_len {
        let latest = latest_parts.get(index).copied().unwrap_or(0);
        let current = current_parts.get(index).copied().unwrap_or(0);
        if latest != current {
            return latest > current;
        }
    }

    false
}

async fn check_github_release_update() -> Result<UpdateCheckResult, String> {
    let current_version = env!("CARGO_PKG_VERSION").to_string();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(UPDATE_CHECK_TIMEOUT_SECS))
        .user_agent(format!("OpenPet/{current_version}"))
        .build()
        .map_err(|error| format!("failed to create update-check client: {error}"))?;
    let response = client
        .get(GITHUB_LATEST_RELEASE_API)
        .header("accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|error| format!("failed to check GitHub Releases: {error}"))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("failed to check GitHub Releases: HTTP {status}"));
    }

    let release = response
        .json::<GithubRelease>()
        .await
        .map_err(|error| format!("failed to parse GitHub release metadata: {error}"))?;
    let latest_version = normalize_release_version(&release.tag_name);
    let update_available = latest_version
        .as_deref()
        .is_some_and(|latest| is_newer_release(latest, &current_version));

    Ok(UpdateCheckResult {
        current_version,
        latest_version,
        release_name: release.name,
        release_url: if release.html_url.trim().is_empty() {
            GITHUB_RELEASES_URL.to_string()
        } else {
            release.html_url
        },
        published_at: release.published_at,
        update_available,
    })
}

fn open_folder_path(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path)
        .map_err(|error| format!("failed to create folder before opening it: {error}"))?;

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("explorer");
        command.arg(path);
        command
    };

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(path);
        command
    };

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(path);
        command
    };

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("failed to open folder {}: {error}", path.display()))
}

fn normalize_external_url(raw_url: &str) -> Result<String, String> {
    let trimmed = raw_url.trim();
    let url = url::Url::parse(trimmed).map_err(|_| "Enter a valid absolute URL.".to_string())?;
    match url.scheme() {
        "http" | "https" => Ok(url.to_string()),
        _ => Err("Only http and https links can be opened from Settings.".to_string()),
    }
}

fn open_external_url_with_system(url: &str) -> Result<(), String> {
    let url = normalize_external_url(url)?;

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("rundll32");
        command.arg("url.dll,FileProtocolHandler").arg(&url);
        command
    };

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(&url);
        command
    };

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(&url);
        command
    };

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("failed to open external link {url}: {error}"))
}

fn emit_status(app: &AppHandle, state: &AppState) {
    let _ = app.emit(EVENT_RUNTIME_STATUS, state.snapshot());
}

fn pet_window_is_visible(app: &AppHandle) -> Option<bool> {
    app.get_webview_window("pet")
        .and_then(|window| window.is_visible().ok())
}

fn sync_pet_visibility(app: &AppHandle, state: &AppState) {
    if let Some(visible) = pet_window_is_visible(app) {
        state.set_pet_visible(visible);
    }
}

fn show_and_focus(app: &AppHandle, label: &str) -> Result<(), String> {
    let window = app
        .get_webview_window(label)
        .ok_or_else(|| format!("window '{label}' was not found"))?;
    window.show().map_err(|error| error.to_string())?;
    let _ = window.unminimize();
    if label == "pet" {
        let _ = window.set_always_on_top(true);
        let _ = window.set_focus();
        return Ok(());
    }
    window.set_focus().map_err(|error| error.to_string())
}

fn hide_window(app: &AppHandle, label: &str) -> Result<(), String> {
    let window = app
        .get_webview_window(label)
        .ok_or_else(|| format!("window '{label}' was not found"))?;
    window.hide().map_err(|error| error.to_string())
}

fn show_pet_window(app: &AppHandle, state: &AppState) -> Result<RuntimeSnapshot, String> {
    show_and_focus(app, "pet")?;
    state.set_pet_visible(true);
    emit_status(app, state);
    Ok(state.snapshot())
}

fn hide_pet_window(app: &AppHandle, state: &AppState) -> Result<RuntimeSnapshot, String> {
    hide_window(app, "pet")?;
    state.set_pet_visible(false);
    emit_status(app, state);
    Ok(state.snapshot())
}

fn toggle_pet_window(app: &AppHandle, state: &AppState) -> Result<RuntimeSnapshot, String> {
    let visible = pet_window_is_visible(app).unwrap_or_else(|| state.pet_visible());
    if visible {
        hide_pet_window(app, state)
    } else {
        show_pet_window(app, state)
    }
}

struct TrayLabels {
    open_settings: &'static str,
    show_pet: &'static str,
    hide_pet: &'static str,
    quit: &'static str,
}

fn tray_labels(language: PetLanguage) -> TrayLabels {
    match language {
        PetLanguage::ZhCn => TrayLabels {
            open_settings: "打开设置",
            show_pet: "显示宠物",
            hide_pet: "隐藏宠物",
            quit: "退出",
        },
        PetLanguage::En => TrayLabels {
            open_settings: "Open Settings",
            show_pet: "Show Pet",
            hide_pet: "Hide Pet",
            quit: "Quit",
        },
    }
}

fn build_tray_menu(app: &AppHandle, language: PetLanguage) -> tauri::Result<Menu<tauri::Wry>> {
    let labels = tray_labels(language);
    let open_settings = MenuItem::with_id(
        app,
        "open_settings",
        labels.open_settings,
        true,
        None::<&str>,
    )?;
    let show_pet = MenuItem::with_id(app, "show_pet", labels.show_pet, true, None::<&str>)?;
    let hide_pet = MenuItem::with_id(app, "hide_pet", labels.hide_pet, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", labels.quit, true, None::<&str>)?;
    Menu::with_items(app, &[&open_settings, &show_pet, &hide_pet, &quit])
}

fn update_tray_menu(app: &AppHandle, language: PetLanguage) -> Result<(), String> {
    let menu = build_tray_menu(app, language).map_err(|error| error.to_string())?;
    if let Some(tray) = app.tray_by_id("openpet") {
        tray.set_menu(Some(menu))
            .map_err(|error| format!("failed to update tray menu: {error}"))?;
    }
    Ok(())
}

fn build_tray(app: &tauri::App, language: PetLanguage) -> tauri::Result<()> {
    let menu = build_tray_menu(app.handle(), language)?;

    let mut builder = TrayIconBuilder::with_id("openpet")
        .tooltip("OpenPet")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open_settings" => {
                let _ = show_and_focus(app, "settings");
            }
            "show_pet" => {
                let state = app.state::<AppState>();
                let _ = show_pet_window(app, &state);
            }
            "hide_pet" => {
                let state = app.state::<AppState>();
                let _ = hide_pet_window(app, &state);
            }
            "quit" => app.exit(0),
            _ => {}
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)?;
    Ok(())
}

fn hide_settings_window_on_close<R: tauri::Runtime>(
    window: &tauri::Window<R>,
    event: &WindowEvent,
) {
    if window.label() != "settings" {
        return;
    }

    if let WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window.hide();
    }
}

#[tauri::command]
fn get_runtime_snapshot(app: AppHandle, state: tauri::State<AppState>) -> RuntimeSnapshot {
    sync_pet_visibility(&app, &state);
    state.snapshot()
}

#[tauri::command]
fn update_settings(
    app: AppHandle,
    state: tauri::State<AppState>,
    settings: PetSettings,
) -> Result<RuntimeSnapshot, String> {
    let settings = state.update_settings(settings)?;
    state.refresh_imported_pets()?;
    state.persist_settings()?;
    let language = settings.language;
    let _ = app.emit_to("pet", EVENT_PET_SETTINGS, settings);
    let _ = update_tray_menu(&app, language);
    emit_status(&app, &state);
    Ok(state.snapshot())
}

#[tauri::command]
fn update_api_config(
    app: AppHandle,
    state: tauri::State<AppState>,
    config: RuntimeApiConfig,
) -> Result<RuntimeSnapshot, String> {
    state.update_runtime_api_config(config)?;
    emit_status(&app, &state);
    Ok(state.snapshot())
}

#[tauri::command]
fn trigger_action(
    app: AppHandle,
    state: tauri::State<AppState>,
    animation_id: String,
) -> RuntimeSnapshot {
    let payload = ActionPayload {
        animation_id: animation_id.trim().to_string(),
    };
    state.record_action(payload.animation_id.clone());
    let _ = app.emit_to("pet", EVENT_PET_ACTION, payload);
    emit_status(&app, &state);
    state.snapshot()
}

#[tauri::command]
fn say(
    app: AppHandle,
    state: tauri::State<AppState>,
    text: String,
    ttl_ms: Option<u64>,
) -> RuntimeSnapshot {
    let payload = SayPayload {
        text: text.trim().chars().take(512).collect(),
        ttl_ms,
    };
    state.record_say(payload.text.clone(), payload.ttl_ms);
    let _ = app.emit_to("pet", EVENT_PET_SAY, payload);
    emit_status(&app, &state);
    state.snapshot()
}

#[tauri::command]
fn trigger_event(
    app: AppHandle,
    state: tauri::State<AppState>,
    event_type: CompanionEventType,
    message: Option<String>,
    ttl_ms: Option<u64>,
) -> RuntimeSnapshot {
    let payload = CompanionEventPayload {
        event_type,
        message,
        ttl_ms,
    };
    emit_companion_event(&app, &state, payload);
    state.snapshot()
}

#[tauri::command]
fn open_settings(app: AppHandle) -> Result<(), String> {
    show_and_focus(&app, "settings")
}

#[tauri::command]
fn show_pet(app: AppHandle, state: tauri::State<AppState>) -> Result<RuntimeSnapshot, String> {
    show_pet_window(&app, &state)
}

#[tauri::command]
fn hide_pet(app: AppHandle, state: tauri::State<AppState>) -> Result<RuntimeSnapshot, String> {
    hide_pet_window(&app, &state)
}

#[tauri::command]
fn toggle_pet_visibility(
    app: AppHandle,
    state: tauri::State<AppState>,
) -> Result<RuntimeSnapshot, String> {
    toggle_pet_window(&app, &state)
}

#[tauri::command]
async fn check_for_update() -> Result<UpdateCheckResult, String> {
    check_github_release_update().await
}

#[tauri::command]
async fn import_pet_from_website(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    url: String,
) -> Result<RuntimeSnapshot, String> {
    import_website_pet(&app, &state, WebsiteImportPayload { url, force: false }).await
}

#[tauri::command]
fn list_bundled_skills(app: AppHandle) -> Result<Vec<BundledSkill>, String> {
    let _ = bundled_skills_dir(&app)?;
    Ok(BUNDLED_SKILL_IDS
        .iter()
        .filter_map(|id| bundled_skill_metadata(id))
        .collect())
}

#[tauri::command]
fn install_bundled_skills(
    app: AppHandle,
    payload: InstallBundledSkillsPayload,
) -> Result<Vec<SkillInstallResult>, String> {
    if payload.skill_ids.is_empty() || payload.target_ids.is_empty() {
        return Err("select at least one skill and one target".to_string());
    }

    let mut results = Vec::new();
    for skill_id in payload.skill_ids {
        for target_id in &payload.target_ids {
            results.push(install_one_skill(&app, &skill_id, target_id, payload.force));
        }
    }
    Ok(results)
}

#[tauri::command]
fn open_pet_storage_folder(
    state: tauri::State<AppState>,
    folder: PetStorageFolderKind,
) -> Result<String, String> {
    let snapshot = state.snapshot().pet_storage;
    let path = match folder {
        PetStorageFolderKind::Active => PathBuf::from(snapshot.active_dir),
        PetStorageFolderKind::AppData => PathBuf::from(snapshot.app_data_dir),
        PetStorageFolderKind::CodexCustom => PathBuf::from(snapshot.codex_dir),
    };
    open_folder_path(&path)?;
    Ok(path_to_display(&path))
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    open_external_url_with_system(&url)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = AppState::new(RuntimeApiConfig::default());

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(state.clone())
        .on_window_event(hide_settings_window_on_close)
        .setup(move |app| {
            match runtime_config_path(app.handle()) {
                Ok(path) => {
                    let legacy_path = legacy_runtime_config_path(app.handle()).ok();
                    let config = env_runtime_api_config(load_runtime_api_config(
                        &path,
                        legacy_path.as_deref(),
                    ));
                    state.configure_runtime_api(config, Some(path));
                }
                Err(error) => {
                    state.mark_api_error(error);
                    state.configure_runtime_api(
                        env_runtime_api_config(RuntimeApiConfig::default()),
                        None,
                    );
                }
            }
            match app.handle().path().app_data_dir() {
                Ok(app_data_dir) => {
                    let settings_path = settings_config_path(app.handle()).ok();
                    if let Err(error) =
                        state.configure_app_paths(app_data_dir, settings_path.clone())
                    {
                        state.mark_api_error(error);
                    }
                    if let Some(path) = settings_path {
                        if let Err(error) = state.configure_settings(load_pet_settings(&path)) {
                            state.mark_api_error(error);
                        }
                    }
                    if let Err(error) = state.refresh_imported_pets() {
                        state.mark_api_error(error);
                    }
                }
                Err(error) => state.mark_api_error(format!("failed to resolve app data: {error}")),
            }
            build_tray(app, state.settings().language)?;
            http_api::start_http_api(app.handle().clone(), state.clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_runtime_snapshot,
            update_settings,
            update_api_config,
            trigger_action,
            say,
            trigger_event,
            open_settings,
            show_pet,
            hide_pet,
            toggle_pet_visibility,
            check_for_update,
            import_pet_from_website,
            list_bundled_skills,
            install_bundled_skills,
            open_pet_storage_folder,
            open_external_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running OpenPet");
}

pub(crate) fn emit_http_action(app: &AppHandle, state: &AppState, payload: ActionPayload) {
    state.record_action(payload.animation_id.clone());
    let _ = app.emit_to("pet", EVENT_PET_ACTION, payload);
    emit_status(app, state);
}

pub(crate) fn emit_http_say(app: &AppHandle, state: &AppState, payload: SayPayload) {
    state.record_say(payload.text.clone(), payload.ttl_ms);
    let _ = app.emit_to("pet", EVENT_PET_SAY, payload);
    emit_status(app, state);
}

pub(crate) fn emit_companion_event(
    app: &AppHandle,
    state: &AppState,
    payload: CompanionEventPayload,
) {
    let settings = state.settings();
    let animation_id = payload.event_type.animation_id();
    let message = payload
        .message
        .unwrap_or_default()
        .trim()
        .chars()
        .take(512)
        .collect::<String>();
    let custom_message = if message.is_empty() {
        None
    } else {
        Some(message)
    };
    let bubble_text = custom_message
        .clone()
        .or_else(|| Some(payload.event_type.default_bubble().to_string()));
    let recent = RecentCompanionEvent {
        event_type: payload.event_type,
        message: custom_message,
        animation_id,
        bubble_text: bubble_text.clone(),
        received_at_ms: now_ms(),
    };
    let visible_bubble_text = if settings.event_bubbles {
        bubble_text.clone()
    } else {
        None
    };
    let visible_bubble_ttl_ms = if settings.event_bubbles {
        payload.ttl_ms.or(Some(settings.event_bubble_ttl_ms))
    } else {
        None
    };

    state.record_companion_event(
        recent,
        settings.event_reactions,
        visible_bubble_text,
        visible_bubble_ttl_ms,
    );

    if settings.event_reactions {
        let _ = app.emit_to(
            "pet",
            EVENT_PET_ACTION,
            ActionPayload {
                animation_id: animation_id.as_str().to_string(),
            },
        );
    }

    if settings.event_bubbles {
        if let Some(text) = bubble_text {
            let _ = app.emit_to(
                "pet",
                EVENT_PET_SAY,
                SayPayload {
                    text,
                    ttl_ms: visible_bubble_ttl_ms,
                },
            );
        }
    }

    emit_status(app, state);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_codex_pets_ids_from_supported_urls() {
        let share_url = url::Url::parse("https://codex-pets.net/share/star-guardian-jinx").unwrap();
        let hash_url = url::Url::parse("https://codex-pets.net/#/pets/ameath").unwrap();

        assert_eq!(
            extract_codex_pets_id(&share_url).as_deref(),
            Some("star-guardian-jinx")
        );
        assert_eq!(extract_codex_pets_id(&hash_url).as_deref(), Some("ameath"));
    }

    #[test]
    fn rejects_local_import_urls() {
        assert!(parse_safe_import_url("https://127.0.0.1/pets/evil").is_err());
        assert!(parse_safe_import_url("https://localhost/pets/evil").is_err());
        assert!(parse_safe_import_url("https://[::1]/pets/evil").is_err());
        assert!(parse_safe_import_url("https://[fc00::1]/pets/evil").is_err());
        assert!(parse_safe_import_url("https://169.254.1.1/pets/evil").is_err());
        assert!(parse_safe_import_url("http://petdex.crafter.run/pets/boba").is_err());
    }

    #[test]
    fn extracts_likely_generic_spritesheet_urls() {
        let base = url::Url::parse("https://www.codexpetshop.com/p/ruckusbear").unwrap();
        let html = r#"<div style="background-image: url('/sprites/ruckusbear.webp')"></div>"#;

        assert_eq!(
            extract_webp_url(html, &base).map(|url| url.to_string()),
            Some("https://www.codexpetshop.com/sprites/ruckusbear.webp".to_string())
        );
    }

    #[test]
    fn deserializes_current_petdex_manifest_shape() {
        let manifest = serde_json::from_str::<PetdexManifest>(
            r#"{
              "generatedAt": "2026-05-04T11:25:36.320Z",
              "total": 468,
              "pets": [{
                "slug": "kebo",
                "displayName": "Kebo",
                "kind": "creature",
                "submittedBy": "railly",
                "spritesheetUrl": "https://cdn.example.test/curated/kebo/spritesheet.webp",
                "petJsonUrl": "https://cdn.example.test/curated/kebo/pet.json",
                "zipUrl": "https://cdn.example.test/curated/kebo/kebo.zip"
              }]
            }"#,
        )
        .unwrap();

        let pet = manifest.pets.first().unwrap();
        assert_eq!(pet.slug, "kebo");
        assert_eq!(pet.description.as_deref(), None);
        assert_eq!(pet.page_url.as_deref(), None);
    }

    #[test]
    fn extracts_spriteyard_json_ld_metadata() {
        let base = url::Url::parse("https://spriteyard.com/pets/nib/").unwrap();
        let html = r#"
          <script type="application/ld+json">{
            "@context": "https://schema.org",
            "@type": "CreativeWork",
            "name": "Nib",
            "description": "A pixel pet package for Codex.",
            "image": "https://assets.spriteyard.com/pets/nib/spritesheet.webp",
            "encoding": {
              "@type": "MediaObject",
              "contentUrl": "https://assets.spriteyard.com/pets/nib/nib.zip"
            }
          }</script>
        "#;

        assert_eq!(extract_page_display_name(html).as_deref(), Some("Nib"));
        assert_eq!(
            extract_page_description(html).as_deref(),
            Some("A pixel pet package for Codex.")
        );
        assert_eq!(
            extract_page_spritesheet_url(html, &base).map(|url| url.to_string()),
            Some("https://assets.spriteyard.com/pets/nib/spritesheet.webp".to_string())
        );
    }

    #[test]
    fn builds_website_import_client() {
        website_import_client().unwrap();
    }

    #[test]
    fn resolves_local_package_directory() {
        let source = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../public/pets/nia");
        let resolved = resolve_local_pet_source(LocalImportPayload {
            source: source.to_string_lossy().to_string(),
            id: None,
            display_name: None,
            description: None,
            force: false,
        })
        .unwrap();

        assert_eq!(resolved.id, "nia");
        assert_eq!(resolved.display_name, "Nia");
        assert!(resolved.spritesheet_path.ends_with("spritesheet.webp"));
    }

    #[test]
    fn validates_webp_header() {
        let mut valid = b"RIFF0000WEBPVP8 ".to_vec();
        valid.extend_from_slice(&[0; 8]);
        assert!(validate_webp(&valid).is_ok());
        assert!(validate_webp(b"not a webp image").is_err());
    }

    #[test]
    fn normalizes_external_settings_links() {
        assert_eq!(
            normalize_external_url(" https://github.com/X-T-E-R/OpenPet ").unwrap(),
            "https://github.com/X-T-E-R/OpenPet".to_string()
        );
        assert!(normalize_external_url("file:///C:/Users/example").is_err());
        assert!(normalize_external_url("javascript:alert(1)").is_err());
        assert!(normalize_external_url("not a url").is_err());
    }

    #[test]
    fn compares_github_release_versions() {
        assert_eq!(
            normalize_release_version("v0.2.0").as_deref(),
            Some("0.2.0")
        );
        assert_eq!(
            normalize_release_version("openpet-v1.4.0+build.3").as_deref(),
            Some("1.4.0")
        );
        assert!(is_newer_release("v0.2.0", "0.1.9"));
        assert!(is_newer_release("1.0", "0.9.9"));
        assert!(!is_newer_release("0.1.0", "0.1.0"));
        assert!(!is_newer_release("0.1.0", "0.2.0"));
    }

    #[test]
    fn defaults_to_random_click_mode_with_fallback_pool() {
        let settings = PetSettings::default();
        assert_eq!(settings.click_action_mode, ClickActionMode::Random);
        assert_eq!(settings.click_action, PetActionAnimationId::Waving);
        assert!(settings.click_action_pool.contains(&settings.click_action));
    }

    #[test]
    fn keeps_imported_active_pet_when_loading_settings_before_catalog_refresh() {
        let root = std::env::temp_dir().join(format!(
            "openpet-active-pet-persist-{}-{}",
            std::process::id(),
            now_ms()
        ));
        let imported_root = root.join("pets");
        let pet_dir = imported_root.join("imported-nia");
        fs::create_dir_all(&pet_dir).unwrap();
        fs::write(pet_dir.join("spritesheet.webp"), b"placeholder").unwrap();
        fs::write(
            pet_dir.join("pet.json"),
            r#"{
  "id": "imported-nia",
  "displayName": "Imported Nia",
  "description": "Imported pet",
  "spritesheetPath": "spritesheet.webp",
  "imported": true
}"#,
        )
        .unwrap();

        let state = AppState::new(RuntimeApiConfig::default());
        state
            .configure_app_paths(root.join("app-data"), None)
            .unwrap();
        let mut settings = PetSettings::default();
        settings.pet_storage_preset = PetStoragePreset::Custom;
        settings.custom_pet_storage_dir = Some(imported_root.to_string_lossy().to_string());
        settings.active_pet_id = "imported-nia".to_string();

        state.configure_settings(settings).unwrap();
        state.refresh_imported_pets().unwrap();

        assert_eq!(state.settings().active_pet_id, "imported-nia");
        assert_eq!(state.snapshot().active_pet.id, "imported-nia");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn normalizes_runtime_api_config() {
        let config = normalize_api_config(RuntimeApiConfig {
            listen_address: " 0.0.0.0 ".to_string(),
            port: 17322,
        })
        .unwrap();

        assert_eq!(config.listen_address, "0.0.0.0");
        assert_eq!(config.port, 17322);
        assert!(normalize_api_config(RuntimeApiConfig {
            listen_address: "192.168.1.10".to_string(),
            port: 17321,
        })
        .is_err());
        assert!(normalize_api_config(RuntimeApiConfig {
            listen_address: "127.0.0.1".to_string(),
            port: 0,
        })
        .is_err());
    }
}
