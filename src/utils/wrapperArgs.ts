/**
 * Wrapper commands belong in the Wrappers section, not in the arguments DZL
 * passes to DayZ. Pasted into the arguments field they reach the game as
 * ordinary arguments and are ignored, which looks exactly like the launcher
 * dropping them.
 */
const WRAPPER_TOKENS = ["gamemoderun", "gamescope", "mangohud", "%command%"];

export function wrapperTokensIn(value: string): string[] {
  const haystack = value.toLowerCase();
  return WRAPPER_TOKENS.filter((token) => haystack.includes(token));
}
