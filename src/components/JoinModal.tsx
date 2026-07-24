import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import type { JoinFlowState, JoinOptions } from "../hooks/useJoinServer";
import type { ModRef } from "../types/launcher";
import { describeError } from "../utils/errors";
import { formatMap } from "../utils/format";
import {
  Banner,
  Button,
  Code,
  CheckRow,
  Field,
  Icon,
  Modal,
  ProgressBar,
  Spinner,
  TextInput,
} from "./ui";

const STEP_LABELS: Record<string, string> = {
  preparing: "Checking your library",
  "closing-steam": "Closing Steam for the download",
  downloading: "Downloading mods",
  "starting-steam": "Starting Steam back up",
  linking: "Linking mods into DayZ",
  "closing-dayz": "Closing the running game",
  launching: "Launching DayZ",
  waiting: "Waiting for DayZ to start",
};

function workshopUrl(mod: ModRef) {
  return `https://steamcommunity.com/sharedfiles/filedetails/?id=${mod.workshopId}`;
}

function ModList({ mods, limit = 12 }: { mods: ModRef[]; limit?: number }) {
  const shown = mods.slice(0, limit);
  const rest = mods.length - shown.length;

  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((mod) => (
        <button
          key={mod.workshopId}
          onClick={() => openUrl(workshopUrl(mod))}
          title={`Open workshop page for ${mod.name}`}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-elevated text-secondary border border-trim/60 hover:border-trim hover:text-primary transition-colors cursor-pointer"
        >
          {mod.name}
          <Icon name="external" size={9} className="opacity-50" />
        </button>
      ))}
      {rest > 0 && (
        <span className="inline-flex items-center px-2 py-0.5 text-xs text-muted">
          +{rest} more
        </span>
      )}
    </div>
  );
}

