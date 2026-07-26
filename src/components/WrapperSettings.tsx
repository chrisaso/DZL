import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import type {
  AppConfig,
  DisplayMode,
  WrapperConfig,
  WrapperStatus,
} from "../types/launcher";
import { StatusRow } from "./SettingsPage";
import {
  Banner,
  Button,
  CheckRow,
  Code,
  Field,
  SegmentedControl,
  Spinner,
  TextArea,
  TextInput,
} from "./ui";

const HOOK_WORDS: Record<WrapperStatus["hook"], string> = {
  notInstalled: "not installed",
  installed: "installed",
  changed: "not pointing at DZL",
  unreadable: "Steam's config could not be read",
};

/**
 * A labelled block for content that is not a form control, so buttons and copy
 * targets are not wrapped in a `<label>`.
 */
function Group({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold text-muted uppercase tracking-widest mb-1.5">
        {label}
      </p>
      {children}
      {hint && <p className="text-xs text-muted mt-1">{hint}</p>}
    </div>
  );
}

/** Numeric settings are text on screen; an empty box means "leave it to gamescope". */
function toNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

/**
 * gamescope and GameMode settings.
 *
 * Steam runs the game, so the wrapper has to arrive through Steam's own
 * `%command%`. DZL points that at a script it generates once, which is what the
 * hook row here installs; after that every setting takes effect on the next
 * launch with no Steam restart.
 */
