// test-convert-ui.js — smoke do bundle de conversão no renderer (TXT/HTML sob CSP).
// Carrega renderer/vendor/convert.bundle.js (global OKFConvert) num BrowserWindow real,
// usando a MESMA CSP de renderer/index.html, e valida os caminhos não-OCR (TXT/HTML).
'use strict';

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const SMOKE_HTML = path.join(__dirname, 'renderer', '_smoke.html');
const CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval' blob:; worker-src 'self' blob:; img-src 'self' data: blob:;";

const HTML = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="${CSP}" />
  <title>convert smoke</title>
</head>
<body>
  <div id="ready">loading</div>
  <script src="vendor/convert.bundle.js"></script>
</body>
</html>`;

// Roda no contexto da página via executeJavaScript (não é bloqueado pelo script-src
// da CSP por ser uma chamada privilegiada). Deve resolver com um objeto serializável.
const ASSERTIONS = `(async () => {
  try {
    if (typeof window.OKFConvert !== 'object' || window.OKFConvert === null) {
      return { ok: false, why: 'window.OKFConvert não é object (typeof=' + (typeof window.OKFConvert) + ')' };
    }
    if (typeof window.OKFConvert.convert !== 'function') {
      return { ok: false, why: 'window.OKFConvert.convert não é function (typeof=' + (typeof window.OKFConvert.convert) + ')' };
    }

    const txtRes = await window.OKFConvert.convert(new TextEncoder().encode('# Oi\\n\\nlinha'), 'txt');
    const txtMd = txtRes && txtRes.markdown;
    if (typeof txtMd !== 'string') {
      return { ok: false, why: 'TXT: markdown ausente/!string (typeof=' + (typeof txtMd) + ')' };
    }
    if (txtMd.indexOf('# Oi') === -1) {
      return { ok: false, why: 'TXT: markdown não contém "# Oi" -> ' + JSON.stringify(txtMd) };
    }
    if (txtMd.indexOf('linha') === -1) {
      return { ok: false, why: 'TXT: markdown não contém "linha" -> ' + JSON.stringify(txtMd) };
    }

    const htmlRes = await window.OKFConvert.convert(new TextEncoder().encode('<h1>Título</h1><p><strong>x</strong></p>'), 'html');
    const htmlMd = htmlRes && htmlRes.markdown;
    if (typeof htmlMd !== 'string') {
      return { ok: false, why: 'HTML: markdown ausente/!string (typeof=' + (typeof htmlMd) + ')' };
    }
    if (htmlMd.indexOf('# Título') === -1) {
      return { ok: false, why: 'HTML: markdown não contém "# Título" -> ' + JSON.stringify(htmlMd) };
    }
    if (htmlMd.indexOf('**x**') === -1) {
      return { ok: false, why: 'HTML: markdown não contém "**x**" -> ' + JSON.stringify(htmlMd) };
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, why: 'exceção no contexto da página: ' + (e && e.stack ? e.stack : String(e)) };
  }
})()`;

async function main() {
  await app.whenReady();

  let win;
  try {
    win = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    fs.writeFileSync(SMOKE_HTML, HTML, 'utf-8');

    await win.loadFile('renderer/_smoke.html');

    const result = await win.webContents.executeJavaScript(ASSERTIONS, true);

    if (result && result.ok) {
      console.log('CONVERT UI SMOKE OK');
      cleanup();
      app.exit(0);
      return;
    }

    console.error('CONVERT UI SMOKE FAIL: ' + (result ? result.why : 'resultado vazio'));
    cleanup();
    app.exit(1);
  } catch (err) {
    console.error('CONVERT UI SMOKE FAIL (main): ' + (err && err.stack ? err.stack : String(err)));
    cleanup();
    app.exit(1);
  }
}

function cleanup() {
  try {
    if (fs.existsSync(SMOKE_HTML)) fs.unlinkSync(SMOKE_HTML);
  } catch (e) {
    console.error('aviso: falha ao remover _smoke.html: ' + String(e));
  }
}

main();
