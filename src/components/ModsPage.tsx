import { openUrl } from "@tauri-apps/plugin-opener";
import { useMemo, useState } from "react";
import { useMods } from "../hooks/useMods";
import type { ModUpdateStatus } from "../types/launcher";
import { formatBytes, timeAgo } from "../utils/format";
import { Banner, Button, Icon, ProgressBar, Spinner, TextInput } from "./ui";

interface ModsPageProps {
  active: boolean;
  updates: Map<string, ModUpdateStatus>;
  outdated: ModUpdateStatus[];
  checkingUpdates: boolean;
  updatesError: string | null;
  lastChecked: number | null;
  onCheckUpdates: () => void;
}

export function ModsPage({
  active,
  updates,
  outdated,
  checkingUpdates,
  updatesError,
  lastChecked,
  onCheckUpdates,
}: ModsPageProps) {
  const {
    library,
    loading,
    error,
    busy,
    progress,
    refresh,
    deleteMods,
    deleteManaged,
    removeAllLinks,
    relinkAll,
    updateMods,
  } = useMods(active);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const mods = useMemo(() => {
    if (!library) return [];
    const q = search.trim().toLowerCase();
    if (!q) return library.mods;
    return library.mods.filter(
      (m) => m.name.toLowerCase().includes(q) || m.workshopId.includes(q),
    );
  }, [library, search]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allShownSelected = mods.length > 0 && mods.every((m) => selected.has(m.workshopId));
  const selectedSize = library
    ? library.mods
        .filter((m) => selected.has(m.workshopId))
        .reduce((sum, m) => sum + m.sizeBytes, 0)
    : 0;

  const disabled = busy !== null;

  /** Re-checks the Workshop afterwards so the flags clear on success. */
  const runUpdate = async (workshopIds: string[]) => {
    const ok = await updateMods(workshopIds);
    if (ok) onCheckUpdates();
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-5 py-3 border-b border-trim flex items-center gap-3 flex-wrap">
        <div className="w-56">
          <TextInput value={search} onChange={setSearch} placeholder="Filter mods…" />
        </div>

        <div className="text-xs text-muted">
          {library ? (
            <>
              <span className="text-secondary">{library.mods.length}</span> mods ·{" "}
              <span className="text-secondary">{formatBytes(library.totalSizeBytes)}</span> ·{" "}
              {library.linkedCount} linked · {library.managedCount} launcher-installed
              {lastChecked && (
                <span className="text-muted"> · checked {timeAgo(lastChecked)}</span>
              )}
            </>
          ) : (
            "—"
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button onClick={onCheckUpdates} disabled={disabled || checkingUpdates}>
            {checkingUpdates ? <Spinner /> : <Icon name="download" />}
            Check updates
          </Button>
          <Button onClick={refresh} disabled={disabled || loading}>
            {loading ? <Spinner /> : <Icon name="refresh" />}
            Rescan
          </Button>
          <Button onClick={relinkAll} disabled={disabled}>
            <Icon name="link" />
            Relink all
          </Button>
          <Button onClick={removeAllLinks} disabled={disabled}>
            Remove links
          </Button>
          <Button variant="danger" onClick={deleteManaged} disabled={disabled}>
            Delete launcher mods
          </Button>
        </div>
      </div>

      {outdated.length > 0 && (
        <div className="px-5 py-2.5 border-b border-trim">
          <Banner
            tone="warn"
            title={`${outdated.length} mod${outdated.length === 1 ? "" : "s"} ${
              outdated.length === 1 ? "has" : "have"
            } an update on the Workshop`}
            action={
              <Button
                variant="secondary"
                disabled={disabled}
                onClick={() => runUpdate(outdated.map((m) => m.workshopId))}
              >
                <Icon name="download" />
                Update all
              </Button>
            }
          >
            {outdated
              .slice(0, 6)
              .map((m) => m.name)
              .join(" · ")}
            {outdated.length > 6 && ` · +${outdated.length - 6} more`}
          </Banner>
        </div>
      )}

      {updatesError && (
        <div className="px-5 py-2.5 border-b border-trim">
          <Banner tone="info" title="Could not check the Workshop for updates">
            {updatesError}
          </Banner>
        </div>
      )}

      {selected.size > 0 && (
        <div className="px-5 py-2 border-b border-trim bg-elevated/60 flex items-center gap-3">
          <span className="text-xs text-secondary">
            {selected.size} selected · {formatBytes(selectedSize)}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button onClick={() => setSelected(new Set())}>Clear</Button>
            <Button
              variant="secondary"
              disabled={disabled}
              onClick={() => runUpdate([...selected])}
            >
              <Icon name="download" />
              Update
            </Button>
            {confirmDelete ? (
              <>
                <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
                <Button
                  variant="danger"
                  disabled={disabled}
                  onClick={async () => {
                    await deleteMods([...selected]);
                    setSelected(new Set());
                    setConfirmDelete(false);
                  }}
                >
                  Delete {selected.size} for good
                </Button>
              </>
            ) : (
              <Button variant="danger" disabled={disabled} onClick={() => setConfirmDelete(true)}>
                <Icon name="trash" />
                Delete
              </Button>
            )}
          </div>
        </div>
      )}

      {busy === "updating" && (
        <div className="px-5 py-3 border-b border-trim space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-2 text-primary">
              <Spinner />
              {progress?.detail ?? "Updating mods…"}
            </span>
            {progress && progress.total > 0 && (
              <span className="font-mono text-muted">
                {progress.current}/{progress.total}
              </span>
            )}
          </div>
          <ProgressBar percent={progress?.percent ?? null} />
        </div>
      )}

      {error && (
        <div className="px-5 py-3">
          <Banner tone="danger" title="Mod operation failed">
            {error}
          </Banner>
        </div>
      )}

      <div className="flex-1 overflow-y-auto min-h-0">
        {library && library.mods.length === 0 && !loading ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-8">
            <p className="text-sm text-primary">No mods installed</p>
            <p className="text-xs text-muted max-w-sm">
              Mods appear here after you join a modded server or subscribe on the
              Steam Workshop. Scanned from {library.workshopPath}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead className="sticky top-0 z-10 bg-surface">
              <tr>
                <th className="w-9 px-2 py-2.5 border-b border-trim">
                  <input
                    type="checkbox"
                    checked={allShownSelected}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked ? new Set(mods.map((m) => m.workshopId)) : new Set(),
                      )
                    }
                    className="w-3.5 h-3.5 rounded accent-accent cursor-pointer"
                  />
                </th>
                <th className="px-3 py-2.5 text-left font-medium text-xs text-secondary uppercase tracking-wider border-b border-trim">
                  Mod
                </th>
                <th className="w-40 px-3 py-2.5 text-left font-medium text-xs text-secondary uppercase tracking-wider border-b border-trim">
                  Source
                </th>
                <th className="w-24 px-3 py-2.5 text-right font-medium text-xs text-secondary uppercase tracking-wider border-b border-trim">
                  Size
                </th>
                <th className="w-16 px-2 py-2.5 border-b border-trim" />
              </tr>
            </thead>
            <tbody>
              {mods.map((mod) => (
                <tr
                  key={mod.workshopId}
                  className="server-row group"
                  onClick={() => toggle(mod.workshopId)}
                >
                  <td className="px-2 py-2 border-b border-trim/40">
                    <input
                      type="checkbox"
                      checked={selected.has(mod.workshopId)}
                      onChange={() => toggle(mod.workshopId)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-3.5 h-3.5 rounded accent-accent cursor-pointer"
                    />
                  </td>
                  <td className="px-3 py-2 border-b border-trim/40">
                    <div className="font-medium text-primary leading-tight truncate">
                      {mod.name}
                    </div>
                    <div className="text-xs text-muted font-mono">{mod.workshopId}</div>
                  </td>
                  <td className="px-3 py-2 border-b border-trim/40">
                    <div className="flex flex-wrap gap-1">
                      {updates.get(mod.workshopId)?.updateAvailable && (
                        <span
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border bg-accent/15 text-accent border-accent/30"
                          title={
                            updates.get(mod.workshopId)?.remoteUpdated
                              ? `Workshop copy published ${timeAgo(
                                  updates.get(mod.workshopId)!.remoteUpdated! * 1000,
                                )}`
                              : "A newer version is on the Workshop"
                          }
                        >
                          <Icon name="download" size={8} />
                          update
                        </span>
                      )}
                      <span
                        className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] border ${
                          mod.managed
                            ? "bg-accent/10 text-accent border-accent/25"
                            : "bg-elevated text-muted border-trim"
                        }`}
                      >
                        {mod.managed ? "launcher" : "steam"}
                      </span>
                      {!mod.linked && (
                        <span
                          className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] border bg-warn/10 text-warn border-warn/25"
                          title="No @mod symlink in the DayZ folder — use Relink all"
                        >
                          not linked
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 border-b border-trim/40 text-right font-mono tabular-nums text-secondary">
                    {formatBytes(mod.sizeBytes)}
                  </td>
                  <td className="px-2 py-2 border-b border-trim/40 text-right">
                    <button
                      title="Open workshop page"
                      onClick={(e) => {
                        e.stopPropagation();
                        openUrl(
                          `https://steamcommunity.com/sharedfiles/filedetails/?id=${mod.workshopId}`,
                        );
                      }}
                      className="opacity-0 group-hover:opacity-100 w-7 h-7 inline-flex items-center justify-center rounded-md text-secondary border border-trim/40 hover:border-trim hover:text-primary transition-all cursor-pointer"
                    >
                      <Icon name="external" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
