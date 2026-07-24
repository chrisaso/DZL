import { beforeEach } from "vitest";

/**
 * jsdom under this Node version exposes no `localStorage` — Node's own
 * experimental global shadows it and resolves to undefined. The Tauri webview
 * always has real storage, so tests get an equivalent in-memory implementation
 * instead of the app having to guard every access.
 */
class MemoryStorage implements Storage {
  #entries = new Map<string, string>();

  get length() {
    return this.#entries.size;
  }

  clear() {
    this.#entries.clear();
  }

  getItem(key: string) {
    return this.#entries.get(key) ?? null;
  }

  key(index: number) {
    return [...this.#entries.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.#entries.delete(key);
  }

  setItem(key: string, value: string) {
    this.#entries.set(key, String(value));
  }
}

if (typeof globalThis.localStorage === "undefined") {
  const storage = new MemoryStorage();
  for (const target of [globalThis, globalThis.window].filter(Boolean)) {
    Object.defineProperty(target, "localStorage", {
      value: storage,
      configurable: true,
      writable: true,
    });
  }
}

// Storage is shared process-wide, so wipe it between tests to keep them
// independent of each other's writes.
beforeEach(() => localStorage.clear());
