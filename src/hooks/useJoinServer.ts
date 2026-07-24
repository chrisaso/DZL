import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useRef, useState } from "react";
import type {
  JoinProgress,
  JoinRequest,
  JoinRequirements,
  ModRef,
} from "../types/launcher";
import type { Server } from "../types/server";

/** Something that must be fixed before a join can even be attempted. */
export interface JoinIssue {
  code:
    | "no-steam-path"
    | "dayz-not-installed"
    | "no-player-name"
    | "no-steam-login"
    | "max-map-count";
  title: string;
  detail: string;
  /** Where the user goes to fix it. */
  fix: "settings" | "sysctl";
}

export type JoinFlowState =
  | { kind: "idle" }
  | { kind: "checking"; server: Server }
  | {
      kind: "blocked";
      server: Server;
      requirements: JoinRequirements;
      issues: JoinIssue[];
    }
  | { kind: "subscribe"; server: Server; requirements: JoinRequirements }
  | { kind: "confirm"; server: Server; requirements: JoinRequirements }
  | {
      /**
       * Downloading writes into the Steam client's own config, because
       * steamcmd shares its Steam root. Leaving the client running through
       * that logs you out and breaks cloud sync, so the user is asked before
       * anything is downloaded.
       */
      kind: "steam-prompt";
      server: Server;
      requirements: JoinRequirements;
      options: JoinOptions;
    }
  | { kind: "joining"; server: Server; progress: JoinProgress }
  | { kind: "done"; server: Server }
  | { kind: "error"; server: Server | null; message: string };

export interface JoinOptions {
  password?: string;
  updateMods?: boolean;
}

export function toModRefs(server: Server): ModRef[] {
  return server.mods.map((m) => ({
    workshopId: String(m.steamWorkshopId),
    name: m.name,
  }));
}

/**
 * Everything standing between the user and the server, in the order it must be
 * resolved. Ordering matters: a missing Steam library makes every later check
 * meaningless.
 */
export function collectIssues(requirements: JoinRequirements): JoinIssue[] {
  const issues: JoinIssue[] = [];

  if (!requirements.steamPath) {
    issues.push({
      code: "no-steam-path",
      title: "Steam library not found",
      detail: "Point the launcher at the steamapps folder that holds DayZ.",
      fix: "settings",
    });
  } else if (!requirements.dayzInstalled) {
    issues.push({
      code: "dayz-not-installed",
      title: "DayZ is not in that library",
      detail: `No common/DayZ folder under ${requirements.steamPath}.`,
      fix: "settings",
    });
  }

  if (requirements.playerNameNeeded) {
    issues.push({
      code: "no-player-name",
      title: "In-game name not set",
      detail: "DayZ needs a survivor name before it will connect.",
      fix: "settings",
    });
  }

  if (requirements.steamLoginNeeded) {
    issues.push({
      code: "no-steam-login",
      title: "Steam account needed for mod downloads",
      detail:
        "DayZ workshop content cannot be downloaded anonymously. Add your account name, then sign in to steamcmd once in a terminal.",
      fix: "settings",
    });
  }

  if (!requirements.maxMapCountOk) {
    issues.push({
      code: "max-map-count",
      title: "vm.max_map_count is too low",
      detail: "DayZ crashes on modded servers until this kernel limit is raised.",
      fix: "sysctl",
    });
  }

  return issues;
}

export interface UseJoinServer {
  state: JoinFlowState;
  startJoin: (server: Server) => void;
  confirm: (options?: JoinOptions) => void;
  /** Approves closing Steam and carries on with the join. */
  approveSteamClose: () => void;
  dismiss: () => void;
  retry: () => void;
}

/** True when the join will run steamcmd, which is the only reason to close Steam. */
export function willDownload(
  requirements: JoinRequirements,
  options?: JoinOptions,
): boolean {
  const updating = options?.updateMods ?? requirements.updateModsOnJoin;
  return requirements.missingMods.length > 0 || updating;
}

export function useJoinServer(options?: {
  onLaunched?: (server: Server) => void;
}): UseJoinServer {
  const [state, setState] = useState<JoinFlowState>({ kind: "idle" });
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const onLaunched = options?.onLaunched;

  const cleanup = useCallback(() => {
    unlistenRef.current?.();
    unlistenRef.current = null;
  }, []);

  const startJoin = useCallback((server: Server) => {
    setState({ kind: "checking", server });

    invoke<JoinRequirements>("check_join_requirements", {
      mods: toModRefs(server),
    })
      .then((requirements) => {
        const issues = collectIssues(requirements);

        if (issues.length > 0) {
          setState({ kind: "blocked", server, requirements, issues });
          return;
        }

        // Subscribe-only mode is not an error — the Steam client installs the
        // mods instead of steamcmd, so hand the user the workshop pages.
        if (!requirements.useSteamcmd && requirements.missingMods.length > 0) {
          setState({ kind: "subscribe", server, requirements });
          return;
        }

        setState({ kind: "confirm", server, requirements });
      })
      .catch((e) => setState({ kind: "error", server, message: String(e) }));
  }, []);

  const execute = useCallback(
    async (server: Server, joinOptions?: JoinOptions) => {
      setState({
        kind: "joining",
        server,
        progress: {
          step: "preparing",
          detail: null,
          current: 0,
          total: 0,
          percent: null,
        },
      });

      cleanup();
      unlistenRef.current = await listen<JoinProgress>("join-progress", (event) => {
        const progress = event.payload;
        // Terminal states come from the command's own result, so a dropped or
        // out-of-order event can never leave the modal stuck.
        if (progress.step === "done" || progress.step === "error") return;
        setState((prev) => (prev.kind === "joining" ? { ...prev, progress } : prev));
      });

      const request: JoinRequest = {
        ip: server.endpoint.ip,
        gamePort: server.gamePort,
        mods: toModRefs(server),
        password: joinOptions?.password ?? null,
        updateMods: joinOptions?.updateMods ?? null,
      };

      try {
        await invoke("join_server", { request });
        setState({ kind: "done", server });
        onLaunched?.(server);
      } catch (e) {
        setState({ kind: "error", server, message: String(e) });
      } finally {
        cleanup();
      }
    },
    [cleanup, onLaunched],
  );

  const confirm = useCallback(
    (joinOptions?: JoinOptions) => {
      if (state.kind !== "confirm") return;
      const { server, requirements } = state;

      // Only worth asking when steamcmd is about to run and there is a client
      // to close.
      if (willDownload(requirements, joinOptions) && requirements.steamRunning) {
        setState({
          kind: "steam-prompt",
          server,
          requirements,
          options: joinOptions ?? {},
        });
        return;
      }

      execute(server, joinOptions);
    },
    [state, execute],
  );

  const approveSteamClose = useCallback(() => {
    if (state.kind !== "steam-prompt") return;
    execute(state.server, state.options);
  }, [state, execute]);

  const retry = useCallback(() => {
    const server = "server" in state ? state.server : null;
    if (server) startJoin(server);
  }, [state, startJoin]);

  const dismiss = useCallback(() => {
    cleanup();
    setState({ kind: "idle" });
  }, [cleanup]);

  return { state, startJoin, confirm, approveSteamClose, dismiss, retry };
}
