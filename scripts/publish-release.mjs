// Publica UMA release no GitHub com todos os artefatos de uma vez (via gh CLI),
// evitando a corrida do publicador do electron-builder (que criava releases
// duplicadas com os assets divididos). Rode DEPOIS de `npm run dist`.
//
// Uso: node scripts/publish-release.mjs [--dry-run]
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const dryRun = process.argv.includes('--dry-run');
const repo = 'ale-arc/okf-studio';
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const tag = `v${version}`;

const files = [
  `dist/OKF-Studio-Setup-${version}-x64.exe`,
  `dist/OKF-Studio-Setup-${version}-x64.exe.blockmap`,
  `dist/OKF-Studio-Portable-${version}-x64.exe`,
  `dist/latest.yml`,
];

const missing = files.filter((f) => !existsSync(f));
if (missing.length) {
  console.error('Artefatos ausentes (rode "npm run dist" antes):\n  ' + missing.join('\n  '));
  process.exit(1);
}

const cmd = `gh release create ${tag} ${files.join(' ')} ` +
  `--repo ${repo} --title "OKF Studio ${version}" --generate-notes --latest`;

console.log(cmd);
if (dryRun) { console.log('[dry-run] release não criada.'); process.exit(0); }

execSync(cmd, { stdio: 'inherit' });
console.log(`\nRelease ${tag} publicada (latest).`);
