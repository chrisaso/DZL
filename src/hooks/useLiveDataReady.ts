import { useEffect, useRef, useState } from "react";

/** How long to wait for live data before showing the list regardless. */
const DEADLINE_MS = 4000;

/**
 * Whether the list has enough live data to be worth showing.
 *
 * Ping and queue arrive from the A2S batch about a second after the master
 * list, so revealing the table the moment the list lands means two of its
 * columns visibly fill in late. Holding the skeleton until the first batch
 * settles shows the rows complete instead.
 *
 * The deadline is the escape hatch: servers that never answer, an empty
 * filter, or a query that never fires would otherwise hold the skeleton for
 * ever. Once ready, it stays ready, so scrolling to fresh rows never drops the
 * list back to a skeleton.
 *
 * @param active whether a query is expected yet, i.e. the master list has landed
 * @param querying whether a batch is in flight right now
 * @param haveData whether live results are already in hand, which is the case
 *   when the list remounts against a warm query cache and no batch will fire
 */
export function useLiveDataReady(
  active: boolean,
  querying: boolean,
  haveData: boolean = false,
  deadlineMs: number = DEADLINE_MS,
): boolean {
  const [ready, setReady] = useState(false);
  const sawQuery = useRef(false);

  useEffect(() => {
    if (!active || ready) return;
    const timer = setTimeout(() => setReady(true), deadlineMs);
    return () => clearTimeout(timer);
  }, [active, ready, deadlineMs]);

  useEffect(() => {
    if (!active) return;
    if (querying) sawQuery.current = true;
    else if (sawQuery.current) setReady(true);
  }, [active, querying]);

  return ready || haveData;
}
