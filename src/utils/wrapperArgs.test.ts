import { describe, it, expect } from "vitest";
import { wrapperTokensIn } from "./wrapperArgs";

describe("wrapperTokensIn", () => {
  it("spots a wrapper pasted into the arguments field", () => {
    expect(
      wrapperTokensIn(
        'LD_PRELOAD="" gamemoderun gamescope -W 2560 -H 1440 -f -- %command%',
      ),
    ).toEqual(["gamemoderun", "gamescope", "%command%"]);
  });

  it("finds mangohud too", () => {
    expect(wrapperTokensIn("mangohud %command%")).toEqual([
      "mangohud",
      "%command%",
    ]);
  });

  it("says nothing about ordinary DayZ arguments", () => {
    expect(wrapperTokensIn("-newUI -noSplash -world=empty")).toEqual([]);
  });

  it("ignores case", () => {
    expect(wrapperTokensIn("GameScope -f")).toEqual(["gamescope"]);
  });
});
