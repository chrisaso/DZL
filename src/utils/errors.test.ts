import { describe, it, expect } from "vitest";
import { describeError } from "./errors";

describe("describeError", () => {
  it("turns a steamcmd login failure into the command to run", () => {
    const result = describeError(
      "steamcmd-login-required: steamcmd is not signed in as adaptiq_. Run " +
        "`steamcmd +login adaptiq_` once in a terminal, finish any Steam Guard " +
        "prompt, then try again.",
    );

    expect(result.title).toBe("steamcmd is not signed in");
    expect(result.command).toBe("steamcmd +login adaptiq_");
    expect(result.detail).not.toContain("`");
  });

  it("flags errors whose fix lives in settings", () => {
    expect(describeError("no-steam-login: whatever").settings).toBe(true);
    expect(describeError("steamcmd-failed: whatever").settings).toBeFalsy();
  });

  it("keeps steamcmd's own explanation for other failures", () => {
    const result = describeError(
      "steamcmd-failed: exit 9 while downloading 777. Check that the mod is still on the Workshop.",
    );
    expect(result.title).toBe("steamcmd could not finish");
    expect(result.detail).toContain("777");
    expect(result.command).toBeUndefined();
  });

  it("shows unknown errors verbatim instead of inventing a friendly message", () => {
    const result = describeError("something nobody predicted");
    expect(result.title).toBe("Something went wrong");
    expect(result.detail).toBe("something nobody predicted");
  });

  it("strips the Error: prefix Tauri adds", () => {
    expect(describeError("Error: no-player-name: set your name").title).toBe(
      "In-game name not set",
    );
  });

  it("handles empty and nullish input", () => {
    expect(describeError("").title).toBe("Something went wrong");
    expect(describeError(null).detail).toBe("No details given.");
  });

  it("finds a bare command without backticks", () => {
    const result = describeError(
      "steamcmd-login-required: run steamcmd +login someone to fix it",
    );
    expect(result.command).toBe("steamcmd +login someone");
  });
});
