import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import type { QueryResult } from "../types/launcher";
import type { Server } from "../types/server";
import { serverId, formatMap, pingClass } from "../utils/format";
import { Button, Icon } from "./ui";

interface Props {
  server: Server;
  isFavorite: boolean;
  onFavoriteToggle: (id: string) => void;
  onRefresh: () => Promise<void>;
  onClose: () => void;
  onJoin: (server: Server) => void;
  queryResult: QueryResult | undefined;
  /** Workshop ids present in the local library. */
  installedMods: Set<string>;
}

function Badge({ label, active }: { label: string; active: boolean }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${
        active
          ? "bg-good/10 text-good border-good/20"
          : "bg-elevated text-muted border-trim"
      }`}
    >
      {label}
    </span>
  );
}

function InfoItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-xs text-muted uppercase tracking-wider">{label}</span>
      <span className="text-sm text-primary font-medium truncate">{value}</span>
    </div>
  );
}

export function ServerDetail({
  server,
  isFavorite,
  onFavoriteToggle,
  onRefresh,
  onClose,
  onJoin,
  queryResult,
  installedMods,
}: Props) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [country, setCountry] = useState<string | null>(null);

  const id = serverId(server);
  const ip = server.endpoint.ip;

  useEffect(() => {
    let cancelled = false;
    setCountry(null);
    invoke<string | null>("lookup_country", { ip })
      .then((result) => {
        if (!cancelled) setCountry(result);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [ip]);

  const players = queryResult?.online ? queryResult.players ?? server.players : server.players;
  const maxPlayers = queryResult?.maxPlayers ?? server.maxPlayers;
  const playerPct = maxPlayers > 0 ? Math.min(1, players / maxPlayers) : 0;
  const barColor =
    playerPct >= 1 ? "bg-accent" : playerPct >= 0.8 ? "bg-warn" : "bg-good";

  const missingCount = server.mods.filter(
    (m) => !installedMods.has(String(m.steamWorkshopId)),
  ).length;

  return (
    <div className="border-t border-trim bg-surface flex flex-col" style={{ height: "288px" }}>
      <div className="flex items-start justify-between px-4 pt-3 pb-2 gap-4">
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-primary truncate leading-snug">
            {server.name}
          </h2>
          <p className="text-xs text-muted font-mono mt-0.5">
            {ip}:{server.endpoint.port}
            <span className="text-trim"> · </span>
            game {server.gamePort}
            {country && (
              <>
                <span className="text-trim"> · </span>
                {country}
              </>
            )}
            {queryResult?.online && queryResult.pingMs !== null && (
              <>
                <span className="text-trim"> · </span>
                <span className={pingClass(queryResult.pingMs)}>
                  {queryResult.pingMs} ms
                </span>
              </>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            onClick={() => onFavoriteToggle(id)}
            title={isFavorite ? "Remove from favourites" : "Add to favourites"}
          >
            <Icon name="star" filled={isFavorite} className={isFavorite ? "text-accent" : ""} />
            {isFavorite ? "Saved" : "Save"}
          </Button>

          <Button
            onClick={() =>
              openUrl(`https://www.battlemetrics.com/servers/dayz?q=${ip}`)
            }
            title="Look this server up on BattleMetrics"
          >
            <Icon name="external" />
            Stats
          </Button>

          <Button
            disabled={isRefreshing}
            onClick={async () => {
              setIsRefreshing(true);
              try {
                await onRefresh();
              } finally {
                setIsRefreshing(false);
              }
            }}
          >
            <Icon name="refresh" className={isRefreshing ? "animate-spin" : ""} />
            Refresh
          </Button>

          <Button variant="primary" onClick={() => onJoin(server)} title="Join server">
            <Icon name="play" filled />
            Join Server
          </Button>

          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-md text-muted hover:text-primary hover:bg-elevated transition-colors cursor-pointer"
            title="Close"
          >
            <Icon name="close" />
          </button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0 gap-6 px-4 pb-3 overflow-hidden">
        <div className="flex flex-col gap-3 w-64 shrink-0">
          <div>
            <div className="flex justify-between items-baseline mb-1">
              <span className="text-xs text-muted uppercase tracking-wider">
                Players
                {queryResult?.online && (
                  <span className="ml-1 normal-case text-good">live</span>
                )}
              </span>
              <span className="text-xs font-mono text-secondary">
                {players} / {maxPlayers}
              </span>
            </div>
            <div className="h-1.5 bg-elevated rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${barColor}`}
                style={{ width: `${playerPct * 100}%` }}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
            <InfoItem label="Map" value={formatMap(server.map)} />
            <InfoItem label="Time" value={`${server.time} ×${server.timeAcceleration}`} />
            <InfoItem label="Version" value={server.version} />
            <InfoItem
              label="Type"
              value={server.shard === "public" ? "Official" : "Community"}
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            <Badge label="VAC" active={server.vac} />
            <Badge label="BattlEye" active={server.battlEye} />
            <Badge label="1PP" active={server.firstPersonOnly} />
            <Badge label="Password" active={server.password} />
            <Badge label={server.environment === "l" ? "Linux" : "Windows"} active />
          </div>
        </div>

        <div className="flex-1 min-w-0 flex flex-col">
          <p className="text-xs text-muted uppercase tracking-wider mb-1.5">
            Mods{" "}
            <span className="normal-case text-muted">({server.mods.length})</span>
            {missingCount > 0 && (
              <span className="ml-2 normal-case text-warn">
                {missingCount} to download
              </span>
            )}
            {server.mods.length > 0 && missingCount === 0 && (
              <span className="ml-2 normal-case text-good">all installed</span>
            )}
          </p>
          {server.mods.length === 0 ? (
            <p className="text-sm text-muted italic">Vanilla — no mods</p>
          ) : (
            <div className="flex-1 overflow-y-auto">
              <div className="flex flex-wrap gap-1">
                {server.mods.map((mod) => {
                  const installed = installedMods.has(String(mod.steamWorkshopId));
                  return (
                    <button
                      key={mod.steamWorkshopId}
                      onClick={() =>
                        openUrl(
                          `https://steamcommunity.com/sharedfiles/filedetails/?id=${mod.steamWorkshopId}`,
                        )
                      }
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border transition-colors cursor-pointer ${
                        installed
                          ? "bg-elevated text-secondary border-trim/60 hover:border-trim"
                          : "bg-warn/5 text-warn border-warn/25 hover:border-warn/50"
                      }`}
                      title={`${installed ? "Installed" : "Not installed"} · ${mod.steamWorkshopId}`}
                    >
                      {installed && <Icon name="check" size={9} />}
                      {mod.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
