'use strict';
// Ordena ops do fs:applyOps: creates/writes antes de deletes (estável dentro de
// cada grupo). Garante que uma falha parcial nunca apague conteúdo antes de a
// substituição existir no disco.
function orderOps(ops) {
  const arr = Array.isArray(ops) ? ops : [];
  const writes = arr.filter(o => o && o.op !== 'delete');
  const deletes = arr.filter(o => o && o.op === 'delete');
  return writes.concat(deletes);
}

module.exports = { orderOps };
