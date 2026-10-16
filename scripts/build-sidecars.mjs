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

const isWindows = target.includes('windows');
const exeExt = isWindows ? '.exe' : '';
const binaries = ['vsc-git-askpass', 'vsc-git-sequence-editor'];
const destDir = path.join(repoRoot, 'src-tauri', 'binaries');
fs.mkdirSync(destDir, { recursive: true });

const targetBase = process.env.CARGO_TARGET_DIR
  ? path.resolve(process.env.CARGO_TARGET_DIR)
  : path.join(repoRoot, 'target');

if (target === 'universal-apple-darwin') {
  const archTargets = ['aarch64-apple-darwin', 'x86_64-apple-darwin'];
  for (const t of archTargets) {
    const cargoArgs = ['build', '-p', 'askpass', '-p', 'sequence-editor', '--target', t];
    if (isRelease) cargoArgs.push('--release');
    execFileSync('cargo', cargoArgs, { cwd: repoRoot, stdio: 'inherit' });
  }

  for (const bin of binaries) {
    const pAarch64 = path.join(targetBase, 'aarch64-apple-darwin', profile, bin);
    const pX86_64 = path.join(targetBase, 'x86_64-apple-darwin', profile, bin);
    const destUniversal = path.join(destDir, `${bin}-universal-apple-darwin`);
    const destAarch64 = path.join(destDir, `${bin}-aarch64-apple-darwin`);
    const destX86_64 = path.join(destDir, `${bin}-x86_64-apple-darwin`);

    execFileSync('lipo', ['-create', pAarch64, pX86_64, '-output', destUniversal]);
    fs.chmodSync(destUniversal, 0o755);
    fs.copyFileSync(pAarch64, destAarch64);
    fs.chmodSync(destAarch64, 0o755);
    fs.copyFileSync(pX86_64, destX86_64);
    fs.chmodSync(destX86_64, 0o755);
    console.log(`Created universal binary for ${bin}`);
  }
} else {
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

  for (const bin of binaries) {
    const srcBinName = `${bin}${exeExt}`;
    let srcPath = path.join(targetBase, target, profile, srcBinName);
    if (!fs.existsSync(srcPath)) {
      srcPath = path.join(targetBase, profile, srcBinName);
    }
    if (!fs.existsSync(srcPath) && targetBase !== path.join(repoRoot, 'target')) {
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
}
console.log('Sidecars built successfully.');
