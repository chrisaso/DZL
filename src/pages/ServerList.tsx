import { useEffect, useState } from "react";
import { useServerStore } from "../store/serverStore";
import { useFavorites } from "../hooks/useFavorites";
import { useFilters } from "../hooks/useFilters";
import { Sidebar } from "../components/Sidebar";
import { ServerTable } from "../components/ServerTable";
import { ServerDetail } from "../components/ServerDetail";
import { serverId } from "../utils/format";

function SkeletonRow() {
  return (
    <tr>
      <td className="w-9 px-2 py-2.5 border-b border-trim/40">
        <div className="skeleton w-5 h-5 mx-auto" />
      </td>
      <td className="px-3 py-2.5 border-b border-trim/40">
        <div className="skeleton h-3.5 w-3/4 mb-1.5" />
        <div className="skeleton h-2.5 w-1/3" />
      </td>
      <td className="w-36 px-3 py-2.5 border-b border-trim/40">
        <div className="skeleton h-3.5 w-20" />
      </td>
      <td className="w-20 px-3 py-2.5 border-b border-trim/40">
        <div className="skeleton h-3.5 w-12 ml-auto" />
      </td>
      <td className="w-16 px-3 py-2.5 border-b border-trim/40">
        <div className="skeleton h-3.5 w-10 ml-auto" />
      </td>
      <td className="w-16 px-3 py-2.5 border-b border-trim/40">
        <div className="skeleton h-3.5 w-6 ml-auto" />
      </td>
      <td className="w-20 px-2 py-2.5 border-b border-trim/40" />
    </tr>
  );
}

function LoadingTable() {
  return (
    <div className="flex-1 overflow-y-auto min-h-0">
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-10 bg-surface">
          <tr>
            <th className="w-9 px-2 py-2.5 border-b border-trim" />
            {["Name", "Map", "Players", "Time", "Ping"].map((h) => (
              <th
                key={h}
                className="px-3 py-2.5 font-medium text-xs text-secondary uppercase tracking-wider border-b border-trim text-left"
              >
                {h}
              </th>
            ))}
            <th className="w-20 px-2 py-2.5 border-b border-trim" />
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 18 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ErrorState({
  error,
  onRetry,
}: {
  error: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8">
      <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="text-accent"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <div>
        <p className="text-sm font-medium text-primary mb-1">
          Failed to load servers
        </p>
        <p className="text-xs text-muted max-w-xs">{error}</p>
      </div>
      <button
        onClick={onRetry}
        className="px-4 py-1.5 rounded-md text-sm font-medium bg-accent/10 text-accent border border-accent/25 hover:bg-accent/20 transition-colors cursor-pointer"
      >
        Try again
      </button>
    </div>
  );
}

export function ServerList() {
  const { servers, loading, refreshing, error, fetchServers, refreshServer } =
    useServerStore();
  const { favorites, toggle, isFavorite } = useFavorites();
  const { filters, updateFilter, filtered, maps, versions, sortKey, sortDir, setSort, resetFilters } =
    useFilters(servers, favorites);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  const selectedServer =
    selectedId != null
      ? filtered.find((s) => serverId(s) === selectedId) ?? null
      : null;

  function handleSelect(id: string) {
    setSelectedId((prev) => (prev === id ? null : id));
  }

  return (
    <div className="flex h-full w-full overflow-hidden bg-base">
      <Sidebar
        filters={filters}
        updateFilter={updateFilter}
        maps={maps}
        versions={versions}
        totalCount={servers.length}
        filteredCount={filtered.length}
        refreshing={refreshing}
        onReset={resetFilters}
      />

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {loading && <LoadingTable />}
        {!loading && error && (
          <ErrorState error={error} onRetry={fetchServers} />
        )}
        {!loading && !error && (
          <ServerTable
            servers={filtered}
            selectedId={selectedId}
            onSelect={handleSelect}
            favorites={favorites}
            onFavoriteToggle={toggle}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={setSort}
            onRefresh={refreshServer}
          />
        )}

        {selectedServer && (
          <ServerDetail
            server={selectedServer}
            isFavorite={isFavorite(serverId(selectedServer))}
            onFavoriteToggle={toggle}
            onRefresh={() => refreshServer(selectedServer!.endpoint.ip, selectedServer!.endpoint.port)}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>
    </div>
  );
}
