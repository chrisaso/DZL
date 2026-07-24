import type { EnvironmentReport } from "../types/launcher";
import { Logo } from "./Logo";
import { Button, Icon, Spinner } from "./ui";

export type Tab = "servers" | "mods" | "settings";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "servers", label: "Servers", icon: "servers" },
  { id: "mods", label: "Mods", icon: "mods" },
  { id: "settings", label: "Settings", icon: "settings" },
];

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      <span
        className={`w-1.5 h-1.5 rounded-full ${ok ? "bg-good" : "bg-muted"}`}
      />
      {label}
    </span>
  );
}

export function TopBar({
  tab,
  onTab,
  env,
  issueCount,
  modUpdateCount,
  refreshing,
  onRefresh,
  onManualLaunch,
}: {
  tab: Tab;
  onTab: (tab: Tab) => void;
  env: EnvironmentReport | null;
  issueCount: number;
  modUpdateCount: number;
  refreshing: boolean;
  onRefresh: () => void;
  onManualLaunch: () => void;
}) {
  const badgeFor = (id: Tab) =>
    id === "settings" ? issueCount : id === "mods" ? modUpdateCount : 0;

  return (
    <header className="shrink-0 flex items-center gap-4 px-4 h-12 border-b border-trim bg-surface">
      <div className="flex items-center gap-2.5 pr-2">
        <Logo size={24} />
        <span className="font-semibold text-sm tracking-wide text-primary">
          DZL
        </span>
      </div>

      <nav className="flex items-center gap-1">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            onClick={() => onTab(entry.id)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
              tab === entry.id
                ? "bg-elevated text-primary"
                : "text-secondary hover:text-primary"
            }`}
          >
            <Icon name={entry.icon} />
            {entry.label}
            {badgeFor(entry.id) > 0 && (
              <span
                className="ml-0.5 min-w-4 h-4 px-1 rounded-full bg-accent text-white text-[10px] leading-4 text-center"
                title={
                  entry.id === "mods"
                    ? `${modUpdateCount} mod update(s) available`
                    : `${issueCount} setup item(s) need attention`
                }
              >
                {badgeFor(entry.id)}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-4">
        {env && (
          <div className="hidden lg:flex items-center gap-3">
            <StatusPill ok={env.steamRunning} label="Steam" />
            <StatusPill ok={env.dayzRunning} label="DayZ" />
          </div>
        )}

        <Button onClick={onManualLaunch} title="Direct connect or launch with your own mods">
          <Icon name="plug" />
          Manual launch
        </Button>

        {tab === "servers" && (
          <Button onClick={onRefresh} disabled={refreshing} title="Refresh the server list">
            {refreshing ? <Spinner /> : <Icon name="refresh" />}
            Refresh
          </Button>
        )}
      </div>
    </header>
  );
}
