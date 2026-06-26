'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('okf', {
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  readBundle: (root) => ipcRenderer.invoke('bundle:read', root),
  readSample: () => ipcRenderer.invoke('bundle:sample'),
  writeFile: (payload) => ipcRenderer.invoke('file:write', payload),
  createFile: (payload) => ipcRenderer.invoke('file:create', payload),
  deleteFile: (payload) => ipcRenderer.invoke('file:delete', payload),
  applyOps: (payload) => ipcRenderer.invoke('fs:applyOps', payload),
  newLibraryDialog: () => ipcRenderer.invoke('dialog:newLibrary'),
  createLibrary: (payload) => ipcRenderer.invoke('library:create', payload),
  confirm: (payload) => ipcRenderer.invoke('app:confirm', payload),
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),
  getVersion: () => ipcRenderer.invoke('app:version'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateStatus: (cb) => ipcRenderer.on('update:status', (_e, payload) => cb(payload)),
  openClaude: () => ipcRenderer.invoke('claude:open'),
  exportPdf: (payload) => ipcRenderer.invoke('pdf:export', payload),
  openDocumentDialog: () => ipcRenderer.invoke('dialog:openDocument'),
  readBinary: (filePath) => ipcRenderer.invoke('file:readBinary', filePath),
  onBundleChanged: (cb) => ipcRenderer.on('bundle:changed', (_e, delta) => cb(delta)),
  git: {
    status: () => ipcRenderer.invoke('git:status'),
    commit: (message) => ipcRenderer.invoke('git:commit', message),
    push: () => ipcRenderer.invoke('git:push'),
    init: () => ipcRenderer.invoke('git:init')
  },
  templates: {
    list: () => ipcRenderer.invoke('templates:list'),
    save: (payload) => ipcRenderer.invoke('templates:save', payload),
    remove: (payload) => ipcRenderer.invoke('templates:delete', payload),
    restoreDefaults: () => ipcRenderer.invoke('templates:restoreDefaults'),
    dir: () => ipcRenderer.invoke('templates:dir')
  },
  recents: {
    list: () => ipcRenderer.invoke('recents:list'),
    add: (payload) => ipcRenderer.invoke('recents:add', payload),
    remove: (payload) => ipcRenderer.invoke('recents:remove', payload),
    toggleFavorite: (payload) => ipcRenderer.invoke('recents:toggleFavorite', payload)
  },
  onMenu: (channel, cb) => {
    const valid = [
      'menu:open-folder', 'menu:open-sample', 'menu:new-concept', 'menu:new-library',
      'menu:save', 'menu:reload', 'menu:validate', 'menu:graph', 'menu:about', 'menu:manual',
      'menu:rebuild-indexes', 'menu:templates', 'menu:export-pdf', 'menu:import-doc',
      'menu:switch-library', 'menu:health'
    ];
    if (valid.includes(channel)) ipcRenderer.on(channel, () => cb());
  }
});
