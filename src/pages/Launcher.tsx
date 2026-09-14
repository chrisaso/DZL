import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useModUpdates } from "../hooks/useModUpdates";
import { useServerQuery } from "../hooks/useServerQuery";
import { useServerStore } from "../store/serverStore";
import type { ModRef, QueryTarget } from "../types/launcher";
import { collectSetupIssues } from "../utils/setupIssues";
import { ServerList } from "./ServerList";

export function Launcher() {
  const [tab, setTab] = useState<Tab>("servers");
  const [manualLaunch, setManualLaunch] = useState(false);
  
  const configState = useConfig();
  const { config, env, fixMaxMapCount, reload } = configState;
  
  const { favorites, toggle } = useFavorites();
  const { history, add: recordHistory, remove: forgetHistory } = useHistory();
  const { results, query, querying } = useServerQuery();
  const { refreshing, forceRefresh } = useServerStore();
  
  const [installedMods, setInstalledMods] = useState<Set<string>>(new Set());
  const modUpdates = useModUpdates();
  
  const loadInstalledMods = useCallback(() => {
    invoke<ModRef[]>("list_mod_refs", { steamPath: null })
    .then((mods) => setInstalledMods(new Set(mods.map((m) => m.workshopId))))
    .catch(() => {});
  }, []);
  
  useEffect(loadInstalledMods, [loadInstalledMods]);
  
  // One Workshop round-trip at startup so the Mods tab badge is accurate
  // before the user ever opens it.
  const checkUpdates = modUpdates.check;
  useEffect(() => {
    checkUpdates();
  }, [checkUpdates]);
  
  const join = useJoinServer({
    onLaunched: (server) => {
      recordHistory(server);
      // A join may have pulled new mods down.
      loadInstalledMods();
      reload();
    },
  });
  
  // Kept in sync with what the virtualiser currently has on screen so the
  // top-right Refresh can force-requery exactly those rows without waiting
  // for the useServerQuery TTL to lapse.
  const visibleTargetsRef = useRef<QueryTarget[]>([]);
  
  const handleVisibleChange = useCallback(
    (servers: Server[]) => {
      const targets = servers.map((s) => ({
        ip: s.endpoint.ip,
        port: s.endpoint.port,
      }));
      visibleTargetsRef.current = targets;
      query(targets);
    },
    [query],
  );
  
  // `force` skips the ping cache; an explicit refresh should never hand back
  // the reading it took a minute ago.
  const handleRefreshPing = useCallback(
    async (ip: string, port: number) => {
      await query([{ ip, port }], true);
    },
    [query],
  );
  
  // The top-right Refresh has to update BOTH data sources or the user sees
  // no change: DZSA gives the master list and its snapshot counts, but the
  // visible ping/players columns prefer live A2S data, which lives in a
  // separate cache. Mirrors what the per-row Refresh does in ServerList.
  const handleGlobalRefresh = useCallback(async () => {
    await Promise.all([
      forceRefresh(),
      query(visibleTargetsRef.current, true),
    ]);
  }, [forceRefresh, query]);
  
  // `force` skips the ping cache; an explicit refresh should never hand back
  // the reading it took a minute ago.
  const handleRefreshPing = useCallback(
    async (ip: string, port: number) => {
      await query([{ ip, port }], true);
    },
    [query],
  );
  
  // Everything the user needs to fix before the launcher is fully usable. The
  // Settings page renders the same list in full, per section.
  const issues = useMemo(() => collectSetupIssues(config, env), [config, env]);
  
  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-base">
    <TopBar
    tab={tab}
    onTab={setTab}
    env={env}
    issueCount={issues.length}
    modUpdateCount={modUpdates.outdated.length}
    refreshing={refreshing}
    onRefresh={handleGlobalRefresh}
    onManualLaunch={() => setManualLaunch(true)}
    />
    
    {modUpdates.outdated.length > 0 && tab !== "mods" && (
      <div className="px-4 py-2 border-b border-trim bg-surface/60">
      <Banner
      tone="warn"
      title={`${modUpdates.outdated.length} mod update${
        modUpdates.outdated.length === 1 ? "" : "s"
      } available`}
      action={
        <Button variant="secondary" onClick={() => setTab("mods")}>
        Review in mods
        </Button>
      }
      >
      {modUpdates.outdated
        .slice(0, 4)
        .map((m) => m.name)
        .join(" · ")}
        {modUpdates.outdated.length > 4 &&
          ` · +${modUpdates.outdated.length - 4} more`}
          </Banner>
          </div>
        )}
        
        {issues.length > 0 && tab !== "settings" && (
          <div className="px-4 py-2 border-b border-trim bg-surface/60">
          <Banner
          tone="warn"
          title={
            issues.length === 1
            ? issues[0].title
            : `${issues.length} things need setting up`
          }
          action={
            <Button variant="secondary" onClick={() => setTab("settings")}>
            Fix in settings
            </Button>
          }
          >
          {issues.length > 1
            ? issues.map((i) => i.title).join(" · ")
            : issues[0].detail}
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
            querying={querying}
            onVisibleChange={handleVisibleChange}
            onRefreshPing={handleRefreshPing}
            installedMods={installedMods}
            />
          )}
          
          {tab === "mods" && (
            <ModsPage
            active
            updates={modUpdates.statuses}
            outdated={modUpdates.outdated}
            checkingUpdates={modUpdates.checking}
            updatesError={modUpdates.error}
            lastChecked={modUpdates.lastChecked}
            onCheckUpdates={modUpdates.check}
            />
          )}
          
          {tab === "settings" && <SettingsPage configState={configState} />}
          
          <JoinModal
          state={join.state}
          onConfirm={join.confirm}
          onApproveSteamClose={join.approveSteamClose}
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
      