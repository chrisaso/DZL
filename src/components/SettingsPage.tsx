import { useEffect, useMemo, useState } from "react";
import type { UseConfig } from "../hooks/useConfig";
import type { LaunchOption, LoginStatus } from "../types/launcher";
import {
  collectSetupIssues,
  hasFieldIssue,
  issuesForSection,
  type SetupIssue,
} from "../utils/setupIssues";
import {
  Banner,
  Button,
  CheckRow,
  Code,
  Field,
  Icon,
  Spinner,
  TextInput,
} from "./ui";
import { WrapperSettings } from "./WrapperSettings";

function Section({
  title,
  description,
  issues = [],
  children,
}: {
  title: string;
  description?: string;
  issues?: SetupIssue[];
  children: React.ReactNode;
}) {
  return (
    <section
      className={`border rounded-lg bg-surface overflow-hidden ${
        issues.length > 0 ? "border-accent/40" : "border-trim"
      }`}
    >
      <div className="px-4 py-3 border-b border-trim flex items-center gap-2">
        <h2 className="text-sm font-semibold text-primary">{title}</h2>
        {issues.length > 0 && (
          <span className="inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-accent text-white text-[10px] leading-none">
            {issues.length}
          </span>
        )}
        {description && (
          <p className="text-xs text-muted ml-auto text-right">{description}</p>
        )}
      </div>
      <div className="px-4 py-4 space-y-4">{children}</div>
    </section>
  );
}

