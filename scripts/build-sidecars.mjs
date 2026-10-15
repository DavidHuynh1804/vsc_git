#!/usr/bin/env node

import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

let target = process.env.TAURI_ENV_TARGET_TRIPLE || null;
let isRelease = false;

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--release') {
    isRelease = true;
  } else if (arg === '--target' && i + 1 < args.length) {
    target = args[++i];
  } else if (arg.startsWith('--target=')) {
    target = arg.slice('--target='.length);
  }
}

function getHostTriple() {
  try {
    const output = execSync('rustc -vV', { encoding: 'utf-8' });
    for (const line of output.split('\n')) {
      if (line.startsWith('host: ')) {
        return line.slice('host: '.length).trim();
      }
    }
  } catch (err) {
    console.error('Failed to query host triple with rustc -vV:', err);
  }
  return null;
}

const hostTriple = getHostTriple();
if (!target) {
  target = hostTriple;
}

if (!target) {
  console.error('Error: target triple could not be determined.');
  process.exit(1);
}

const profile = isRelease ? 'release' : 'debug';
console.log(`Building sidecars for target: ${target} (${profile})...`);

const cargoArgs = ['build', '-p', 'askpass', '-p', 'sequence-editor'];
if (isRelease) {
  cargoArgs.push('--release');
}
if (target !== hostTriple && target) {
  cargoArgs.push('--target', target);
}

execFileSync('cargo', cargoArgs, {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

const isWindows = target.includes('windows');
const exeExt = isWindows ? '.exe' : '';
const binaries = ['vsc-git-askpass', 'vsc-git-sequence-editor'];

const destDir = path.join(repoRoot, 'src-tauri', 'binaries');
fs.mkdirSync(destDir, { recursive: true });

const targetBase = process.env.CARGO_TARGET_DIR
  ? path.resolve(process.env.CARGO_TARGET_DIR)
  : path.join(repoRoot, 'target');

for (const bin of binaries) {
  const srcBinName = `${bin}${exeExt}`;
  let srcPath = path.join(targetBase, target, profile, srcBinName);
  if (!fs.existsSync(srcPath)) {
    srcPath = path.join(targetBase, profile, srcBinName);
  }
  if (!fs.existsSync(srcPath) && targetBase !== path.join(repoRoot, 'target')) {
    // Fallback to repo target if CARGO_TARGET_DIR didn't produce the binary
    srcPath = path.join(repoRoot, 'target', target, profile, srcBinName);
    if (!fs.existsSync(srcPath)) {
      srcPath = path.join(repoRoot, 'target', profile, srcBinName);
    }
  }

  const destBinName = `${bin}-${target}${exeExt}`;
  const destPath = path.join(destDir, destBinName);

  fs.copyFileSync(srcPath, destPath);
  if (!isWindows) {
    fs.chmodSync(destPath, 0o755);
  }
  console.log(`Copied ${srcBinName} -> ${destBinName}`);
}

console.log('Sidecars built successfully.');
