export interface ServerEndpoint {
  ip: string;
  port: number;
}

export interface ServerMod {
  name: string;
  steamWorkshopId: number;
}

export interface Server {
  gamePort: number;
  sponsor: boolean;
  profile: boolean;
  endpoint: ServerEndpoint;
  game: string;
  name: string;
  nameOverride: boolean;
  map: string;
  folder: string;
  players: number;
  maxPlayers: number;
  environment: string;
  password: boolean;
  version: string;
  mission: string;
  vac: boolean;
  battlEye: boolean;
  firstPersonOnly: boolean;
  shard: string;
  timeAcceleration: number;
  time: string;
  mods: ServerMod[];
}

export interface ServersResponse {
  status: number;
  result: Server[];
}
