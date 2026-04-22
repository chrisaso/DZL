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
