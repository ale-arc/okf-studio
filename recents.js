'use strict';
// Bibliotecas recentes do usuário. Persistido em
// app.getPath('userData')/recent-libraries.json — gerenciado pelo processo main.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const CAP = 20;

// Ordena (favoritas no topo, depois lastOpened desc) e aplica o teto CAP,
// descartando as não-favoritas mais antigas. Favoritas nunca são descartadas.
function sortAndCap(list) {
  const arr = (Array.isArray(list) ? list : []).slice().sort((a, b) => {
    if (!!b.favorite !== !!a.favorite) return a.favorite ? -1 : 1;
    return (b.lastOpened || 0) - (a.lastOpened || 0);
  });
  if (arr.length <= CAP) return arr;
  const favs = arr.filter(e => e.favorite);
  const rest = arr.filter(e => !e.favorite).slice(0, Math.max(0, CAP - favs.length));
  const keepPaths = new Set([...favs, ...rest].map(e => e.path));
  return arr.filter(e => keepPaths.has(e.path));
}

// Insere/atualiza por path (chave de dedup); preserva o favorite anterior.
function addEntry(list, entry, now) {
  const src = Array.isArray(list) ? list : [];
  const prev = src.find(e => e.path === entry.path);
  const arr = src.filter(e => e.path !== entry.path);
  arr.push({
    path: entry.path,
    name: entry.name,
    lastOpened: now,
    favorite: prev ? !!prev.favorite : false
  });
  return sortAndCap(arr);
}

function removeEntry(list, p) {
  return (Array.isArray(list) ? list : []).filter(e => e.path !== p);
}

function toggleFavorite(list, p) {
  const arr = (Array.isArray(list) ? list : []).map(e =>
    e.path === p ? Object.assign({}, e, { favorite: !e.favorite }) : e);
  return sortAndCap(arr);
}

// Acrescenta `exists` a cada item (não persistido). existsFn injetável p/ testes.
function enrichExists(list, existsFn) {
  const fn = existsFn || ((p) => fs.existsSync(p));
  return (Array.isArray(list) ? list : []).map(e => Object.assign({}, e, { exists: !!fn(e.path) }));
}

function recentsFile() {
  const { app } = require('electron');
  return path.join(app.getPath('userData'), 'recent-libraries.json');
}

async function readStore(file) {
  try {
    const data = JSON.parse(await fsp.readFile(file, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return []; // arquivo ausente ou inválido => lista vazia
  }
}

async function writeStore(file, list) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify(list, null, 2), 'utf8');
}

function registerRecentsHandlers(ipcMain) {
  ipcMain.handle('recents:list', async () => {
    const list = sortAndCap(await readStore(recentsFile()));
    return enrichExists(list);
  });
  ipcMain.handle('recents:add', async (_e, { path: p, name }) => {
    const file = recentsFile();
    const list = addEntry(await readStore(file), { path: p, name }, Date.now());
    await writeStore(file, list);
    return enrichExists(list);
  });
  ipcMain.handle('recents:remove', async (_e, { path: p }) => {
    const file = recentsFile();
    const list = sortAndCap(removeEntry(await readStore(file), p));
    await writeStore(file, list);
    return enrichExists(list);
  });
  ipcMain.handle('recents:toggleFavorite', async (_e, { path: p }) => {
    const file = recentsFile();
    const list = toggleFavorite(await readStore(file), p);
    await writeStore(file, list);
    return enrichExists(list);
  });
}

module.exports = {
  CAP, sortAndCap, addEntry, removeEntry, toggleFavorite, enrichExists,
  recentsFile, readStore, writeStore, registerRecentsHandlers
};
