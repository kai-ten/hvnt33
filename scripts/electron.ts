// Ensure Electron's platform binary exists. npm normally runs this installer,
// but restored caches and installs with lifecycle scripts disabled can leave the
// JavaScript package present without the executable. `npm run setup` repairs
// that state using Electron's own checksum-verified downloader.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const manifest = require.resolve('electron/package.json');
const home = path.dirname(manifest);
const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8')) as { version: string };
const platformPath = process.platform === 'darwin'
  ? 'Electron.app/Contents/MacOS/Electron'
  : process.platform === 'win32' ? 'electron.exe' : 'electron';
const binary = path.join(home, 'dist', platformPath);
const versionFile = path.join(home, 'dist', 'version');
const installed = fs.existsSync(binary)
  && fs.existsSync(versionFile)
  && fs.readFileSync(versionFile, 'utf8').trim().replace(/^v/, '') === pkg.version;

if (!installed) {
  console.log(`Downloading Electron ${pkg.version} for ${process.platform}-${process.arch}…`);
  execFileSync(process.execPath, [path.join(home, 'install.js')], { stdio: 'inherit' });
}
if (!fs.existsSync(binary)) throw Error(`Electron ${pkg.version} did not install at ${binary}`);
console.log(`Electron ${pkg.version} is installed.`);
