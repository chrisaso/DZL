import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ModLibrary, ModProgress } from "../types/launcher";

export function useMods(enabled: boolean) {
  const [library, setLibrary] = useState<ModLibrary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<ModProgress | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setLibrary(await invoke<ModLibrary>("list_mods", { steamPath: null }));
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (enabled) refresh();
  }, [enabled, refresh]);

  useEffect(() => () => unlistenRef.current?.(), []);

  /** Runs a mutating command, then refreshes the library. */
  const run = useCallback(
    async <T,>(label: string, command: string, args: Record<string, unknown>) => {
      setBusy(label);
      setError(null);
      try {
        const result = await invoke<T>(command, args);
        await refresh();
        return result;
      } catch (e) {
        setError(String(e));
        return null;
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  const deleteMods = useCallback(
    (workshopIds: string[]) =>
      run<number>("deleting", "delete_mods", { steamPath: null, workshopIds }),
    [run],
  );

  const deleteManaged = useCallback(
    () => run<number>("deleting", "delete_managed_mods", { steamPath: null }),
    [run],
  );

  const removeAllLinks = useCallback(
    () => run<number>("unlinking", "remove_all_links", { steamPath: null }),
    [run],
  );

  const relinkAll = useCallback(
    () => run<number>("linking", "relink_all_mods", { steamPath: null }),
    [run],
  );

  const updateMods = useCallback(
    async (workshopIds: string[]) => {
      setBusy("updating");
      setError(null);
      setProgress(null);

      unlistenRef.current?.();
      unlistenRef.current = await listen<ModProgress>("mod-progress", (event) =>
        setProgress(event.payload),
      );

      try {
        await invoke("update_mods", { steamPath: null, workshopIds });
        await refresh();
        return true;
      } catch (e) {
        setError(String(e));
        return false;
      } finally {
        unlistenRef.current?.();
        unlistenRef.current = null;
        setBusy(null);
        setProgress(null);
      }
    },
    [refresh],
  );

  return {
    library,
    loading,
    error,
    busy,
    progress,
    refresh,
    deleteMods,
    deleteManaged,
    removeAllLinks,
    relinkAll,
    updateMods,
  };
}
