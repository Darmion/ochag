const {
  contextBridge,
  ipcRenderer,
  webFrame,
} = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  getServer: () => ipcRenderer.invoke('server:get'),

  setServer: address =>
    ipcRenderer.invoke('server:set', address),

  probeServer: address =>
    ipcRenderer.invoke('server:probe', address),

  trustServer: (origin, fingerprint) =>
    ipcRenderer.invoke('server:trust', origin, fingerprint),

  request: input =>
    ipcRenderer.invoke('api:request', input),

  attention: () => ipcRenderer.invoke('window:attention'),

  zoom: {
    set: factor => {
      if (typeof factor === 'number' && Number.isFinite(factor)) webFrame.setZoomFactor(Math.max(0.5, Math.min(2, factor)));
    },
    get: () => webFrame.getZoomFactor(),
  },

  auth: {
    saved: () => ipcRenderer.invoke('auth:saved'),
    remember: input => ipcRenderer.invoke('auth:remember', input),
    markUsed: (id, info) => ipcRenderer.invoke('auth:markUsed', id, info),
    forget: id => ipcRenderer.invoke('auth:forget', id),
    clearLast: () => ipcRenderer.invoke('auth:clearLast'),
    setAutoLogin: enabled => ipcRenderer.invoke('auth:setAutoLogin', enabled),
    loginSaved: id => ipcRenderer.invoke('auth:loginSaved', id),
  },

  updates: {
    state: () => ipcRenderer.invoke('update:state'),
    saveSettings: input => ipcRenderer.invoke('update:saveSettings', input),
    checkGitHub: () => ipcRenderer.invoke('update:checkGitHub'),
    downloadGitHub: () => ipcRenderer.invoke('update:downloadGitHub'),
    checkServer: () => ipcRenderer.invoke('update:checkServer'),
    downloadServer: options => ipcRenderer.invoke('update:downloadServer', { allowUnverified: options?.allowUnverified === true }),
    importInstaller: () => ipcRenderer.invoke('update:importInstaller'),
    install: version => ipcRenderer.invoke('update:install', version),
    onProgress: callback => {
      const listener = (_event, progress) => callback(progress);
      ipcRenderer.on('update:progress', listener);
      return () => ipcRenderer.removeListener('update:progress', listener);
    },
  },

  mods: {
    visual: () => ipcRenderer.invoke('mods:visual'),
    art: () => ipcRenderer.invoke('mods:art'),
    artFiles: (id, section) => ipcRenderer.invoke('mods:artFiles', id, section),
    bundled: () => ipcRenderer.invoke('mods:bundled'),
    setBundled: (id, on) => ipcRenderer.invoke('mods:setBundled', id, on),
    openFolder: () => ipcRenderer.invoke('mods:openFolder'),
  },

  locales: {
    list: () => ipcRenderer.invoke('locales:list'),
    openFolder: () => ipcRenderer.invoke('locales:openFolder'),
    saveTemplate: template => ipcRenderer.invoke('locales:saveTemplate', template),
    nativeTexts: texts => ipcRenderer.invoke('locales:nativeTexts', texts),
  },

  campaign: {
    exportToFile: input => ipcRenderer.invoke('campaign:export', input),
    importFromFile: input => ipcRenderer.invoke('campaign:import', input),
    exportObject: input => ipcRenderer.invoke('object:export', input),
    importObject: input => ipcRenderer.invoke('object:import', input),
  },

  playerView: {
    open: input => ipcRenderer.invoke('player-view:open', input),
    update: input => ipcRenderer.invoke('player-view:update', input),
    close: () => ipcRenderer.invoke('player-view:close'),
    isOpen: () => ipcRenderer.invoke('player-view:isOpen'),
    state: () => ipcRenderer.invoke('player-view:state'),
    onChanged: callback => {
      const listener = (_event, state) => callback(state);
      ipcRenderer.on('player-view:changed', listener);
      return () => ipcRenderer.removeListener('player-view:changed', listener);
    },
    onClosed: callback => {
      const listener = () => callback();
      ipcRenderer.on('player-view:closed', listener);
      return () => ipcRenderer.removeListener('player-view:closed', listener);
    },
  },

  host: {
    start: () => ipcRenderer.invoke('host:start'),
    stop: () => ipcRenderer.invoke('host:stop'),
    status: () => ipcRenderer.invoke('host:status'),
    connections: () => ipcRenderer.invoke('host:connections'),
    accounts: () => ipcRenderer.invoke('host:accounts'),
    setCanCreateCampaigns: (userId, value) => ipcRenderer.invoke('host:setCanCreateCampaigns', userId, value),
    backup: () => ipcRenderer.invoke('host:backup'),
    listBackups: () => ipcRenderer.invoke('host:listBackups'),
    deleteBrokenBackup: name => ipcRenderer.invoke('host:deleteBrokenBackup', name),
    restore: name => ipcRenderer.invoke('host:restore', name),
    getBackupSchedule: () => ipcRenderer.invoke('host:getBackupSchedule'),
    setBackupSchedule: input => ipcRenderer.invoke('host:setBackupSchedule', input),
    setLanMode: enabled => ipcRenderer.invoke('host:setLanMode', enabled),
    getLanMode: () => ipcRenderer.invoke('host:getLanMode'),
    setLanTls: enabled => ipcRenderer.invoke('host:setLanTls', enabled),
    getLanTls: () => ipcRenderer.invoke('host:getLanTls'),
    firewallStatus: () => ipcRenderer.invoke('host:firewallStatus'),
    allowFirewall: () => ipcRenderer.invoke('host:allowFirewall'),
    getNetwork: () => ipcRenderer.invoke('host:getNetwork'),
    setTunnel: input => ipcRenderer.invoke('host:setTunnel', input),
    restartTunnel: () => ipcRenderer.invoke('host:restartTunnel'),
    recheckTunnel: () => ipcRenderer.invoke('host:recheckTunnel'),
    cloudflared: () => ipcRenderer.invoke('host:cloudflared'),
    downloadCloudflared: () => ipcRenderer.invoke('host:downloadCloudflared'),
    setPublic: input => ipcRenderer.invoke('host:setPublic', input),
    checkPublic: () => ipcRenderer.invoke('host:checkPublic'),
    getSettings: () => ipcRenderer.invoke('host:getSettings'),
    setSettings: input => ipcRenderer.invoke('host:setSettings', input),
  },
  cloudflareTest: () => ipcRenderer.invoke('net:cloudflareTest'),
});
