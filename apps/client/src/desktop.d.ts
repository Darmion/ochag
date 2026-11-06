export {};

declare global {
  type ArtPackInfo = {
    id: string;
    name: string;
    version: string;
    description: string;
    author: string;
    bundled: boolean;
    off: boolean;
    error: string | null;
    sections: Array<{ id: string; name: string; description: string; paths: string[]; count: number }>;
    translations?: Record<string, { name?: string; description?: string; author?: string; sections?: Record<string, string> }>;
    groups: Array<{ id: string; label: string; section: string; items: Array<{ path: string; label: string; names?: string[] }> }>;
  };

  type PlayerViewState = {
    token: string;
    campaignId: string;
    sceneId: string;
    viewAs: string;
    viewerName: string;
    currentUserId: string;
  };

  interface Window {
    desktop?: {
      getServer(): Promise<string>;

      setServer(address: string): Promise<string>;

      probeServer(address: string): Promise<ServerProbe>;

      trustServer(origin: string, fingerprint: string): Promise<ServerProbe>;

      zoom?: { set(factor: number): void; get(): number };

      attention?(): Promise<void>;

      request(input: {
        path: string;
        method: string;
        body?: unknown;
        token?: string;
        file?: { name: string; type: string; data: ArrayBuffer };
      }): Promise<{
        status: number;
        data: any;
        binary?: boolean;
        contentType?: string;
      }>;

      auth: {
        saved(): Promise<SavedLogins>;
        remember(input: {
          username: string;
          password: string;
          hostName?: string | null;
          serverId?: string | null;
        }): Promise<SavedLogins>;
        markUsed(id: string, info?: { hostName?: string | null; serverId?: string | null }): Promise<SavedLogins>;
        forget(id: string): Promise<SavedLogins>;
        clearLast(): Promise<SavedLogins>;
        setAutoLogin(enabled: boolean): Promise<SavedLogins>;
        loginSaved(id: string): Promise<{ status: number; data: any; serverUrl: string }>;
      };

      updates: {
        state(): Promise<UpdateState>;
        saveSettings(input: { repository?: string; autoCheck?: boolean }): Promise<{ repository: string; autoCheck: boolean }>;
        checkGitHub(): Promise<GitHubUpdate>;
        downloadGitHub(): Promise<GitHubUpdate>;
        checkServer(): Promise<ServerUpdate>;
        downloadServer(options?: { allowUnverified?: boolean }): Promise<{ version: string; unverified?: true; reason?: string }>;
        importInstaller(): Promise<{ canceled: true } | { version: string }>;
        install(version: string): Promise<boolean>;
        onProgress(callback: (progress: { source: 'github' | 'server'; received: number; total: number }) => void): () => void;
      };

      mods?: {
        visual(): Promise<Array<{ id: string; name: string; version: string; description: string; author: string; css: string; error: string | null; off?: boolean; translations?: Record<string, { name?: string; description?: string; author?: string }> }>>;
        art?(): Promise<ArtPackInfo[]>;
        artFiles?(id: string, section: string): Promise<Array<{ path: string; type: string; data: string }>>;
        bundled?(): Promise<{ enabled: string[] }>;
        setBundled?(id: string, on: boolean): Promise<{ enabled: string[] }>;
        openFolder(): Promise<string>;
      };

      locales?: {
        list(): Promise<Array<{ file: string; data?: unknown; error?: string }>>;
        openFolder(): Promise<string>;
        saveTemplate(template: Record<string, unknown>): Promise<string>;
        nativeTexts?(texts: Record<string, string>): Promise<void>;
      };

      campaign: {
        exportToFile(input: { campaignId: string; campaignName: string; token: string }): Promise<
          | { canceled: true }
          | { ok: true; filePath: string; sizeBytes: number }
          | { ok: false; message: string; hints?: string[] }
        >;
        exportObject(input: { campaignId: string; characterId: string; name: string; token: string }): Promise<
          | { canceled: true }
          | { ok: true; filePath: string; sizeBytes: number }
          | { ok: false; message: string; hints?: string[] }
        >;
        importObject(input: { campaignId: string; token: string }): Promise<
          | { canceled: true }
          | { ok: true; fileName: string; characterId: string; name: string; kind: string }
          | { ok: false; message: string; hints?: string[] }
        >;
        importFromFile(input: { token: string }): Promise<
          | { canceled: true }
          | { ok: true; fileName: string; report: CampaignImportReport }
          | { ok: false; message: string; hints?: string[] }
        >;
      };

      playerView: {
        open(input: PlayerViewState): Promise<boolean>;
        update(input: Partial<Pick<PlayerViewState, 'sceneId' | 'viewAs' | 'viewerName'>>): Promise<boolean>;
        close(): Promise<boolean>;
        isOpen(): Promise<boolean>;
        state(): Promise<PlayerViewState | null>;
        onChanged(callback: (state: PlayerViewState | null) => void): () => void;
        onClosed(callback: () => void): () => void;
      };

      host: {
        start(): Promise<HostStatus>;
        stop(): Promise<HostStatus>;
        status(): Promise<HostStatus>;
        connections(): Promise<HostConnections | null>;
        accounts(): Promise<{ accounts: HostAccount[] }>;
        setCanCreateCampaigns(userId: string, value: boolean): Promise<{ canCreateCampaigns: boolean }>;
        backup(): Promise<BackupFile[]>;
        listBackups(): Promise<BackupFile[]>;
        // Only for an incomplete copy (complete: false); an older main process has no such method.
        deleteBrokenBackup?(name: string): Promise<BackupFile[]>;
        restore(name: string): Promise<BackupFile[]>;
        getBackupSchedule(): Promise<{ hours: number; keep: number }>;
        setBackupSchedule(input: { hours: number; keep: number }): Promise<{ hours: number; keep: number }>;
        setLanMode(enabled: boolean): Promise<HostStatus>;
        getLanMode(): Promise<boolean>;
        setLanTls(enabled: boolean): Promise<HostStatus>;
        getLanTls(): Promise<boolean>;
        firewallStatus(): Promise<FirewallStatus>;
        allowFirewall(): Promise<{ ok: boolean; message: string }>;
        getNetwork(): Promise<HostNetwork>;
        setTunnel(input: { mode: TunnelMode; token?: string; publicUrl?: string | null; protocol?: 'auto' | 'http2' }): Promise<{ network: HostNetwork; status: HostStatus }>;
        restartTunnel(): Promise<HostStatus>;
        recheckTunnel(): Promise<HostStatus>;
        cloudflared(): Promise<{ found: boolean; path: string | null; version: string | null; own: boolean }>;
        downloadCloudflared(): Promise<{ found: boolean; path: string | null; version: string | null; own: boolean }>;
        setPublic(input: { enabled: boolean; upnp?: boolean; port?: number }): Promise<{ network: HostNetwork; status: HostStatus }>;
        checkPublic(): Promise<HostStatus>;
        getSettings(): Promise<{ openRegistration: boolean }>;
        setSettings(input: { openRegistration: boolean }): Promise<{ openRegistration: boolean }>;
      };
      cloudflareTest(): Promise<CloudflareTest>;
    };
  }

  type NetworkProblem = {
    code: string;
    message: string;
    hints: string[];
    fingerprint?: string;
    certificateCode?: string;
  };

  type ServerProbe =
    | {
        ok: true;
        origin: string;
        latencyMs: number;
        serverId: string | null;
        hostName: string | null;
        apiVersion: number | null;
        appVersion: string | null;
        thisComputer: boolean;
        registration?: 'open' | 'invite';
      }
    | { ok: false; origin: string | null; error: NetworkProblem };

  type SavedLogin = {
    id: string;
    serverUrl: string;
    username: string;
    hostName: string | null;
    serverId: string | null;
    savedAt: string;
  };

  type SavedLogins = {
    autoLogin: boolean;
    lastId: string | null;
    encryptionAvailable: boolean;
    entries: SavedLogin[];
  };

  type HostAddress = {
    url: string;
    ip: string;
    interfaceName: string;
    kind: 'vpn' | 'lan' | 'other';
  };

  type HostStatus = {
    state: 'stopped' | 'starting' | 'running' | 'error';
    message: string;
    code?: 'vc-runtime';
    port?: number;
    localUrl?: string;
    serverId?: string | null;
    hostName?: string | null;
    lanMode?: boolean;
    tls?: { fingerprint: string; code: string } | null;
    addresses: HostAddress[];
    tunnelPort?: number;
    tunnel?: TunnelStatus;
    public?: PublicStatus | null;
  };

  type TunnelMode = 'off' | 'quick' | 'named';

  type TunnelStatus = {
    state: 'off' | 'starting' | 'running' | 'error';
    mode: TunnelMode;
    url: string | null;
    message: string;
    check: { ok: boolean; latencyMs?: number; at: number; message?: string } | null;
    log: string[];
    download: { active: boolean; received: number; total: number | null; error: string | null } | null;
  };

  type PublicStatus = {
    checking?: boolean;
    port?: number;
    upnpEnabled?: boolean;
    checkedAt?: number;
    error?: string;
    publicIp?: string | null;
    routerIp?: string | null;
    upnp?: { available: boolean; localAddress: string | null };
    // white: public IP on the router; cgnat: behind provider NAT; double-nat: private router WAN address;
    // mismatch: router WAN differs from the public IP; unknown: the router does not answer UPnP.
    verdict?: 'white' | 'cgnat' | 'double-nat' | 'mismatch' | 'unknown';
    mapping?: { externalPort: number; internalPort: number; internalClient: string; since: number } | null;
    mapMessage?: string | null;
    ipv6?: { address: string; interfaceName: string }[];
  };

  type HostNetwork = {
    lanMode: boolean;
    lanTls: boolean;
    tunnelMode: TunnelMode;
    hasTunnelToken: boolean;
    tunnelPublicUrl: string | null;
    tunnelProtocol: 'auto' | 'http2';
    tunnelPort: number;
    publicMode: boolean;
    publicUpnp: boolean;
    publicPort: number;
  };

  type CloudflareTest = {
    verdict: 'ok' | 'slow' | 'throttled' | 'blocked';
    received: number;
    total: number;
    seconds: number;
    bytesPerSecond: number;
    error: string | null;
  };

  type HostConnection = {
    userId: string;
    username: string;
    displayName: string;
    clientAddress: string;
    fromThisComputer: boolean;
    serverAddress: string;
    serverPort: number | null;
    network: string | null;
    online: boolean;
    firstSeenAt: number;
    lastSeenAt: number;
    atTable: { campaignName: string; sceneName: string }[];
  };

  type HostAccount = {
    userId: string;
    username: string;
    displayName: string;
    canCreateCampaigns: boolean;
    ownedCampaigns: number;
  };

  type HostAuthEvent = {
    at: number;
    kind: 'login' | 'login_failed' | 'register' | 'register_failed';
    username: string;
    reason: string;
    remoteAddress: string;
    localAddress: string;
    network: string | null;
    fromThisComputer: boolean;
  };

  type HostConnections = {
    serverId: string;
    hostName: string;
    now: number;
    connections: HostConnection[];
    events: HostAuthEvent[];
  };

  type FirewallStatus =
    | { supported: false }
    | { supported: true; known: false }
    | {
        supported: true;
        known: true;
        port: number;
        programPath: string;
        checkedAt: number;
        portRules: FirewallRule[];
        appRules: FirewallRule[];
        networks: Record<string, string>;
      };

  type FirewallRule = {
    name: string;
    action: string;
    profile: string;
    protocol: string;
    port: string;
  };

  type CampaignImportReport = {
    campaignId: string;
    name: string;
    source: { serverId?: string; hostName: string };
    exportedAt: string;
    counts: { characters: number; scenes: number; objects: number; notes: number; assets: number; spells: number; rules: number };
    matchedPlayers: string[];
    missingPlayers: { username: string; displayName: string; characters: string[] }[];
    warnings: string[];
  };

  type UpdateState = {
    currentVersion: string;
    packaged: boolean;
    repository: string;
    autoCheck: boolean;
    installers: Array<{ version: string; size: number; source: string; savedAt: string }>;
    sharingCurrent: boolean;
  };

  type GitHubUpdate = {
    repository: string;
    currentVersion: string;
    version: string;
    tag: string;
    notes: string;
    publishedAt: string | null;
    asset: { name: string; url: string; size: number };
    newer: boolean;
    downloaded: boolean;
  };

  type ServerUpdate = {
    serverUrl: string;
    currentVersion: string;
    serverVersion: string;
    installerAvailable: boolean;
    newer: boolean;
    older: boolean;
  };

  type BackupFile = {
    name: string;
    kind?: 'manual' | 'auto' | 'before-restore';
    createdAt: string;
    sizeBytes: number;
    complete?: boolean;
  };
}
