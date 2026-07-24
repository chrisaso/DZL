import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import type { JoinProgress, JoinRequest, ModRef } from "../types/launcher";
import {
  Banner,
  Button,
  Field,
  Icon,
  Modal,
  ProgressBar,
  SegmentedControl,
  Spinner,
  TextInput,
} from "./ui";

type Mode = "connect" | "launch";

/**
 * dayz-ctl's "Direct Connect" and "Launch Game" in one panel: connect to a
 * server the master list doesn't know about, or start the game with a
 * hand-picked mod set.
 */
export function ManualLaunchModal({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<Mode>("connect");
  const [ip, setIp] = useState("");
  const [port, setPort] = useState("2302");
  const [password, setPassword] = useState("");
  const [installed, setInstalled] = useState<ModRef[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [progress, setProgress] = useState<JoinProgress | null>(null);
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const unlistenRef = useRef<UnlistenFn | null>(null);

  useEffect(() => {
    invoke<ModRef[]>("list_mod_refs", { steamPath: null })
      .then(setInstalled)
      .catch(() => setInstalled([]));
    return () => unlistenRef.current?.();
  }, []);

  const shown = search.trim()
    ? installed.filter(
        (m) =>
          m.name.toLowerCase().includes(search.trim().toLowerCase()) ||
          m.workshopId.includes(search.trim()),
      )
    : installed;

  const launch = async () => {
    setStatus("running");
    setError("");
    setProgress(null);

    unlistenRef.current?.();
    unlistenRef.current = await listen<JoinProgress>("join-progress", (event) => {
      if (event.payload.step === "done" || event.payload.step === "error") return;
      setProgress(event.payload);
    });

    const mods = installed.filter((m) => selected.has(m.workshopId));
    const request: JoinRequest = {
      ip: mode === "connect" ? ip.trim() : null,
      gamePort: mode === "connect" ? Number.parseInt(port, 10) || 2302 : null,
      mods,
      password: mode === "connect" && password.trim() ? password : null,
      // Nothing to download: only mods already on disk can be picked here.
      updateMods: false,
    };

    try {
      await invoke("join_server", { request });
      setStatus("done");
    } catch (e) {
      setError(String(e));
      setStatus("error");
    } finally {
      unlistenRef.current?.();
      unlistenRef.current = null;
    }
  };

  const canLaunch = mode === "launch" || ip.trim().length > 0;

  if (status === "running") {
    return (
      <Modal title="Launching DayZ">
        <div className="py-2 space-y-3">
          <p className="flex items-center gap-2 text-sm text-primary">
            <Spinner />
            {progress?.step === "waiting" ? "Waiting for DayZ to start" : "Starting DayZ"}
          </p>
          <ProgressBar percent={null} />
          {progress?.detail && (
            <p className="text-xs text-secondary truncate">{progress.detail}</p>
          )}
        </div>
      </Modal>
    );
  }

  if (status === "done") {
    return (
      <Modal
        title="DayZ is starting"
        onClose={onClose}
        footer={
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        }
      >
        <p className="flex items-center gap-2 text-sm text-good py-3">
          <Icon name="check" size={16} />
          {mode === "connect" ? `Connecting to ${ip}:${port}` : "Launched"}
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      title="Manual launch"
      subtitle="Connect by address, or start the game with your own mod set"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!canLaunch} onClick={launch}>
            <Icon name="play" filled />
            {mode === "connect" ? "Connect" : "Launch DayZ"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <SegmentedControl<Mode>
          value={mode}
          onChange={setMode}
          options={[
            { value: "connect", label: "Connect to address" },
            { value: "launch", label: "Just launch the game" },
          ]}
        />

        {status === "error" && (
          <Banner tone="danger" title="Launch failed">
            {error}
          </Banner>
        )}

        {mode === "connect" && (
          <div className="grid grid-cols-[1fr_120px] gap-3">
            <Field label="Server address">
              <TextInput value={ip} onChange={setIp} placeholder="192.0.2.10" />
            </Field>
            <Field label="Game port">
              <TextInput value={port} onChange={setPort} placeholder="2302" />
            </Field>
            <div className="col-span-2">
              <Field label="Password" hint="Leave empty for open servers.">
                <TextInput
                  type="password"
                  value={password}
                  onChange={setPassword}
                  placeholder="Optional"
                />
              </Field>
            </div>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold text-muted uppercase tracking-widest">
              Mods ({selected.size} of {installed.length})
            </span>
            <div className="flex items-center gap-2">
              <div className="w-40">
                <TextInput value={search} onChange={setSearch} placeholder="Filter…" />
              </div>
              <Button onClick={() => setSelected(new Set())}>Clear</Button>
            </div>
          </div>

          {installed.length === 0 ? (
            <p className="text-xs text-muted py-3">
              No mods installed yet — the game will start vanilla.
            </p>
          ) : (
            <div className="max-h-56 overflow-y-auto border border-trim rounded-md divide-y divide-trim/40">
              {shown.map((mod) => (
                <label
                  key={mod.workshopId}
                  className="flex items-center gap-2.5 px-3 py-1.5 cursor-pointer hover:bg-elevated transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(mod.workshopId)}
                    onChange={() =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (next.has(mod.workshopId)) next.delete(mod.workshopId);
                        else next.add(mod.workshopId);
                        return next;
                      })
                    }
                    className="w-3.5 h-3.5 rounded accent-accent cursor-pointer"
                  />
                  <span className="text-sm text-secondary truncate flex-1">{mod.name}</span>
                  <span className="text-xs font-mono text-muted">{mod.workshopId}</span>
                </label>
              ))}
            </div>
          )}
          <p className="text-xs text-muted mt-1.5">
            Mod order follows this list. Only mods already installed can be picked.
          </p>
        </div>
      </div>
    </Modal>
  );
}
