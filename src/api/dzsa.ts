import type { Server, ServersResponse, ServerQueryResponse } from "../types/server";

const DZSA_API_URL = "https://dayzsalauncher.com/api/v1/launcher/servers/dayz";
const DZSA_QUERY_URL = "https://www.dayzsalauncher.com/api/v1/query";

export async function fetchServers(): Promise<Server[]> {
  const response = await fetch(DZSA_API_URL);
  if (!response.ok) {
    throw new Error(`DZSA API error: ${response.status}`);
  }
  const data: ServersResponse = await response.json();
  return data.result;
}

export async function fetchServer(ip: string, port: number): Promise<Server> {
  const response = await fetch(`${DZSA_QUERY_URL}/${ip}/${port}`);
  if (!response.ok) {
    throw new Error(`DZSA query error: ${response.status}`);
  }
  const data: ServerQueryResponse = await response.json();
  return data.result;
}
