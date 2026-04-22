import { useRef, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Server } from "../types/server";
import type { SortKey, SortDir } from "../hooks/useFilters";
import { serverId, formatMap } from "../utils/format";

interface Props {
  servers: Server[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  favorites: Set<string>;
  onFavoriteToggle: (id: string) => void;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={
        filled
          ? "text-accent"
          : "text-muted group-hover/star:text-secondary transition-colors"
      }
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

function SortArrow({
  col,
  sortKey,
  sortDir,
}: {
  col: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
}) {
  if (col !== sortKey)
    return <span className="ml-1 opacity-30 text-[10px]">↕</span>;
  return (
    <span className="ml-1 text-accent text-[10px]">
      {sortDir === "asc" ? "↑" : "↓"}
    </span>
  );
}

function PlayersCell({
  players,
  maxPlayers,
}: {
  players: number;
  maxPlayers: number;
}) {
  const pct = maxPlayers > 0 ? players / maxPlayers : 0;
  const colorClass =
    pct >= 1 ? "text-accent" : pct >= 0.8 ? "text-warn" : "text-secondary";
  return (
    <span className="font-mono tabular-nums">
      <span className={colorClass}>{players}</span>
      <span className="text-muted">/{maxPlayers}</span>
    </span>
  );
}

const SORTABLE_COLS: { key: SortKey; label: string; cls: string }[] = [
  { key: "name", label: "Name", cls: "text-left" },
  { key: "map", label: "Map", cls: "text-left" },
  { key: "players", label: "Players", cls: "text-right" },
  { key: "time", label: "Time", cls: "text-right" },
];

export function ServerTable({
  servers,
  selectedId,
  onSelect,
  favorites,
  onFavoriteToggle,
  sortKey,
  sortDir,
  onSort,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Reset scroll to top after every list change so the virtualizer doesn't
  // compute a virtual window at a stale offset when the list shrinks.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [servers]);

  const virtualizer = useVirtualizer({
    count: servers.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 50,
    overscan: 8,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom =
    virtualItems.length > 0
      ? virtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end
      : 0;

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0">
      <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
        {/* Fixed column widths so the header and virtual rows stay aligned */}
        <colgroup>
          <col style={{ width: 36 }} />
          <col />
          <col style={{ width: 144 }} />
          <col style={{ width: 80 }} />
          <col style={{ width: 64 }} />
          <col style={{ width: 64 }} />
          <col style={{ width: 80 }} />
        </colgroup>

        <thead className="sticky top-0 z-10 bg-surface">
          <tr>
            <th className="px-2 py-2.5 border-b border-trim" />
            {SORTABLE_COLS.map((col) => (
              <th
                key={col.key}
                className={`px-3 py-2.5 font-medium text-xs text-secondary uppercase tracking-wider border-b border-trim select-none cursor-pointer hover:text-primary transition-colors ${col.cls}`}
                onClick={() => onSort(col.key)}
              >
                {col.label}
                <SortArrow col={col.key} sortKey={sortKey} sortDir={sortDir} />
              </th>
            ))}
            <th className="px-3 py-2.5 font-medium text-xs text-secondary uppercase tracking-wider border-b border-trim text-right">
              Ping
            </th>
            <th className="px-2 py-2.5 border-b border-trim" />
          </tr>
        </thead>

        <tbody>
          {servers.length === 0 && (
            <tr>
              <td
                colSpan={7}
                className="px-4 py-16 text-center text-secondary text-sm"
              >
                No servers match your filters
              </td>
            </tr>
          )}

          {/* Top spacer — fills height of unrendered rows above viewport */}
          {paddingTop > 0 && (
            <tr>
              <td colSpan={7} style={{ height: paddingTop }} />
            </tr>
          )}

          {virtualItems.map((virtualItem) => {
            const server = servers[virtualItem.index];
            if (!server) return null;
            const id = serverId(server);
            const isFav = favorites.has(id);
            const isSelected = selectedId === id;

            return (
              <tr
                key={id}
                data-selected={isSelected}
                className="server-row group"
                onClick={() => onSelect(id)}
              >
                <td className="px-2 py-2 border-b border-trim/40">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onFavoriteToggle(id);
                    }}
                    className="group/star flex items-center justify-center w-6 h-6 rounded hover:bg-overlay transition-colors"
                    aria-label={
                      isFav ? "Remove from favourites" : "Add to favourites"
                    }
                  >
                    <StarIcon filled={isFav} />
                  </button>
                </td>

                <td className="px-3 py-2 border-b border-trim/40 max-w-0">
                  <div className="truncate font-medium text-primary leading-tight">
                    {server.name}
                  </div>
                  <div className="text-xs text-muted font-mono mt-0.5 truncate">
                    {server.endpoint.ip}:{server.endpoint.port}
                  </div>
                </td>

                <td className="px-3 py-2 border-b border-trim/40 text-secondary">
                  {formatMap(server.map)}
                </td>

                <td className="px-3 py-2 border-b border-trim/40 text-right">
                  <PlayersCell
                    players={server.players}
                    maxPlayers={server.maxPlayers}
                  />
                </td>

                <td className="px-3 py-2 border-b border-trim/40 text-right font-mono tabular-nums text-secondary">
                  {server.time}
                </td>

                <td className="px-3 py-2 border-b border-trim/40 text-right font-mono text-muted">
                  —
                </td>

                <td className="px-2 py-2 border-b border-trim/40">
                  <button
                    className="opacity-0 group-hover:opacity-100 w-full px-2.5 py-1 rounded-md text-xs font-semibold bg-accent/10 text-accent border border-accent/25 hover:bg-accent/20 transition-all cursor-pointer"
                    title="Join server"
                  >
                    Join
                  </button>
                </td>
              </tr>
            );
          })}

          {/* Bottom spacer — fills height of unrendered rows below viewport */}
          {paddingBottom > 0 && (
            <tr>
              <td colSpan={7} style={{ height: paddingBottom }} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