export function WrapperSettings({
  config,
  save,
  reload,
}: {
  config: AppConfig;
  save: (patch: Partial<AppConfig>) => Promise<AppConfig | null>;
  reload: () => Promise<void>;
}) {
  const [status, setStatus] = useState<WrapperStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [refresh, setRefresh] = useState("");
  const [extraArgs, setExtraArgs] = useState("");
  const [env, setEnv] = useState("");

  const wrapper = config.wrapper;

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await invoke<WrapperStatus>("get_wrapper_status"));
    } catch (e) {
      setError(String(e));
    }
  }, []);

  // Re-read on every settings change as well as on mount: the preview and the
  // hook state both come from the backend, so there is one source of truth for
  // what Steam will actually run.
  useEffect(() => {
    refreshStatus();
  }, [refreshStatus, wrapper]);

  useEffect(() => {
    setWidth(wrapper.width?.toString() ?? "");
    setHeight(wrapper.height?.toString() ?? "");
    setRefresh(wrapper.refresh?.toString() ?? "");
    setExtraArgs(wrapper.extraArgs);
    setEnv(wrapper.env.join("\n"));
  }, [wrapper]);

  const patch = (change: Partial<WrapperConfig>) =>
    save({ wrapper: { ...wrapper, ...change } });

  const install = async (replace: boolean) => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await invoke<WrapperStatus>("install_wrapper_hook", { replace }));
      setConflict(null);
      await reload();
    } catch (e) {
      const message = String(e);
      const marker = "import-conflict:";
      if (message.includes(marker)) {
        setConflict(message.slice(message.indexOf(marker) + marker.length).trim());
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await invoke<WrapperStatus>("remove_wrapper_hook"));
      await reload();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!status) {
    return (
      <div className="flex items-center gap-2 text-sm text-secondary">
        <Spinner />
        Looking for gamescope and GameMode…
      </div>
    );
  }

  const nothingInstalled = !status.gamescopeInstalled && !status.gamemodeInstalled;
  const installLabel = status.hook === "notInstalled" ? "Install" : "Reinstall";

  return (
    <>
      <div className="divide-y divide-trim/40">
        <StatusRow
          label="GameMode"
          ok={status.gamemodeInstalled}
          value={status.gamemodeInstalled ? "installed" : "not on PATH"}
        />
        <StatusRow
          label="gamescope"
          ok={status.gamescopeInstalled}
          value={
            status.gamescopeInstalled
              ? (status.gamescopeVersion ?? "installed")
              : "not on PATH"
          }
        />
        <StatusRow
          label="Steam hook"
          ok={status.hook === "installed"}
          value={
            status.accountId
              ? `${HOOK_WORDS[status.hook]} (account ${status.accountId})`
              : HOOK_WORDS[status.hook]
          }
          action={
            <div className="flex gap-2">
              {status.hook === "installed" && (
                <Button variant="secondary" disabled={busy} onClick={remove}>
                  Remove
                </Button>
              )}
              <Button
                variant="secondary"
                disabled={busy || nothingInstalled}
                onClick={() => install(false)}
              >
                {busy ? <Spinner /> : null}
                {installLabel}
              </Button>
            </div>
          }
        />
      </div>

      {nothingInstalled && (
        <Banner tone="info" title="Neither wrapper is installed">
          Install gamescope, GameMode or both from your distribution, then
          re-check. There is nothing for DZL to hook until one of them exists.
        </Banner>
      )}

      {status.hook === "changed" && (
        <Banner
          tone="warn"
          title="Steam's launch options were changed outside DZL"
          action={
            <Button variant="secondary" disabled={busy} onClick={() => install(true)}>
              Reinstall
            </Button>
          }
        >
          Steam holds <Code>{status.launchOptions ?? ""}</Code> for DayZ, so these
          settings do nothing until the hook is put back.
        </Banner>
      )}

      {conflict && (
        <Banner
          tone="warn"
          title="DZL cannot read the launch options already set in Steam"
          action={
            <div className="flex gap-2">
              <Button onClick={() => setConflict(null)}>Cancel</Button>
              <Button variant="primary" disabled={busy} onClick={() => install(true)}>
                Replace
              </Button>
            </div>
          }
        >
          Steam holds <Code>{conflict}</Code>. Replacing it stores a copy that
          Remove can put back, but DZL will not carry those options over.
        </Banner>
      )}

      {error && (
        <Banner tone="danger" title="That did not work">
          {error}
          {status.steamRunning && (
            <>
              {" "}
              If Steam refuses to close, set this in DayZ's launch options
              yourself:
              <Code>{status.expectedHook}</Code>
            </>
          )}
        </Banner>
      )}

      <CheckRow
        label="GameMode"
        hint="Runs the game under gamemoderun, which asks the system for a performance governor."
        checked={wrapper.gamemode}
        disabled={!status.gamemodeInstalled}
        onChange={(gamemode) => patch({ gamemode })}
      />
      <CheckRow
        label="gamescope"
        hint="Runs the game inside its own compositor, which fixes resolution and refresh rate handling."
        checked={wrapper.gamescope}
        disabled={!status.gamescopeInstalled}
        onChange={(gamescope) => patch({ gamescope })}
      />

      {wrapper.gamescope && (
        <div className="space-y-4 pl-6 border-l border-trim">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Width" hint="gamescope -W">
              <TextInput
                value={width}
                onChange={setWidth}
                placeholder="2560"
                onEnter={() => patch({ width: toNumber(width) })}
                onBlur={() => patch({ width: toNumber(width) })}
              />
            </Field>
            <Field label="Height" hint="gamescope -H">
              <TextInput
                value={height}
                onChange={setHeight}
                placeholder="1440"
                onEnter={() => patch({ height: toNumber(height) })}
                onBlur={() => patch({ height: toNumber(height) })}
              />
            </Field>
            <Field label="Refresh rate" hint="gamescope -r">
              <TextInput
                value={refresh}
                onChange={setRefresh}
                placeholder="180"
                onEnter={() => patch({ refresh: toNumber(refresh) })}
                onBlur={() => patch({ refresh: toNumber(refresh) })}
              />
            </Field>
          </div>

          <Group label="Window">
            <SegmentedControl<DisplayMode>
              value={wrapper.displayMode}
              onChange={(displayMode) => patch({ displayMode })}
              options={[
                { value: "fullscreen", label: "Fullscreen" },
                { value: "borderless", label: "Borderless" },
                { value: "windowed", label: "Windowed" },
              ]}
            />
          </Group>

          <CheckRow
            label="Force grab cursor"
            hint="Keeps the mouse captured whether or not gamescope thinks the game wants it."
            checked={wrapper.forceGrabCursor}
            onChange={(forceGrabCursor) => patch({ forceGrabCursor })}
          />

          <Field
            label="Extra gamescope arguments"
            hint="Space separated, passed straight to gamescope. Quotes are honoured."
          >
            <TextInput
              value={extraArgs}
              onChange={setExtraArgs}
              placeholder="--hdr-enabled"
              onEnter={() => patch({ extraArgs })}
              onBlur={() => patch({ extraArgs })}
            />
          </Field>
        </div>
      )}

      <details className="group">
        <summary className="text-xs font-semibold text-muted uppercase tracking-widest cursor-pointer">
          Advanced
        </summary>
        <div className="mt-3">
          <Field
            label="Environment"
            hint="One KEY=value per line, exported before the wrappers run. MangoHud goes here as MANGOHUD=1."
          >
            <TextArea
              value={env}
              onChange={setEnv}
              placeholder={"LD_PRELOAD=\nMANGOHUD=1"}
              onBlur={() =>
                patch({
                  env: env
                    .split("\n")
                    .map((line) => line.trim())
                    .filter((line) => line.includes("=")),
                })
              }
            />
          </Field>
        </div>
      </details>

      <Group
        label="What Steam will run"
        hint="Your settings, written the way a Steam launch option would be."
      >
        <Code>{status.preview}</Code>
      </Group>
    </>
  );
}
