import type { Filters } from "../hooks/useFilters";
import { formatMap } from "../utils/format";

interface Props {
  filters: Filters;
  updateFilter: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
  maps: string[];
  versions: string[];
  totalCount: number;
  filteredCount: number;
  refreshing: boolean;
  onReset: () => void;
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold text-muted uppercase tracking-widest mb-1.5">
      {children}
    </p>
  );
}

export function Sidebar({
  filters,
  updateFilter,
  maps,
  versions,
  totalCount,
  filteredCount,
  refreshing,
  onReset,
}: Props) {
  return (
    <aside className="w-56 shrink-0 flex flex-col bg-surface border-r border-trim overflow-hidden">
      {/* Branding */}
      <div className="px-4 pt-5 pb-4 border-b border-trim">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-md bg-accent flex items-center justify-center text-white font-bold text-sm leading-none select-none">
            Z
          </div>
          <span className="font-semibold text-sm tracking-wide text-primary">
            ZedLauncher
          </span>
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          <p className="text-xs text-muted">
            {filteredCount.toLocaleString()}
            {filteredCount !== totalCount && (
              <span> / {totalCount.toLocaleString()}</span>
            )}{" "}
            servers
          </p>
          {refreshing && (
            <span className="text-xs text-muted animate-pulse">· syncing</span>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {/* Search */}
        <div>
          <Label>Search</Label>
          <input
            type="text"
            placeholder="Server name…"
            value={filters.search}
            onChange={(e) => updateFilter("search", e.target.value)}
            className="w-full px-2.5 py-1.5 rounded-md bg-elevated border border-trim text-sm text-primary focus:outline-none focus:border-accent transition-colors"
          />
        </div>

        {/* Map */}
        <div>
          <Label>Map</Label>
          <select
            value={filters.map}
            onChange={(e) => updateFilter("map", e.target.value)}
            className="w-full px-2.5 py-1.5 rounded-md bg-elevated border border-trim text-sm text-primary focus:outline-none focus:border-accent transition-colors appearance-none cursor-pointer"
          >
            <option value="">All maps</option>
            {maps.map((m) => (
              <option key={m} value={m}>
                {formatMap(m)}
              </option>
            ))}
          </select>
        </div>

        {/* Version */}
        <div>
          <Label>Version</Label>
          <select
            value={filters.version}
            onChange={(e) => updateFilter("version", e.target.value)}
            className="w-full px-2.5 py-1.5 rounded-md bg-elevated border border-trim text-sm text-primary focus:outline-none focus:border-accent transition-colors appearance-none cursor-pointer"
          >
            <option value="">All versions</option>
            {versions.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>

        {/* Checkboxes */}
        <div>
          <Label>Options</Label>
          <div className="space-y-2.5">
            <CheckRow
              label="Favourites only"
              checked={filters.favoritesOnly}
              onChange={(v) => updateFilter("favoritesOnly", v)}
            />
            <CheckRow
              label="Hide full servers"
              checked={filters.hideFull}
              onChange={(v) => updateFilter("hideFull", v)}
            />
            <CheckRow
              label="Hide empty servers"
              checked={filters.hideEmpty}
              onChange={(v) => updateFilter("hideEmpty", v)}
            />
            <CheckRow
              label="Password protected"
              checked={filters.passwordProtected}
              onChange={(v) => updateFilter("passwordProtected", v)}
            />
            <CheckRow
              label="Modded only"
              checked={filters.moddedOnly}
              onChange={(v) => updateFilter("moddedOnly", v)}
            />
          </div>
        </div>
      </div>

      {/* Reset */}
      <div className="px-3 py-3 border-t border-trim">
        <button
          onClick={onReset}
          className="w-full py-1.5 rounded-md text-xs font-medium text-secondary hover:text-primary border border-trim hover:border-trim/60 transition-colors cursor-pointer"
        >
          Reset filters
        </button>
      </div>
    </aside>
  );
}

function CheckRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer group">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-3.5 h-3.5 rounded accent-accent cursor-pointer"
      />
      <span className="text-sm text-secondary group-hover:text-primary transition-colors">
        {label}
      </span>
    </label>
  );
}
