'use strict';
// Gera build/icon.png (512) e build/icon.ico (256..16) a partir de build/logo.svg.
// Renderiza o SVG numa janela Electron transparente e captura com alpha; redimensiona
// via nativeImage (sem dependências nativas). Rode: npm run make:icon
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const buildDir = path.join(__dirname, '..', 'build');
const svg = fs.readFileSync(path.join(buildDir, 'logo.svg'), 'utf8');

app.whenReady().then(async () => {
  const N = 512;
  const html = '<!doctype html><html><head><meta charset="utf-8">' +
    '<style>html,body{margin:0;padding:0;background:transparent}svg{display:block;width:' + N + 'px;height:' + N + 'px}</style>' +
    '</head><body>' + svg + '</body></html>';

  const win = new BrowserWindow({
    width: N, height: N, show: false, frame: false, transparent: true,
    backgroundColor: '#00000000', useContentSize: true
  });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 400));

  const shot = await win.webContents.capturePage();
  const master = shot.resize({ width: 512, height: 512, quality: 'best' });
  fs.writeFileSync(path.join(buildDir, 'icon.png'), master.toPNG());

  const pngToIco = (await import('png-to-ico')).default; // png-to-ico v3 é ESM
  const sizes = [256, 128, 64, 48, 32, 16];
  const bufs = sizes.map((s) => master.resize({ width: s, height: s, quality: 'best' }).toPNG());
  const ico = await pngToIco(bufs);
  fs.writeFileSync(path.join(buildDir, 'icon.ico'), ico);

  console.log('OK: build/icon.png (512) e build/icon.ico (' + sizes.join(',') + ') gerados');
  app.exit(0);
});
