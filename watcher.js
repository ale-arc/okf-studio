'use strict';
// Vigia a raiz da biblioteca e chama onChange (com debounce) em add/change/unlink.
const chokidar = require('chokidar');

function createWatcher(onChange) {
  let w = null;
  let timer = null;
  const fire = () => { clearTimeout(timer); timer = setTimeout(onChange, 300); };
  const ignored = (p) =>
    /[\\/](\.git|node_modules|dist|\.superpowers)([\\/]|$)/.test(p) ||
    /[\\/]\.[^\\/]+$/.test(p); // arquivos/pastas ocultos

  return {
    watch(root) {
      this.close();
      if (!root) return;
      w = chokidar.watch(root, { ignored, ignoreInitial: true });
      w.on('add', fire).on('change', fire).on('unlink', fire);
    },
    close() {
      if (w) { w.close(); w = null; }
      clearTimeout(timer);
    }
  };
}

module.exports = { createWatcher };
