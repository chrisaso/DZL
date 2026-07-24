import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AppConfig, EnvironmentReport, LoginStatus } from "../types/launcher";

export interface UseConfig {
  config: AppConfig | null;
  env: EnvironmentReport | null;
  loading: boolean;
  error: string | null;
  /** Persists a partial change and returns the config the backend stored. */
  save: (patch: Partial<AppConfig>) => Promise<AppConfig | null>;
  reload: () => Promise<void>;
  checkLogin: (login?: string | null) => Promise<LoginStatus>;
  fixMaxMapCount: () => Promise<void>;
}

export function useConfig(): UseConfig {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [env, setEnv] = useState<EnvironmentReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Saves merge against this rather than the captured `config`, so toggling
  // two settings in quick succession cannot resurrect the older value.
  const latest = useRef<AppConfig | null>(null);
  latest.current = config;

  const reload = useCallback(async () => {
    try {
      const [nextConfig, nextEnv] = await Promise.all([
        invoke<AppConfig>("get_config"),
        invoke<EnvironmentReport>("check_environment"),
      ]);
      setConfig(nextConfig);
      setEnv(nextEnv);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const save = useCallback(async (patch: Partial<AppConfig>) => {
    const current = latest.current;
    if (!current) return null;

    const merged = { ...current, ...patch };
    latest.current = merged;
    try {
      const stored = await invoke<AppConfig>("set_config", { config: merged });
      setConfig(stored);
      latest.current = stored;
      // A new Steam path changes every other answer, so re-probe.
      invoke<EnvironmentReport>("check_environment").then(setEnv).catch(() => {});
      return stored;
    } catch (e) {
      setError(String(e));
      return null;
    }
  }, []);

  const checkLogin = useCallback(
    (login?: string | null) =>
      invoke<LoginStatus>("check_steamcmd_login", {
        login: login ?? latest.current?.steamLogin ?? null,
      }),
    [],
  );

  const fixMaxMapCount = useCallback(async () => {
    await invoke("fix_max_map_count");
    await reload();
  }, [reload]);

  return { config, env, loading, error, save, reload, checkLogin, fixMaxMapCount };
}
