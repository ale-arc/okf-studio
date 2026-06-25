'use strict';

const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { createWatcher } = require('./watcher.js');
const { registerGitHandlers } = require('./git.js');

let mainWindow = null;
let manualUpdateCheck = false; // true when the user clicked "Verificar atualizações"
let currentRoot = null; // raiz da biblioteca aberta (cwd do terminal e do watcher)

// Observa a biblioteca aberta e avisa o renderer quando algo muda no disco.
const libWatcher = createWatcher(() => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('bundle:changed');
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'OKF Studio',
    backgroundColor: '#1e1f23',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  buildMenu();
  mainWindow.on('closed', () => { libWatcher.close(); mainWindow = null; });
}

function buildMenu() {
  const template = [
    {
      label: 'Arquivo',
      submenu: [
        {
          label: 'Abrir biblioteca…',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow.webContents.send('menu:open-folder')
        },
        {
          label: 'Abrir biblioteca de exemplo',
          click: () => mainWindow.webContents.send('menu:open-sample')
        },
        {
          label: 'Nova biblioteca…',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => mainWindow.webContents.send('menu:new-library')
        },
        { type: 'separator' },
        {
          label: 'Novo conceito…',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow.webContents.send('menu:new-concept')
        },
        {
          label: 'Salvar',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow.webContents.send('menu:save')
        },
        { type: 'separator' },
        { role: 'quit', label: 'Sair' }
      ]
    },
    {
      label: 'Exibir',
      submenu: [
        { label: 'Recarregar biblioteca', accelerator: 'CmdOrCtrl+R', click: () => mainWindow.webContents.send('menu:reload') },
        { label: 'Validar conformidade OKF', click: () => mainWindow.webContents.send('menu:validate') },
        { label: 'Reconstruir índices', click: () => mainWindow.webContents.send('menu:rebuild-indexes') },
        { label: 'Grafo de relacionamentos', click: () => mainWindow.webContents.send('menu:graph') },
        { type: 'separator' },
        { role: 'toggleDevTools', label: 'Ferramentas de desenvolvedor' },
        { role: 'resetZoom', label: 'Zoom padrão' },
        { role: 'zoomIn', label: 'Aumentar zoom' },
        { role: 'zoomOut', label: 'Diminuir zoom' }
      ]
    },
    {
      label: 'Ajuda',
      submenu: [
        { label: 'Manual do OKF Studio', accelerator: 'F1', click: () => mainWindow.webContents.send('menu:manual') },
        { type: 'separator' },
        { label: 'Verificar atualizações…', click: () => checkForUpdates(true) },
        { type: 'separator' },
        { label: 'Especificação OKF v0.1 (GitHub)', click: () => shell.openExternal('https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf') },
        { label: 'Sobre o OKF Studio', click: () => mainWindow.webContents.send('menu:about') }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- Helpers ----------------------------------------------------------------

const RESERVED = new Set(['index.md', 'log.md']);

async function walk(root, rel = '') {
  const out = [];
  const dir = path.join(root, rel);
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (e) {
    return out;
  }
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    if (ent.name === 'node_modules') continue;
    const childRel = rel ? path.posix.join(rel, ent.name) : ent.name;
    if (ent.isDirectory()) {
      out.push(...await walk(root, childRel));
    } else if (ent.isFile() && ent.name.toLowerCase().endsWith('.md')) {
      const full = path.join(root, childRel);
      const content = await fsp.readFile(full, 'utf8');
      const stat = await fsp.stat(full);
      out.push({
        relPath: childRel.split(path.sep).join('/'),
        name: ent.name,
        reserved: RESERVED.has(ent.name.toLowerCase()),
        content,
        mtime: stat.mtimeMs
      });
    }
  }
  return out;
}

function safeJoin(root, rel) {
  const target = path.resolve(root, rel);
  const normRoot = path.resolve(root);
  if (target !== normRoot && !target.startsWith(normRoot + path.sep)) {
    throw new Error('Caminho fora da biblioteca: ' + rel);
  }
  return target;
}

function sampleLibraryPath() {
  // packaged: resources/sample-library ; dev: ./sample-library
  const packaged = path.join(process.resourcesPath || '', 'sample-library');
  if (fs.existsSync(packaged)) return packaged;
  return path.join(__dirname, 'sample-library');
}

// ---- Auto-update ------------------------------------------------------------
// Updates the INSTALLED (NSIS) build in place — no reinstall needed. The portable
// build cannot self-update. Feed is configured via "build.publish" (GitHub).

function sendUpdateStatus(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update:status', payload);
}

function setupAutoUpdate() {
  autoUpdater.autoDownload = true;            // download as soon as an update is found
  autoUpdater.autoInstallOnAppQuit = true;    // install pending update on next quit

  autoUpdater.on('checking-for-update', () => sendUpdateStatus({ state: 'checking' }));

  autoUpdater.on('update-available', (info) => {
    manualUpdateCheck = false;
    sendUpdateStatus({ state: 'available', version: info.version });
  });

  autoUpdater.on('update-not-available', () => {
    sendUpdateStatus({ state: 'none' });
    if (manualUpdateCheck) {
      manualUpdateCheck = false;
      dialog.showMessageBox(mainWindow, {
        type: 'info', buttons: ['OK'], message: 'Você já está na versão mais recente',
        detail: 'OKF Studio ' + app.getVersion()
      });
    }
  });

  autoUpdater.on('download-progress', (p) => {
    sendUpdateStatus({ state: 'downloading', percent: Math.round(p.percent || 0) });
  });

  autoUpdater.on('update-downloaded', async (info) => {
    sendUpdateStatus({ state: 'downloaded', version: info.version });
    const res = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['Depois', 'Reiniciar e instalar'],
      defaultId: 1, cancelId: 0,
      message: 'Atualização pronta',
      detail: `A versão ${info.version} foi baixada. Reiniciar agora para instalar?\n` +
              'Se escolher "Depois", ela será instalada automaticamente ao fechar o app.'
    });
    if (res.response === 1) setImmediate(() => autoUpdater.quitAndInstall());
  });

  autoUpdater.on('error', (err) => {
    const message = String((err && err.message) || err);
    sendUpdateStatus({ state: 'error', message });
    if (manualUpdateCheck) {
      manualUpdateCheck = false;
      dialog.showMessageBox(mainWindow, {
        type: 'error', buttons: ['OK'],
        message: 'Não foi possível verificar atualizações', detail: message
      });
    }
  });
}

function checkForUpdates(manual) {
  if (!app.isPackaged) {
    if (manual) {
      dialog.showMessageBox(mainWindow, {
        type: 'info', buttons: ['OK'],
        message: 'Atualizações indisponíveis em modo de desenvolvimento',
        detail: 'Rode a versão instalada (.exe) para testar o auto-update.'
      });
    }
    return;
  }
  manualUpdateCheck = !!manual;
  autoUpdater.checkForUpdates().catch(() => {/* handled by the error event */});
}

// ---- IPC --------------------------------------------------------------------

ipcMain.handle('dialog:openFolder', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Selecione a pasta da biblioteca OKF',
    properties: ['openDirectory']
  });
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths[0];
});

