'use strict';
// Vigia a raiz da biblioteca e chama onChange (com debounce) em add/change/unlink.
const chokidar = require('chokidar');

function createWatcher(onChange) {
  let w = null;
  let timer = null;
  let paused = false;
  let pending = new Set();
  const fire = (p) => {
    if (paused) return;
    if (p) pending.add(p);
    clearTimeout(timer);
    timer = setTimeout(() => { const paths = [...pending]; pending.clear(); onChange(paths); }, 300);
  };
  const ignored = (p) =>
    /[\\/](\.git|node_modules|dist|\.superpowers)([\\/]|$)/.test(p) ||
    /[\\/]\.[^\\/]+$/.test(p);

  return {
    watch(root) {
      this.close();
      if (!root) return;
      w = chokidar.watch(root, { ignored, ignoreInitial: true });
      w.on('add', fire).on('change', fire).on('unlink', fire);
      // Sem um listener de 'error', o EventEmitter relança o erro como exceção
      // não tratada e derruba o app. Em pastas sincronizadas na nuvem (Google
      // Drive, OneDrive) o lstat pode falhar com EINVAL em arquivos placeholder;
      // registramos e ignoramos para não travar a vigilância da biblioteca.
      w.on('error', (err) => {
        try { console.error('[watcher] erro do sistema de arquivos ignorado:', (err && err.message) || err); } catch (_) {}
      });
    },
    pause() { paused = true; clearTimeout(timer); pending.clear(); },
    resume() { paused = false; },
    close() {
      if (w) { w.close(); w = null; }
      clearTimeout(timer);
    }
  };
}

module.exports = { createWatcher };
