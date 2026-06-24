'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('okf', {
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  readBundle: (root) => ipcRenderer.invoke('bundle:read', root),
  readSample: () => ipcRenderer.invoke('bundle:sample'),
  writeFile: (payload) => ipcRenderer.invoke('file:write', payload),
  createFile: (payload) => ipcRenderer.invoke('file:create', payload),
  deleteFile: (payload) => ipcRenderer.invoke('file:delete', payload),
  confirm: (payload) => ipcRenderer.invoke('app:confirm', payload),
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),
  getVersion: () => ipcRenderer.invoke('app:version'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateStatus: (cb) => ipcRenderer.on('update:status', (_e, payload) => cb(payload)),
  onMenu: (channel, cb) => {
    const valid = [
      'menu:open-folder', 'menu:open-sample', 'menu:new-concept',
      'menu:save', 'menu:reload', 'menu:validate', 'menu:graph', 'menu:about'
    ];
    if (valid.includes(channel)) ipcRenderer.on(channel, () => cb());
  }
});
