import type { Server } from "../types/server";

const MAP_NAMES: Record<string, string> = {
  chernarusplus: "Chernarus",
  namalsk: "Namalsk",
  livonia: "Livonia",
  deerisle: "Deer Isle",
  deer_isle: "Deer Isle",
  sakhal: "Sakhal",
  takistanplus: "Takistan",
  enoch: "Livonia",
};

export function formatMap(map: string): string {
  const known = MAP_NAMES[map.toLowerCase()];
  if (known) return known;
  return map
    .split(/[_\-+]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function serverId(server: Server): string {
  return `${server.endpoint.ip}:${server.endpoint.port}`;
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  const mb = bytes / 1024 / 1024;
  if (mb < 1) return `${(bytes / 1024).toFixed(0)} KB`;
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

/** Compact "how long ago" label for the recently-played list. */
export function timeAgo(timestamp: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Colour band for a latency reading, shared by the table and detail panel. */
export function pingClass(ping: number | null | undefined): string {
  if (ping === null || ping === undefined) return "text-muted";
  if (ping < 60) return "text-good";
  if (ping < 140) return "text-warn";
  return "text-accent";
}
