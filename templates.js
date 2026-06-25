'use strict';
// Modelos de conceito do USUÁRIO (fora de qualquer biblioteca).
// Cada modelo é um .md em app.getPath('userData')/templates/. Nome do arquivo = nome do modelo.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const DEFAULTS = [
  { name: 'Em branco', content: 'Descreva aqui.\n' },
  { name: 'Projeto', content: '---\ntype: Projeto\n---\n\n## Objetivo\n\n\n## Status\n\n\n## Marcos\n\n' },
  { name: 'Processo', content: '---\ntype: Processo\n---\n\n## Quando usar\n\n\n## Passos\n\n1. \n\n## Responsáveis\n\n' },
  { name: 'Métrica', content: '---\ntype: Métrica\n---\n\n## Definição\n\n\n## Como calcular\n\n\n## Fonte\n\n' },
  { name: 'Referência', content: '---\ntype: Referência\n---\n\n## Resumo\n\n\n## Detalhes\n\n' },
  { name: 'Playbook', content: '---\ntype: Playbook\n---\n\n## Gatilho\n\n\n## Passos\n\n1. \n\n## Pós-ação\n\n' },
];

const INVALID = /[\/\\:*?"<>|]/;
function sanitizeName(name) {
  const n = String(name == null ? '' : name).trim();
  if (!n) throw new Error('Nome do modelo vazio.');
  if (INVALID.test(n)) throw new Error('Nome inválido (não use / \\ : * ? " < > |).');
  return n;
}

function templatesDir() {
  const { app } = require('electron');
  return path.join(app.getPath('userData'), 'templates');
}

function safeTemplatePath(name) {
  const dir = templatesDir();
  const target = path.resolve(dir, sanitizeName(name) + '.md');
  if (path.dirname(target) !== path.resolve(dir)) throw new Error('Caminho de modelo inválido.');
  return target;
}

function registerTemplateHandlers(ipcMain) {
  ipcMain.handle('templates:list', async () => {
    const dir = templatesDir();
    if (!fs.existsSync(dir)) {
      await fsp.mkdir(dir, { recursive: true });
      for (const t of DEFAULTS) await fsp.writeFile(path.join(dir, t.name + '.md'), t.content, 'utf8');
    }
    const out = [];
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
        out.push({ name: e.name.replace(/\.md$/i, ''), content: await fsp.readFile(path.join(dir, e.name), 'utf8') });
      }
    }
    out.sort((a, b) => a.name === 'Em branco' ? -1 : b.name === 'Em branco' ? 1 : a.name.localeCompare(b.name));
    return out;
  });

  ipcMain.handle('templates:save', async (_e, { name, content, oldName }) => {
    try {
      const safeNew = sanitizeName(name);
      const target = safeTemplatePath(safeNew);
      const renaming = oldName && sanitizeName(oldName) !== safeNew;
      const creating = !oldName;
      if ((creating || renaming) && fs.existsSync(target)) {
        return { ok: false, error: 'Já existe um modelo chamado "' + safeNew + '".' };
      }
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, content, 'utf8');
      if (renaming) await fsp.rm(safeTemplatePath(oldName), { force: true });
      return { ok: true };
    } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  });

  ipcMain.handle('templates:delete', async (_e, { name }) => {
    try { await fsp.rm(safeTemplatePath(name), { force: true }); return { ok: true }; }
    catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  });

  ipcMain.handle('templates:restoreDefaults', async () => {
    const dir = templatesDir();
    await fsp.mkdir(dir, { recursive: true });
    let created = 0;
    for (const t of DEFAULTS) {
      const p = path.join(dir, t.name + '.md');
      if (!fs.existsSync(p)) { await fsp.writeFile(p, t.content, 'utf8'); created++; }
    }
    return { ok: true, created };
  });

  ipcMain.handle('templates:dir', async () => templatesDir());
}

module.exports = { DEFAULTS, sanitizeName, templatesDir, safeTemplatePath, registerTemplateHandlers };
