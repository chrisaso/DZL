import { useRef, useEffect, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Server } from "../types/server";
import type { SortKey, SortDir } from "../hooks/useFilters";
import type { QueryResult } from "../types/launcher";
import { serverId, formatMap, pingClass } from "../utils/format";
import { Icon } from "./ui";

interface Props {
  servers: Server[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  favorites: Set<string>;
  onFavoriteToggle: (id: string) => void;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  onRefresh: (ip: string, port: number) => Promise<void>;
  onJoin: (server: Server) => void;
  /** Live A2S results keyed by `ip:port`. */
  queryResults: Map<string, QueryResult>;
  /** Fires as the user scrolls so the visible rows can be pinged. */
  onVisibleChange: (servers: Server[]) => void;
}

const COLUMN_COUNT = 8;

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <Icon
      name="star"
      size={13}
      filled={filled}
      className={
        filled
          ? "text-accent"
          : "text-muted group-hover/star:text-secondary transition-colors"
      }
    />
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

/**
 * Player count, preferring the live A2S answer over the master-list record so
 * the count and the queue beside it describe the same moment. A queue only
 * appears once someone is actually waiting.
 */
export function PlayersCell({
  players,
  maxPlayers,
  result,
}: {
  players: number;
  maxPlayers: number;
  result: QueryResult | undefined;
}) {
  const live = result?.online ? result : undefined;
  const count = live?.players ?? players;
  const max = live?.maxPlayers ?? maxPlayers;
  const queue = live?.queue ?? 0;

  const pct = max > 0 ? count / max : 0;
  const colorClass =
    pct >= 1 ? "text-accent" : pct >= 0.8 ? "text-warn" : "text-secondary";
  return (
    <span className="font-mono tabular-nums">
      <span className={colorClass}>{count}</span>
      <span className="text-muted">/{max}</span>
      {queue > 0 && (
        <span
          className="ml-1.5 text-warn"
          title={`${queue} waiting in the login queue`}
        >
          +{queue}
        </span>
      )}
    </span>
  );
}

function PingCell({ result }: { result: QueryResult | undefined }) {
  if (!result) return <span className="text-muted">—</span>;
  if (!result.online)
    return (
      <span className="text-muted" title="No answer on the query port">
        ✕
      </span>
    );
  return (
    <span className={pingClass(result.pingMs)}>{result.pingMs}</span>
  );
}

const SORTABLE_COLS: { key: SortKey; label: string; cls: string }[] = [
  { key: "name", label: "Name", cls: "text-left" },
  { key: "map", label: "Map", cls: "text-left" },
  { key: "players", label: "Players", cls: "text-right" },
  { key: "time", label: "Time", cls: "text-right" },
  { key: "mods", label: "Mods", cls: "text-right" },
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
  onRefresh,
  onJoin,
  queryResults,
  onVisibleChange,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [refreshingIds, setRefreshingIds] = useState<Set<string>>(new Set());
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Reset scroll to top when the row count changes (filter applied, initial
  // load) so the virtualizer doesn't compute against a stale offset. Per-server
  // data patches leave the count unchanged and must not reset scroll.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [servers.length]);

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

  // Ping only what the user can actually see, and only once scrolling settles.
  const firstIndex = virtualItems[0]?.index ?? 0;
  const lastIndex = virtualItems[virtualItems.length - 1]?.index ?? 0;
  useEffect(() => {
    if (servers.length === 0) return;
    const timer = setTimeout(
      () => onVisibleChange(servers.slice(firstIndex, lastIndex + 1)),
      250,
    );
    return () => clearTimeout(timer);
  }, [firstIndex, lastIndex, servers, onVisibleChange]);

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0">
      <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
        {/* Fixed column widths so the header and virtual rows stay aligned */}
        <colgroup>
          <col style={{ width: 36 }} />
          <col />
          <col style={{ width: 132 }} />
          <col style={{ width: 78 }} />
          <col style={{ width: 62 }} />
          <col style={{ width: 56 }} />
          <col style={{ width: 58 }} />
          <col style={{ width: 96 }} />
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
            <th
              className="px-3 py-2.5 font-medium text-xs text-secondary uppercase tracking-wider border-b border-trim text-right"
              title="Live round-trip time to the server's query port"
            >
              Ping
            </th>
            <th className="px-2 py-2.5 border-b border-trim" />
          </tr>
        </thead>

        <tbody>
          {servers.length === 0 && (
            <tr>
              <td
                colSpan={COLUMN_COUNT}
                className="px-4 py-16 text-center text-secondary text-sm"
              >
                No servers match your filters
              </td>
            </tr>
          )}

          {/* Top spacer, fills height of unrendered rows above viewport */}
          {paddingTop > 0 && (
            <tr>
              <td colSpan={COLUMN_COUNT} style={{ height: paddingTop }} />
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
                key={`${id}-${virtualItem.index}`}
                data-selected={isSelected}
                className="server-row group"
                onClick={() => onSelect(id)}
                onDoubleClick={() => onJoin(server)}
              >
                <td className="px-2 py-2 border-b border-trim/40">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onFavoriteToggle(id);
                    }}
                    className="group/star flex items-center justify-center w-6 h-6 rounded hover:bg-overlay transition-colors cursor-pointer"
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

                <td className="px-3 py-2 border-b border-trim/40 text-secondary truncate">
                  {formatMap(server.map)}
                </td>

                <td className="px-3 py-2 border-b border-trim/40 text-right">
                  <PlayersCell
                    players={server.players}
                    maxPlayers={server.maxPlayers}
                    result={queryResults.get(id)}
                  />
                </td>

                <td className="px-3 py-2 border-b border-trim/40 text-right font-mono tabular-nums text-secondary">
                  {server.time}
                </td>

                <td className="px-3 py-2 border-b border-trim/40 text-right font-mono tabular-nums text-muted">
                  {server.mods.length || "—"}
                </td>

                <td className="px-3 py-2 border-b border-trim/40 text-right font-mono tabular-nums">
                  <PingCell result={queryResults.get(id)} />
                </td>

                <td className="px-2 py-2 border-b border-trim/40">
                  <div className="flex items-center gap-1 justify-end">
                    <button
                      aria-label={`Refresh ${server.name}`}
                      title="Refresh server"
                      onClick={async (e) => {
                        e.stopPropagation();
                        setRefreshingIds((prev) => new Set(prev).add(id));
                        try {
                          await onRefresh(server.endpoint.ip, server.endpoint.port);
                        } finally {
                          if (mountedRef.current)
                            setRefreshingIds((prev) => {
                              const next = new Set(prev);
                              next.delete(id);
                              return next;
                            });
                        }
                      }}
                      disabled={refreshingIds.has(id)}
                      className="opacity-0 group-hover:opacity-100 w-7 h-7 flex items-center justify-center rounded-md text-secondary border border-trim/40 hover:border-trim hover:text-primary transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Icon
                        name="refresh"
                        className={refreshingIds.has(id) ? "animate-spin" : ""}
                      />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onJoin(server);
                      }}
                      className="opacity-0 group-hover:opacity-100 px-2.5 py-1 rounded-md text-xs font-semibold bg-accent/10 text-accent border border-accent/25 hover:bg-accent/20 transition-all cursor-pointer"
                      title="Join server"
                      aria-label={`Join ${server.name}`}
                    >
                      Join
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}

          {/* Bottom spacer, fills height of unrendered rows below viewport */}
          {paddingBottom > 0 && (
            <tr>
              <td colSpan={COLUMN_COUNT} style={{ height: paddingBottom }} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
