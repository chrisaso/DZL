import type { Server } from "../types/server";
import { serverId, formatMap } from "../utils/format";

interface Props {
  server: Server;
  isFavorite: boolean;
  onFavoriteToggle: (id: string) => void;
  onRefresh: () => void;
  onClose: () => void;
}

function Badge({
  label,
  active,
}: {
  label: string;
  active: boolean;
}) {
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
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted uppercase tracking-wider">{label}</span>
      <span className="text-sm text-primary font-medium">{value}</span>
    </div>
  );
}

export function ServerDetail({
  server,
  isFavorite,
  onFavoriteToggle,
  onRefresh,
  onClose,
}: Props) {
  const id = serverId(server);
  const playerPct =
    server.maxPlayers > 0
      ? Math.min(1, server.players / server.maxPlayers)
      : 0;
  const barColor =
    playerPct >= 1
      ? "bg-accent"
      : playerPct >= 0.8
        ? "bg-warn"
        : "bg-good";

  return (
    <div className="border-t border-trim bg-surface flex flex-col" style={{ height: "272px" }}>
      {/* Header row */}
      <div className="flex items-start justify-between px-4 pt-3 pb-2 gap-4">
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-primary truncate leading-snug">
            {server.name}
          </h2>
          <p className="text-xs text-muted font-mono mt-0.5">
            {server.endpoint.ip}:{server.endpoint.port}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Favourite */}
          <button
            onClick={() => onFavoriteToggle(id)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs border border-trim hover:border-accent/30 hover:text-accent transition-colors cursor-pointer text-secondary"
            title={isFavorite ? "Remove from favourites" : "Add to favourites"}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill={isFavorite ? "currentColor" : "none"}
              stroke="currentColor"
              strokeWidth="1.5"
              className={isFavorite ? "text-accent" : ""}
            >
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            {isFavorite ? "Unfavourite" : "Favourite"}
          </button>

          {/* Refresh */}
          <button
            onClick={onRefresh}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs border border-trim hover:border-trim/60 hover:text-primary transition-colors cursor-pointer text-secondary"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
            Refresh
          </button>

          {/* Join */}
          <button
            title="Join server"
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-semibold bg-accent text-white hover:bg-accent-dim transition-colors cursor-pointer"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            Join Server
          </button>

          {/* Close */}
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-md text-muted hover:text-primary hover:bg-elevated transition-colors cursor-pointer"
            title="Close"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 min-h-0 gap-6 px-4 pb-3 overflow-hidden">
        {/* Left: stats */}
        <div className="flex flex-col gap-3 w-64 shrink-0">
          {/* Players bar */}
          <div>
            <div className="flex justify-between items-baseline mb-1">
              <span className="text-xs text-muted uppercase tracking-wider">Players</span>
              <span className="text-xs font-mono text-secondary">
                {server.players} / {server.maxPlayers}
              </span>
            </div>
            <div className="h-1.5 bg-elevated rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${barColor}`}
                style={{ width: `${playerPct * 100}%` }}
              />
            </div>
          </div>

          {/* Info grid */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
            <InfoItem label="Map" value={formatMap(server.map)} />
            <InfoItem label="Time" value={server.time} />
            <InfoItem label="Version" value={server.version} />
            <InfoItem label="Shard" value={server.shard} />
          </div>

          {/* Badges */}
          <div className="flex flex-wrap gap-1.5">
            <Badge label="VAC" active={server.vac} />
            <Badge label="BattlEye" active={server.battlEye} />
            <Badge label="1PP" active={server.firstPersonOnly} />
            <Badge label="Password" active={server.password} />
          </div>
        </div>

        {/* Right: mods */}
        <div className="flex-1 min-w-0 flex flex-col">
          <p className="text-xs text-muted uppercase tracking-wider mb-1.5">
            Mods{" "}
            <span className="normal-case text-muted">
              ({server.mods.length})
            </span>
          </p>
          {server.mods.length === 0 ? (
            <p className="text-sm text-muted italic">Vanilla — no mods</p>
          ) : (
            <div className="flex-1 overflow-y-auto">
              <div className="flex flex-wrap gap-1">
                {server.mods.map((mod) => (
                  <span
                    key={mod.steamWorkshopId}
                    className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-elevated text-secondary border border-trim/60 hover:border-trim transition-colors"
                    title={`Workshop ID: ${mod.steamWorkshopId}`}
                  >
                    {mod.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
