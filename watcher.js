'use strict';
// Vigia a raiz da biblioteca e chama onChange (com debounce) em add/change/unlink.
const chokidar = require('chokidar');

function createWatcher(onChange) {
  let w = null;
  let timer = null;
  let paused = false;
  const fire = () => { if (paused) return; clearTimeout(timer); timer = setTimeout(onChange, 300); };
  const ignored = (p) =>
    /[\\/](\.git|node_modules|dist|\.superpowers)([\\/]|$)/.test(p) ||
    /[\\/]\.[^\\/]+$/.test(p);

  return {
    watch(root) {
      this.close();
      if (!root) return;
      w = chokidar.watch(root, { ignored, ignoreInitial: true });
      w.on('add', fire).on('change', fire).on('unlink', fire);
    },
    pause() { paused = true; clearTimeout(timer); },
    resume() { paused = false; },
    close() {
      if (w) { w.close(); w = null; }
      clearTimeout(timer);
    }
  };
}

module.exports = { createWatcher };