export function JoinModal({
  state,
  onConfirm,
  onDismiss,
  onRetry,
  onOpenSettings,
  onFixMaxMapCount,
}: {
  state: JoinFlowState;
  onConfirm: (options?: JoinOptions) => void;
  onDismiss: () => void;
  onRetry: () => void;
  onOpenSettings: () => void;
  onFixMaxMapCount: () => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [updateMods, setUpdateMods] = useState(false);
  const [closeSteam, setCloseSteam] = useState(true);
  const [fixing, setFixing] = useState(false);

  const server = "server" in state ? state.server : null;

  // Reset the per-join inputs whenever a different server is picked.
  useEffect(() => {
    setPassword("");
  }, [server?.endpoint.ip, server?.endpoint.port]);

  useEffect(() => {
    if (state.kind === "confirm") {
      setUpdateMods(state.requirements.updateModsOnJoin);
      setCloseSteam(state.requirements.closeSteamPreference);
    }
  }, [state.kind]);

  if (state.kind === "idle") return null;

  const subtitle = server
    ? `${server.endpoint.ip}:${server.gamePort} · ${formatMap(server.map)}`
    : undefined;
  const title = server?.name ?? "Join server";

  if (state.kind === "checking") {
    return (
      <Modal title={title} subtitle={subtitle} onClose={onDismiss}>
        <div className="flex items-center gap-2 text-sm text-secondary py-4">
          <Spinner />
          Checking your setup…
        </div>
      </Modal>
    );
  }

  if (state.kind === "blocked") {
    const canFixSysctl = state.issues.some((i) => i.fix === "sysctl");
    return (
      <Modal
        title={title}
        subtitle={subtitle}
        onClose={onDismiss}
        footer={
          <>
            <Button onClick={onDismiss}>Cancel</Button>
            {canFixSysctl && (
              <Button
                variant="secondary"
                disabled={fixing}
                onClick={async () => {
                  setFixing(true);
                  try {
                    await onFixMaxMapCount();
                    onRetry();
                  } finally {
                    setFixing(false);
                  }
                }}
              >
                {fixing ? <Spinner /> : null}
                Raise the limit
              </Button>
            )}
            <Button variant="primary" onClick={onOpenSettings}>
              Open settings
            </Button>
          </>
        }
      >
        <p className="text-sm text-secondary mb-3">
          {state.issues.length === 1
            ? "One thing needs sorting before you can play:"
            : `${state.issues.length} things need sorting before you can play:`}
        </p>
        <div className="space-y-2">
          {state.issues.map((issue) => (
            <Banner key={issue.code} tone="warn" title={issue.title}>
              {issue.detail}
            </Banner>
          ))}
        </div>
      </Modal>
    );
  }

  if (state.kind === "subscribe") {
    const missing = state.requirements.missingMods;
    return (
      <Modal
        title={title}
        subtitle={subtitle}
        onClose={onDismiss}
        footer={
          <>
            <Button onClick={onDismiss}>Cancel</Button>
            <Button onClick={onRetry}>I've subscribed — recheck</Button>
            <Button
              variant="primary"
              onClick={() => missing.forEach((mod) => openUrl(workshopUrl(mod)))}
            >
              Open all {missing.length} pages
            </Button>
          </>
        }
      >
        <Banner tone="info" title="steamcmd downloads are turned off">
          Subscribe to the missing mods in Steam, wait for the client to install
          them, then recheck. Turn steamcmd on in settings to have the launcher
          download them for you instead.
        </Banner>
        <p className="text-xs font-semibold text-muted uppercase tracking-widest mt-4 mb-1.5">
          Missing mods ({missing.length})
        </p>
        <ModList mods={missing} limit={40} />
      </Modal>
    );
  }

  if (state.kind === "confirm") {
    const { requirements } = state;
    const missing = requirements.missingMods;
    const total = server?.mods.length ?? 0;
    const needsPassword = server?.password ?? false;

    return (
      <Modal
        title={title}
        subtitle={subtitle}
        onClose={onDismiss}
        footer={
          <>
            <Button onClick={onDismiss}>Cancel</Button>
            <Button
              variant="primary"
              disabled={needsPassword && password.trim() === ""}
              onClick={() =>
                onConfirm({
                  password: needsPassword ? password : undefined,
                  updateMods,
                  closeSteam,
                })
              }
            >
              <Icon name="play" filled />
              {missing.length > 0 ? `Download ${missing.length} & join` : "Join server"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-xs text-muted uppercase tracking-wider">Players</p>
              <p className="text-primary font-medium">
                {server?.players}/{server?.maxPlayers}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted uppercase tracking-wider">Mods</p>
              <p className="text-primary font-medium">{total}</p>
            </div>
            <div>
              <p className="text-xs text-muted uppercase tracking-wider">Playing as</p>
              <p className="text-primary font-medium truncate">
                {requirements.playerName}
              </p>
            </div>
          </div>

          {missing.length > 0 ? (
            <div>
              <p className="text-xs font-semibold text-muted uppercase tracking-widest mb-1.5">
                {missing.length} mod{missing.length === 1 ? "" : "s"} to download
              </p>
              <ModList mods={missing} />
              <p className="text-xs text-muted mt-2">
                steamcmd will fetch these as{" "}
                <span className="text-secondary">{requirements.steamLogin}</span>
                {requirements.steamLogin ? "" : " your Steam account"}. Large mod
                sets can take a while.
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-good">
              <Icon name="check" />
              {total > 0 ? "All mods already installed" : "Vanilla server — no mods needed"}
            </div>
          )}

          {needsPassword && (
            <Field label="Server password">
              <TextInput
                type="password"
                value={password}
                onChange={setPassword}
                placeholder="Required by this server"
                onEnter={() => password.trim() && onConfirm({ password, updateMods })}
              />
            </Field>
          )}

          {total > 0 && (
            <CheckRow
              label="Update every mod before joining"
              hint="Slower, but catches mods the server updated since you last played."
              checked={updateMods}
              onChange={setUpdateMods}
            />
          )}

          {/* Only worth asking when something will actually be downloaded and
              Steam is open to be closed. */}
          {(missing.length > 0 || updateMods) && requirements.steamRunning && (
            <CheckRow
              label="Close Steam while mods download"
              hint="steamcmd and Steam fight over the download pipeline, so downloads are more reliable with Steam closed. It is started again before the game launches — but anything else Steam is doing will be interrupted."
              checked={closeSteam}
              onChange={setCloseSteam}
            />
          )}
        </div>
      </Modal>
    );
  }

  if (state.kind === "joining") {
    const { progress } = state;
    const label = STEP_LABELS[progress.step] ?? progress.step;
    const counted = progress.total > 0;

    return (
      <Modal title={title} subtitle={subtitle}>
        <div className="py-2 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-sm text-primary">
              <Spinner />
              {label}
            </span>
            {counted && (
              <span className="text-xs font-mono text-muted">
                {progress.current}/{progress.total}
              </span>
            )}
          </div>

          <ProgressBar
            percent={
              progress.percent ??
              (counted ? ((progress.current - 1) / progress.total) * 100 : null)
            }
          />

          {progress.detail && (
            <p className="text-xs text-secondary truncate">{progress.detail}</p>
          )}
          {progress.step === "closing-steam" && (
            <p className="text-xs text-muted">
              Steam and steamcmd fight over downloads, so Steam is restarted once
              the mods are in.
            </p>
          )}
        </div>
      </Modal>
    );
  }

  if (state.kind === "done") {
    return (
      <Modal
        title={title}
        subtitle={subtitle}
        onClose={onDismiss}
        footer={<Button variant="primary" onClick={onDismiss}>Close</Button>}
      >
        <div className="flex items-center gap-2 text-sm text-good py-3">
          <Icon name="check" size={16} />
          DayZ is starting{server ? ` — see you on ${formatMap(server.map)}` : ""}.
        </div>
      </Modal>
    );
  }

  const friendly = describeError(state.message);

  return (
    <Modal
      title={title}
      subtitle={subtitle}
      onClose={onDismiss}
      footer={
        <>
          <Button onClick={onDismiss}>Close</Button>
          {friendly.settings && (
            <Button variant="secondary" onClick={onOpenSettings}>
              Settings
            </Button>
          )}
          <Button variant="primary" onClick={onRetry}>
            Try again
          </Button>
        </>
      }
    >
      <Banner tone="danger" title={friendly.title}>
        {friendly.detail}
        {friendly.command && <Code>{friendly.command}</Code>}
      </Banner>
    </Modal>
  );
}
