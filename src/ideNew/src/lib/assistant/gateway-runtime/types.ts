export type RuntimeInfo = {
  baseUrl: string;
  engine: 'docker' | 'podman';
  containerName: string;
  image: string;
  port: number;
};

export type CodexGatewayContainerAction =
  | 'create'
  | 'start'
  | 'stop'
  | 'restart'
  | 'remove';

export type CodexGatewayRuntimeState = {
  mode: string;
  userKey: string;
  userName: string;
  containerName: string;
  engine: 'docker' | 'podman' | null;
  image: string;
  host: string;
  port: number | null;
  baseUrl: string;
  exists: boolean;
  running: boolean;
};

export type RemoteCodexStatePayload = {
  service?: string;
  containerName?: string;
  engine?: string;
  image?: string;
  exists?: boolean;
  running?: boolean;
  port?: number | null;
  host?: string;
  baseUrl?: string;
};