ipcMain.handle('bundle:read', async (_e, root) => {
  const docs = await walk(root);
  currentRoot = root;
  libWatcher.watch(root);
  return { root, docs };
});

ipcMain.handle('bundle:sample', async () => {
  const root = sampleLibraryPath();
  const docs = await walk(root);
  currentRoot = root;
  libWatcher.watch(root);
  return { root, docs };
});

ipcMain.handle('file:write', async (_e, { root, relPath, content }) => {
  const target = safeJoin(root, relPath);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, content, 'utf8');
  return { ok: true };
});

ipcMain.handle('file:create', async (_e, { root, relPath, content }) => {
  const target = safeJoin(root, relPath);
  if (fs.existsSync(target)) throw new Error('Já existe um arquivo em ' + relPath);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, content, 'utf8');
  return { ok: true };
});

ipcMain.handle('file:delete', async (_e, { root, relPath }) => {
  const target = safeJoin(root, relPath);
  await fsp.rm(target, { force: true });
  return { ok: true };
});

ipcMain.handle('fs:applyOps', async (_e, { root, ops }) => {
  libWatcher.pause();
  let applied = 0;
  try {
    for (const op of (ops || [])) {
      if (op.op === 'create' || op.op === 'write') {
        const target = safeJoin(root, op.relPath);
        if (op.op === 'create' && fs.existsSync(target)) throw new Error('Já existe um arquivo em ' + op.relPath);
        await fsp.mkdir(path.dirname(target), { recursive: true });
        await fsp.writeFile(target, op.content, 'utf8');
      } else if (op.op === 'delete') {
        await fsp.rm(safeJoin(root, op.relPath), { force: true });
      } else {
        throw new Error('Operação desconhecida: ' + op.op);
      }
      applied++;
    }
    return { ok: true, applied };
  } catch (e) {
    return { ok: false, applied, error: String((e && e.message) || e) };
  } finally {
    libWatcher.resume();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('bundle:changed');
  }
});

