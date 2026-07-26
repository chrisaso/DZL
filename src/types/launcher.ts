/** Types mirroring the Rust command layer in `src-tauri/src/commands`. */

export interface LaunchOption {
  key: string;
  enabled: boolean;
  value: string | null;
  description: string;
  takesValue: boolean;
}

export type DisplayMode = "fullscreen" | "borderless" | "windowed";

export interface WrapperConfig {
  gamemode: boolean;
  gamescope: boolean;
  width: number | null;
  height: number | null;
  refresh: number | null;
  displayMode: DisplayMode;
  forceGrabCursor: boolean;
  extraArgs: string;
  /** `KEY=value` entries exported before the wrappers run. */
  env: string[];
  previousLaunchOptions: string | null;
}

export type HookState = "notInstalled" | "installed" | "changed" | "unreadable";

export interface WrapperStatus {
  hook: HookState;
  launchOptions: string | null;
  scriptPath: string;
  expectedHook: string;
  preview: string;
  accountId: string | null;
  steamRunning: boolean;
  gamescopeInstalled: boolean;
  gamescopeVersion: string | null;
  gamemodeInstalled: boolean;
}

export interface AppConfig {
  steamPath: string | null;
  playerName: string | null;
  steamLogin: string | null;
  useSteamcmd: boolean;
  killRunningDayz: boolean;
  updateModsOnJoin: boolean;
  hideToTrayOnLaunch: boolean;
  launchOptions: LaunchOption[];
  customArgs: string[];
  wrapper: WrapperConfig;
  setupComplete: boolean;
}

export interface EnvironmentReport {
  steamInstalled: boolean;
  steamcmdInstalled: boolean;
  steamPath: string | null;
  steamPathDetected: boolean;
  dayzPath: string | null;
  dayzInstalled: boolean;
  maxMapCount: number;
  requiredMaxMapCount: number;
  maxMapCountOk: boolean;
  canFixMaxMapCount: boolean;
  sysctlFixCommand: string;
  steamRunning: boolean;
  dayzRunning: boolean;
  geoLookupAvailable: boolean;
  gamescopeInstalled: boolean;
  gamemodeInstalled: boolean;
}

export interface LoginStatus {
  installed: boolean;
  loggedIn: boolean;
  reason:
    | "ok"
    | "not-installed"
    | "no-account"
    | "needs-login"
    | "needs-steam-guard"
    | "rate-limited"
    | "invalid-password"
    | "timeout"
    | "unknown";
  message: string;
  fixCommand: string | null;
}

export interface ModRef {
  workshopId: string;
  name: string;
}

export interface InstalledMod {
  workshopId: string;
  name: string;
  sizeBytes: number;
  timestamp: number | null;
  /** Installed by this launcher rather than by a Workshop subscription. */
  managed: boolean;
  /** Has a working `@id` symlink in the DayZ directory. */
  linked: boolean;
}

export interface ModUpdateStatus {
  workshopId: string;
  name: string;
  /** Newest local content file, unix seconds. */
  localUpdated: number | null;
  /** When the author last published, unix seconds. */
  remoteUpdated: number | null;
  updateAvailable: boolean;
  remoteTitle: string | null;
  remoteSizeBytes: number | null;
}

export interface ModLibrary {
  mods: InstalledMod[];
  totalSizeBytes: number;
  workshopPath: string;
  linkedCount: number;
  managedCount: number;
}

export interface JoinRequirements {
  steamPath: string | null;
  dayzInstalled: boolean;
  missingMods: ModRef[];
  playerName: string | null;
  playerNameNeeded: boolean;
  useSteamcmd: boolean;
  steamLogin: string | null;
  steamLoginNeeded: boolean;
  updateModsOnJoin: boolean;
  maxMapCountOk: boolean;
  /** Whether Steam is up, so the UI knows to ask for approval first. */
  steamRunning: boolean;
  /** False when wrapper settings are on but Steam no longer runs our script. */
  wrapperHookOk: boolean;
}

export interface JoinRequest {
  ip?: string | null;
  gamePort?: number | null;
  mods: ModRef[];
  password?: string | null;
  updateMods?: boolean | null;
}

export interface JoinProgress {
  step: string;
  detail: string | null;
  current: number;
  total: number;
  percent: number | null;
}

export interface ModProgress extends JoinProgress {}

export interface QueryTarget {
  ip: string;
  port: number;
}

export interface QueryResult {
  ip: string;
  port: number;
  online: boolean;
  pingMs: number | null;
  players: number | null;
  maxPlayers: number | null;
  name: string | null;
  map: string | null;
  version: string | null;
}

export interface HistoryEntry {
  id: string;
  name: string;
  ip: string;
  /** Query port, the id used everywhere else in the app. */
  port: number;
  gamePort: number;
  timestamp: number;
}
