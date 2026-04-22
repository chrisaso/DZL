import type { Server, ServersResponse } from "../types/server";

const DZSA_API_URL = "https://dayzsalauncher.com/api/v1/launcher/servers/dayz";

export async function fetchServers(): Promise<Server[]> {
  const response = await fetch(DZSA_API_URL);
  if (!response.ok) {
    throw new Error(`DZSA API error: ${response.status}`);
  }
  const data: ServersResponse = await response.json();
  return data.result;
}