function claudeTemplatePath() {
  const packaged = path.join(process.resourcesPath || '', 'okf-template', 'CLAUDE.md');
  if (fs.existsSync(packaged)) return packaged;
  return path.join(__dirname, 'tools', 'okf-template', 'CLAUDE.md');
}

ipcMain.handle('dialog:newLibrary', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Escolha (ou crie) a pasta da nova biblioteca OKF',
    properties: ['openDirectory', 'createDirectory']
  });
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths[0];
});

ipcMain.handle('library:create', async (_e, { dir, files }) => {
  try {
    const conflicts = ['index.md', 'log.md', 'CLAUDE.md'].filter(f => fs.existsSync(path.join(dir, f)));
    if (conflicts.length) return { ok: false, error: 'A pasta já contém: ' + conflicts.join(', ') };
    libWatcher.pause();
    try {
      for (const f of (files || [])) {
        const target = safeJoin(dir, f.relPath);
        await fsp.mkdir(path.dirname(target), { recursive: true });
        await fsp.writeFile(target, f.content, 'utf8');
      }
      await fsp.copyFile(claudeTemplatePath(), path.join(dir, 'CLAUDE.md'));
    } finally {
      libWatcher.resume();
    }
    return { ok: true, root: dir };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

ipcMain.handle('app:confirm', async (_e, { message, detail }) => {
  const res = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Cancelar', 'Confirmar'],
    defaultId: 1,
    cancelId: 0,
    message: message || 'Confirmar?',
    detail: detail || ''
  });
  return res.response === 1;
});

ipcMain.handle('shell:open', async (_e, url) => {
  if (/^https?:\/\//i.test(url)) await shell.openExternal(url);
  return true;
});

// Abre o Claude Code num terminal externo (PowerShell) já na pasta da biblioteca.
ipcMain.handle('claude:open', async () => {
  if (!currentRoot) return { ok: false, error: 'Abra uma biblioteca primeiro.' };
  try {
    // `start` abre uma nova janela de console; /D define a pasta de trabalho.
    spawn('cmd.exe',
      ['/c', 'start', '', '/D', currentRoot, 'powershell.exe', '-NoExit', '-Command', 'claude'],
      { detached: true, stdio: 'ignore' }).unref();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

ipcMain.handle('app:version', async () => app.getVersion());
ipcMain.handle('update:check', async () => { checkForUpdates(true); return true; });
ipcMain.handle('update:install', async () => { setImmediate(() => autoUpdater.quitAndInstall()); return true; });

registerGitHandlers(ipcMain, () => currentRoot);

app.whenReady().then(() => {
  createWindow();
  setupAutoUpdate();
  // Check shortly after launch so the window is ready to receive status events.
  mainWindow.webContents.once('did-finish-load', () => setTimeout(() => checkForUpdates(false), 3000));
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
