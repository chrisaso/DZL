import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { JoinModal } from "../components/JoinModal";
import { ManualLaunchModal } from "../components/ManualLaunchModal";
import { ModsPage } from "../components/ModsPage";
import { SettingsPage } from "../components/SettingsPage";
import { TopBar, type Tab } from "../components/TopBar";
import { Banner, Button } from "../components/ui";
import { useConfig } from "../hooks/useConfig";
import { useFavorites } from "../hooks/useFavorites";
import { useHistory } from "../hooks/useHistory";
import { useJoinServer } from "../hooks/useJoinServer";
import { useServerQuery } from "../hooks/useServerQuery";
import { useServerStore } from "../store/serverStore";
import type { ModRef } from "../types/launcher";
import type { Server } from "../types/server";
import { ServerList } from "./ServerList";

export function Launcher() {
  const [tab, setTab] = useState<Tab>("servers");
  const [manualLaunch, setManualLaunch] = useState(false);

  const configState = useConfig();
  const { config, env, fixMaxMapCount, reload } = configState;

  const { favorites, toggle } = useFavorites();
  const { history, add: recordHistory, remove: forgetHistory } = useHistory();
  const { results, query } = useServerQuery();
  const { refreshing, forceRefresh } = useServerStore();

  const [installedMods, setInstalledMods] = useState<Set<string>>(new Set());

  const loadInstalledMods = useCallback(() => {
    invoke<ModRef[]>("list_mod_refs", { steamPath: null })
      .then((mods) => setInstalledMods(new Set(mods.map((m) => m.workshopId))))
      .catch(() => {});
  }, []);

  useEffect(loadInstalledMods, [loadInstalledMods]);

  const join = useJoinServer({
    onLaunched: (server) => {
      recordHistory(server);
      // A join may have pulled new mods down.
      loadInstalledMods();
      reload();
    },
  });

  const handleVisibleChange = useCallback(
    (servers: Server[]) =>
      query(
        servers.map((s) => ({ ip: s.endpoint.ip, port: s.endpoint.port })),
      ),
    [query],
  );

  // Everything the user needs to fix before the launcher is fully usable.
  const issues = useMemo(() => {
    if (!env || !config) return [];
    const found: string[] = [];
    if (!env.dayzInstalled) found.push("DayZ not found");
    if (!env.maxMapCountOk) found.push("vm.max_map_count too low");
    if (!config.playerName?.trim()) found.push("No in-game name set");
    if (config.useSteamcmd && !env.steamcmdInstalled)
      found.push("steamcmd not installed");
    if (config.useSteamcmd && !config.steamLogin?.trim())
      found.push("No Steam account for mod downloads");
    return found;
  }, [env, config]);

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-base">
      <TopBar
        tab={tab}
        onTab={setTab}
        env={env}
        issueCount={issues.length}
        refreshing={refreshing}
        onRefresh={forceRefresh}
        onManualLaunch={() => setManualLaunch(true)}
      />

      {issues.length > 0 && tab !== "settings" && (
        <div className="px-4 py-2 border-b border-trim bg-surface/60">
          <Banner
            tone="warn"
            title={
              issues.length === 1
                ? issues[0]
                : `${issues.length} things need setting up`
            }
            action={
              <Button variant="secondary" onClick={() => setTab("settings")}>
                Fix in settings
              </Button>
            }
          >
            {issues.length > 1 ? issues.join(" · ") : "Joining a server will fail until this is sorted."}
          </Banner>
        </div>
      )}

      {tab === "servers" && (
        <ServerList
          favorites={favorites}
          toggleFavorite={toggle}
          history={history}
          onForgetHistory={forgetHistory}
          onJoin={join.startJoin}
          queryResults={results}
          onVisibleChange={handleVisibleChange}
          installedMods={installedMods}
        />
      )}

      {tab === "mods" && <ModsPage active />}

      {tab === "settings" && <SettingsPage configState={configState} />}

      <JoinModal
        state={join.state}
        onConfirm={join.confirm}
        onDismiss={join.dismiss}
        onRetry={join.retry}
        onOpenSettings={() => {
          join.dismiss();
          setTab("settings");
        }}
        onFixMaxMapCount={fixMaxMapCount}
      />

      {manualLaunch && (
        <ManualLaunchModal
          onClose={() => {
            setManualLaunch(false);
            loadInstalledMods();
          }}
        />
      )}
    </div>
  );
}
