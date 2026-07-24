import { invoke } from "@tauri-apps/api/core";
import { useCallback, useRef, useState } from "react";
import type { QueryResult, QueryTarget } from "../types/launcher";

/** How long a ping result stays fresh before it is worth asking again. */
const TTL_MS = 60_000;
const BATCH_TIMEOUT_MS = 1500;

function key(target: QueryTarget) {
  return `${target.ip}:${target.port}`;
}

/**
 * Live A2S queries against the servers currently on screen. Results are cached
 * per server so scrolling back over a row does not re-query it, and in-flight
 * targets are never queried twice concurrently.
 */
export function useServerQuery() {
  const [results, setResults] = useState<Map<string, QueryResult>>(new Map());
  const [querying, setQuerying] = useState(false);
  const inFlight = useRef<Set<string>>(new Set());
  const queriedAt = useRef<Map<string, number>>(new Map());

  const query = useCallback(async (targets: QueryTarget[], force = false) => {
    const now = Date.now();
    const pending = targets.filter((t) => {
      const id = key(t);
      if (inFlight.current.has(id)) return false;
      if (force) return true;
      const last = queriedAt.current.get(id);
      return last === undefined || now - last > TTL_MS;
    });

    if (pending.length === 0) return;
    pending.forEach((t) => inFlight.current.add(key(t)));
    setQuerying(true);

    try {
      const batch = await invoke<QueryResult[]>("query_servers", {
        targets: pending,
        timeoutMs: BATCH_TIMEOUT_MS,
      });

      const stamped = Date.now();
      setResults((prev) => {
        const next = new Map(prev);
        for (const result of batch) {
          next.set(key(result), result);
          queriedAt.current.set(key(result), stamped);
        }
        return next;
      });
    } catch {
      // A failed batch just leaves the rows unpinged; they retry on the next
      // pass once the TTL lapses.
    } finally {
      pending.forEach((t) => inFlight.current.delete(key(t)));
      setQuerying(inFlight.current.size > 0);
    }
  }, []);

  const get = useCallback(
    (ip: string, port: number) => results.get(`${ip}:${port}`),
    [results],
  );

  return { results, get, query, querying };
}
