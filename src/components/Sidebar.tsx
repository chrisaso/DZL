import type { Filters, ServerView } from "../hooks/useFilters";
import { formatMap } from "../utils/format";
import { CheckRow, SegmentedControl, Select, TextInput } from "./ui";

interface Props {
  filters: Filters;
  updateFilter: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
  maps: string[];
  versions: string[];
  totalCount: number;
  filteredCount: number;
  favoriteCount: number;
  recentCount: number;
  activeFilterCount: number;
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
  favoriteCount,
  recentCount,
  activeFilterCount,
  onReset,
}: Props) {
  return (
    <aside className="w-60 shrink-0 flex flex-col bg-surface border-r border-trim overflow-hidden">
      <div className="px-3 pt-3 pb-3 border-b border-trim space-y-2">
        <SegmentedControl<ServerView>
          value={filters.view}
          onChange={(view) => updateFilter("view", view)}
          options={[
            { value: "all", label: "All" },
            { value: "favorites", label: "Saved", count: favoriteCount },
            { value: "recent", label: "Recent", count: recentCount },
          ]}
        />
        <p className="text-xs text-muted">
          {filteredCount.toLocaleString()}
          {filteredCount !== totalCount && (
            <span> / {totalCount.toLocaleString()}</span>
          )}{" "}
          servers
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        <div>
          <Label>Search</Label>
          <TextInput
            value={filters.search}
            onChange={(v) => updateFilter("search", v)}
            placeholder="Server name…"
          />
        </div>

        <div>
          <Label>Mod</Label>
          <TextInput
            value={filters.modSearch}
            onChange={(v) => updateFilter("modSearch", v)}
            placeholder="Mod name or ID…"
          />
        </div>

        <div>
          <Label>Map</Label>
          <Select
            value={filters.map}
            onChange={(v) => updateFilter("map", v)}
            options={[
              { value: "", label: "All maps" },
              ...maps.map((m) => ({ value: m, label: formatMap(m) })),
            ]}
          />
        </div>

        <div>
          <Label>Version</Label>
          <Select
            value={filters.version}
            onChange={(v) => updateFilter("version", v)}
            options={[
              { value: "", label: "All versions" },
              ...versions.map((v) => ({ value: v, label: v })),
            ]}
          />
        </div>

        <div>
          <Label>Type</Label>
          <Select
            value={filters.shard}
            onChange={(v) => updateFilter("shard", v as Filters["shard"])}
            options={[
              { value: "", label: "Official & community" },
              { value: "public", label: "Official only" },
              { value: "private", label: "Community only" },
            ]}
          />
        </div>

        <div>
          <Label>Host</Label>
          <Select
            value={filters.platform}
            onChange={(v) => updateFilter("platform", v as Filters["platform"])}
            options={[
              { value: "", label: "Any platform" },
              { value: "l", label: "Linux servers" },
              { value: "w", label: "Windows servers" },
            ]}
          />
        </div>

        <div>
          <Label>In-game time</Label>
          <Select
            value={filters.timeOfDay}
            onChange={(v) => updateFilter("timeOfDay", v as Filters["timeOfDay"])}
            options={[
              { value: "", label: "Any time" },
              { value: "day", label: "Daytime" },
              { value: "night", label: "Night" },
            ]}
          />
        </div>

        <div>
          <Label>Perspective</Label>
          <Select
            value={filters.perspective}
            onChange={(v) => updateFilter("perspective", v as Filters["perspective"])}
            options={[
              { value: "", label: "First & third person" },
              { value: "first", label: "First person only" },
              { value: "third", label: "Third person allowed" },
            ]}
          />
        </div>

        <div>
          <Label>Mods</Label>
          <Select
            value={filters.mods}
            onChange={(v) => updateFilter("mods", v as Filters["mods"])}
            options={[
              { value: "", label: "Modded & vanilla" },
              { value: "modded", label: "Modded only" },
              { value: "vanilla", label: "Vanilla only" },
            ]}
          />
        </div>

        <div>
          <Label>Password</Label>
          <Select
            value={filters.password}
            onChange={(v) => updateFilter("password", v as Filters["password"])}
            options={[
              { value: "", label: "Any" },
              { value: "open", label: "Open servers" },
              { value: "protected", label: "Password protected" },
            ]}
          />
        </div>

        <div>
          <Label>Options</Label>
          <div className="space-y-2.5">
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
              label="BattlEye"
              checked={filters.battlEyeOnly}
              onChange={(v) => updateFilter("battlEyeOnly", v)}
            />
            <CheckRow
              label="VAC"
              checked={filters.vacOnly}
              onChange={(v) => updateFilter("vacOnly", v)}
            />
          </div>
        </div>
      </div>

      <div className="px-3 py-3 border-t border-trim">
        <button
          onClick={onReset}
          disabled={activeFilterCount === 0}
          className="w-full py-1.5 rounded-md text-xs font-medium text-secondary hover:text-primary border border-trim hover:border-trim/60 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Reset filters
          {activeFilterCount > 0 && (
            <span className="ml-1 text-muted">({activeFilterCount})</span>
          )}
        </button>
      </div>
    </aside>
  );
}
