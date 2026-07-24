import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
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

  const save = useCallback(
    async (patch: Partial<AppConfig>) => {
      if (!config) return null;
      const merged = { ...config, ...patch };
      try {
        const stored = await invoke<AppConfig>("set_config", { config: merged });
        setConfig(stored);
        // Steam path changes move every other answer, so re-probe.
        invoke<EnvironmentReport>("check_environment").then(setEnv).catch(() => {});
        return stored;
      } catch (e) {
        setError(String(e));
        return null;
      }
    },
    [config],
  );

  const checkLogin = useCallback(
    (login?: string | null) =>
      invoke<LoginStatus>("check_steamcmd_login", {
        login: login ?? config?.steamLogin ?? null,
      }),
    [config],
  );

  const fixMaxMapCount = useCallback(async () => {
    await invoke("fix_max_map_count");
    await reload();
  }, [reload]);

  return { config, env, loading, error, save, reload, checkLogin, fixMaxMapCount };
}
