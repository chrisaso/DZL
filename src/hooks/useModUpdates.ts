import { invoke } from "@tauri-apps/api/core";
import { useCallback, useMemo, useState } from "react";
import type { ModUpdateStatus } from "../types/launcher";

/**
 * Compares the installed mods against the Steam Workshop. The backend does the
 * work; this just holds the answer so the mods tab and the tab badge agree.
 */
export function useModUpdates() {
  const [statuses, setStatuses] = useState<Map<string, ModUpdateStatus>>(new Map());
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<number | null>(null);

  const check = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      const list = await invoke<ModUpdateStatus[]>("check_mod_updates", {
        steamPath: null,
      });
      setStatuses(new Map(list.map((s) => [s.workshopId, s])));
      setLastChecked(Date.now());
      return list;
    } catch (e) {
      // Offline or Steam having a bad day, so leave the previous answer alone
      // rather than pretending everything is up to date.
      setError(String(e));
      return null;
    } finally {
      setChecking(false);
    }
  }, []);

  const outdated = useMemo(
    () => [...statuses.values()].filter((s) => s.updateAvailable),
    [statuses],
  );

  return { statuses, outdated, checking, error, lastChecked, check };
}
