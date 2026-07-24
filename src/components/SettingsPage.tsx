import { useEffect, useState } from "react";
import type { UseConfig } from "../hooks/useConfig";
import type { LaunchOption, LoginStatus } from "../types/launcher";
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

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-trim rounded-lg bg-surface overflow-hidden">
      <div className="px-4 py-3 border-b border-trim">
        <h2 className="text-sm font-semibold text-primary">{title}</h2>
        {description && <p className="text-xs text-muted mt-0.5">{description}</p>}
      </div>
      <div className="px-4 py-4 space-y-4">{children}</div>
    </section>
  );
}

function StatusRow({
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
        <Section
          title="System"
          description="What the launcher found on this machine."
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

        <Section title="Game">
          <Field
            label="In-game name"
            hint="Passed to DayZ as -name. Required before joining."
          >
            <TextInput
              value={playerName}
              onChange={setPlayerName}
              placeholder="Survivor"
              onEnter={() => save({ playerName: playerName.trim() })}
            />
          </Field>
          <Field
            label="Steam library"
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
              onEnter={() => save({ steamPath: steamPath.trim() || null })}
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
                hint="DayZ workshop content cannot be downloaded anonymously. Your password never touches this app — steamcmd keeps its own cached login."
              >
                <div className="flex gap-2">
                  <div className="flex-1">
                    <TextInput
                      value={steamLogin}
                      onChange={setSteamLogin}
                      placeholder="your_steam_account"
                      onEnter={() => save({ steamLogin: steamLogin.trim() || null })}
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
                  <Banner tone="info" title="steamcmd is signed in">
                    {login.message}
                  </Banner>
                ) : (
                  <Banner tone="warn" title="steamcmd cannot log in yet">
                    {login.message}
                    {login.fixCommand && (
                      <>
                        <span className="block mt-1.5">
                          Run this once in a terminal, finish any Steam Guard
                          prompt, then test again:
                        </span>
                        <Code>{login.fixCommand}</Code>
                      </>
                    )}
                  </Banner>
                ))}

              <CheckRow
                label="Close Steam while downloading"
                hint="Steam and steamcmd fight over the content pipeline. Steam is restarted afterwards."
                checked={config.closeSteamForDownloads}
                onChange={(closeSteamForDownloads) => save({ closeSteamForDownloads })}
              />
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
      </div>
    </div>
  );
}