/** What still needs doing, shown at the top of the page. */
function SetupSummary({ issues }: { issues: SetupIssue[] }) {
  if (issues.length === 0) {
    return (
      <div className="flex items-center gap-2.5 rounded-lg border border-good/25 bg-good/5 px-4 py-3">
        <span className="w-5 h-5 rounded-full bg-good/15 text-good flex items-center justify-center">
          <Icon name="check" size={11} />
        </span>
        <p className="text-sm text-primary">
          Setup complete — the launcher is ready to join servers.
        </p>
      </div>
    );
  }

  const blocking = issues.filter((i) => i.blocking).length;

  return (
    <div className="rounded-lg border border-accent/40 bg-accent/5 px-4 py-3">
      <div className="flex items-center gap-2.5">
        <span className="w-5 h-5 rounded-full bg-accent/15 text-accent flex items-center justify-center shrink-0">
          <Icon name="warning" size={11} />
        </span>
        <p className="text-sm font-medium text-primary">
          {issues.length} thing{issues.length === 1 ? "" : "s"} still to set up
          {blocking > 0 && (
            <span className="text-accent font-normal">
              {" "}
              — {blocking} block{blocking === 1 ? "s" : ""} joining any server
            </span>
          )}
        </p>
      </div>
      <ul className="mt-2.5 space-y-1.5">
        {issues.map((issue) => (
          <li key={issue.id} className="flex items-start gap-2 text-xs">
            <span
              className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${
                issue.blocking ? "bg-accent" : "bg-warn"
              }`}
            />
            <span>
              <span className="text-primary font-medium">{issue.title}</span>
              <span className="text-muted"> — {issue.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function StatusRow({
  label,
  ok,
  value,
  action,
}: {
  label: string;
  ok: boolean;
  value: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span
        className={`shrink-0 w-4 h-4 rounded-full flex items-center justify-center ${
          ok ? "bg-good/15 text-good" : "bg-accent/15 text-accent"
        }`}
      >
        <Icon name={ok ? "check" : "close"} size={9} />
      </span>
      <span className="text-sm text-secondary w-40 shrink-0">{label}</span>
      <span className="text-sm text-primary font-mono text-xs truncate flex-1">
        {value}
      </span>
      {action}
    </div>
  );
}

export function SettingsPage({ configState }: { configState: UseConfig }) {
  const { config, env, save, reload, checkLogin, fixMaxMapCount } = configState;

  const [playerName, setPlayerName] = useState("");
  const [steamPath, setSteamPath] = useState("");
  const [steamLogin, setSteamLogin] = useState("");
  const [customArgs, setCustomArgs] = useState("");
  const [login, setLogin] = useState<LoginStatus | null>(null);
  const [testing, setTesting] = useState(false);
  const [fixing, setFixing] = useState(false);

  const issues = useMemo(() => collectSetupIssues(config, env), [config, env]);

  useEffect(() => {
    if (!config) return;
    setPlayerName(config.playerName ?? "");
    setSteamPath(config.steamPath ?? "");
    setSteamLogin(config.steamLogin ?? "");
    setCustomArgs(config.customArgs.join(" "));
  }, [config]);

  if (!config || !env) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-secondary gap-2">
        <Spinner />
        Loading settings…
      </div>
    );
  }

  const setOption = (key: string, patch: Partial<LaunchOption>) =>
    save({
      launchOptions: config.launchOptions.map((o) =>
        o.key === key ? { ...o, ...patch } : o,
      ),
    });

  return (
    <div className="flex-1 overflow-y-auto min-h-0">
      <div className="max-w-3xl mx-auto px-6 py-6 space-y-4">
        <SetupSummary issues={issues} />

        <Section
          title="System"
          description="What the launcher found on this machine."
          issues={issuesForSection(issues, "system")}
        >
          <div className="divide-y divide-trim/40">
            <StatusRow
              label="Steam client"
              ok={env.steamInstalled}
              value={env.steamInstalled ? "installed" : "not on PATH"}
            />
            <StatusRow
              label="steamcmd"
              ok={env.steamcmdInstalled}
              value={env.steamcmdInstalled ? "installed" : "not on PATH — mods cannot be downloaded"}
            />
            <StatusRow
              label="DayZ"
              ok={env.dayzInstalled}
              value={env.dayzPath ?? "no Steam library found"}
            />
            <StatusRow
              label="vm.max_map_count"
              ok={env.maxMapCountOk}
              value={
                env.maxMapCountOk
                  ? `${env.maxMapCount.toLocaleString()}`
                  : `${env.maxMapCount.toLocaleString()} — needs ${env.requiredMaxMapCount.toLocaleString()}`
              }
              action={
                env.maxMapCountOk ? undefined : (
                  <Button
                    variant="secondary"
                    disabled={fixing || !env.canFixMaxMapCount}
                    onClick={async () => {
                      setFixing(true);
                      try {
                        await fixMaxMapCount();
                      } finally {
                        setFixing(false);
                      }
                    }}
                  >
                    {fixing ? <Spinner /> : null}
                    Fix
                  </Button>
                )
              }
            />
          </div>

          {!env.maxMapCountOk && (
            <Banner tone="warn" title="DayZ will crash on modded servers">
              Raising this kernel limit needs root. The Fix button uses pkexec;
              otherwise run:
              <Code>{env.sysctlFixCommand}</Code>
            </Banner>
          )}

          <div className="flex justify-end">
            <Button onClick={reload}>
              <Icon name="refresh" />
              Re-check
            </Button>
          </div>
        </Section>

        <Section title="Game" issues={issuesForSection(issues, "game")}>
          <Field
            label="In-game name"
            missing={hasFieldIssue(issues, "playerName")}
            hint="Passed to DayZ as -name. Required before joining."
          >
            <TextInput
              value={playerName}
              onChange={setPlayerName}
              placeholder="Survivor"
              missing={hasFieldIssue(issues, "playerName")}
              onEnter={() => save({ playerName: playerName.trim() || null })}
              onBlur={() => save({ playerName: playerName.trim() || null })}
            />
          </Field>
          <Field
            label="Steam library"
            missing={hasFieldIssue(issues, "steamPath")}
            missingLabel="DayZ not found"
            hint={
              env.steamPathDetected
                ? "Detected automatically. Override if DayZ lives in another library."
                : "The steamapps folder that contains common/DayZ."
            }
          >
            <TextInput
              value={steamPath}
              onChange={setSteamPath}
              placeholder="/home/you/.steam/steam/steamapps"
              missing={hasFieldIssue(issues, "steamPath")}
              onEnter={() => save({ steamPath: steamPath.trim() || null })}
              onBlur={() => save({ steamPath: steamPath.trim() || null })}
            />
          </Field>
          <div className="flex justify-end">
            <Button
              variant="secondary"
              onClick={() =>
                save({
                  playerName: playerName.trim() || null,
                  steamPath: steamPath.trim() || null,
                })
              }
            >
              Save
            </Button>
          </div>
        </Section>

        <Section
          title="Mod downloads"
          description="How missing mods get onto your disk."
          issues={issuesForSection(issues, "downloads")}
        >
          <CheckRow
            label="Download mods with steamcmd"
            hint="Off means the launcher sends you to the Steam Workshop to subscribe instead."
            checked={config.useSteamcmd}
            onChange={(useSteamcmd) => save({ useSteamcmd })}
          />

          {config.useSteamcmd && (
            <>
              <Field
                label="Steam account name"
                missing={hasFieldIssue(issues, "steamLogin")}
                hint="DayZ workshop content cannot be downloaded anonymously. Your password never touches this app — steamcmd keeps its own cached login."
              >
                <div className="flex gap-2">
                  <div className="flex-1">
                    <TextInput
                      value={steamLogin}
                      onChange={setSteamLogin}
                      placeholder="your_steam_account"
                      missing={hasFieldIssue(issues, "steamLogin")}
                      onEnter={() => save({ steamLogin: steamLogin.trim() || null })}
                      onBlur={() => save({ steamLogin: steamLogin.trim() || null })}
                    />
                  </div>
                  <Button
                    variant="secondary"
                    disabled={testing || steamLogin.trim() === ""}
                    onClick={async () => {
                      setTesting(true);
                      setLogin(null);
                      try {
                        await save({ steamLogin: steamLogin.trim() || null });
                        setLogin(await checkLogin(steamLogin.trim()));
                      } finally {
                        setTesting(false);
                      }
                    }}
                  >
                    {testing ? <Spinner /> : null}
                    Test login
                  </Button>
                </div>
              </Field>

              {testing && (
                <p className="text-xs text-muted">
                  Asking steamcmd to log in — this can take a minute the first
                  time it updates itself.
                </p>
              )}

              {login &&
                (login.loggedIn ? (
                  <Banner tone="success" title="steamcmd is signed in">
                    {login.message}
                  </Banner>
                ) : (
                  <Banner tone="warn" title="steamcmd cannot log in yet">
                    {login.message}
                    {login.fixCommand && (
                      <>
                        <span className="block mt-1">
                          Run this once in a terminal, finish any Steam Guard
                          prompt, then test again:
                        </span>
                        <Code>{login.fixCommand}</Code>
                      </>
                    )}
                  </Banner>
                ))}

              <CheckRow
                label="Update every server mod on join"
                hint="Off downloads only what is missing, which is much faster."
                checked={config.updateModsOnJoin}
                onChange={(updateModsOnJoin) => save({ updateModsOnJoin })}
              />
            </>
          )}
        </Section>

        <Section
          title="Launch options"
          description="Passed to DayZ on every launch."
        >
          <CheckRow
            label="Close a running DayZ before launching"
            checked={config.killRunningDayz}
            onChange={(killRunningDayz) => save({ killRunningDayz })}
          />
          <CheckRow
            label="Hide to the system tray once the game starts"
            hint="The launcher keeps running in the tray; click its icon to bring it back."
            checked={config.hideToTrayOnLaunch}
            onChange={(hideToTrayOnLaunch) => save({ hideToTrayOnLaunch })}
          />

          <div className="border border-trim rounded-md divide-y divide-trim/40">
            {config.launchOptions.map((option) => (
              <div key={option.key} className="flex items-start gap-3 px-3 py-2">
                <input
                  type="checkbox"
                  checked={option.enabled}
                  onChange={(e) => setOption(option.key, { enabled: e.target.checked })}
                  className="mt-1 w-3.5 h-3.5 rounded accent-accent cursor-pointer"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-mono text-primary">-{option.key}</p>
                  <p className="text-xs text-muted">{option.description}</p>
                </div>
                {option.takesValue && (
                  <div className="w-40 shrink-0">
                    <input
                      value={option.value ?? ""}
                      placeholder="value"
                      onChange={(e) => setOption(option.key, { value: e.target.value })}
                      className="w-full px-2 py-1 rounded bg-elevated border border-trim text-xs font-mono text-primary focus:outline-none focus:border-accent"
                    />
                  </div>
                )}
              </div>
            ))}
          </div>

          <Field
            label="Extra arguments"
            hint="Space separated, appended verbatim. For anything the list above doesn't cover."
          >
            <TextInput
              value={customArgs}
              onChange={setCustomArgs}
              placeholder="-newUI -someFlag"
              onEnter={() =>
                save({ customArgs: customArgs.split(/\s+/).filter(Boolean) })
              }
            />
          </Field>
          <div className="flex justify-end">
            <Button
              variant="secondary"
              onClick={() =>
                save({ customArgs: customArgs.split(/\s+/).filter(Boolean) })
              }
            >
              Save arguments
            </Button>
          </div>
        </Section>

        <Section
          title="Wrappers"
          description="gamescope and GameMode, run around the game."
        >
          <WrapperSettings config={config} save={save} reload={reload} />
        </Section>
      </div>
    </div>
  );
}
