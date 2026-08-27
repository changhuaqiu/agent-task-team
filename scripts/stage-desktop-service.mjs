import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const generatedRoot = path.resolve(root, 'src-tauri', 'gen');
const serviceRoot = path.join(generatedRoot, 'service');

if (!serviceRoot.startsWith(`${generatedRoot}${path.sep}`)) {
  throw new Error(`refusing to stage outside generated root: ${serviceRoot}`);
}

function materializeContents(source, target) {
  if (!existsSync(source)) throw new Error(`desktop service source is missing: ${source}`);
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source)) {
    materialize(path.join(source, entry), path.join(target, entry));
  }
}

function materialize(source, target) {
  const stat = lstatSync(source);
  if (stat.isSymbolicLink()) {
    materialize(realpathSync(source), target);
    return;
  }
  if (stat.isDirectory()) {
    materializeContents(source, target);
    return;
  }
  mkdirSync(path.dirname(target), { recursive: true });
  cpSync(source, target);
}

rmSync(serviceRoot, { recursive: true, force: true });
materializeContents(path.join(root, '.next', 'standalone'), serviceRoot);
materializeContents(
  path.join(root, '.next', 'standalone', 'node_modules', '.pnpm', 'node_modules'),
  path.join(serviceRoot, 'node_modules'),
);
materializeContents(path.join(root, '.next', 'node_modules'), path.join(serviceRoot, 'node_modules'));
materializeContents(path.join(root, '.next', 'static'), path.join(serviceRoot, '.next', 'static'));
materializeContents(path.join(root, 'public'), path.join(serviceRoot, 'public'));

const allowedRootEntries = new Set(['.next', 'node_modules', 'public', 'server.js', 'package.json']);
for (const entry of readdirSync(serviceRoot)) {
  if (!allowedRootEntries.has(entry)) {
    rmSync(path.join(serviceRoot, entry), { recursive: true, force: true });
  }
}

for (const forbidden of ['.ath', path.join('src-tauri', 'target'), path.join('src-tauri', 'gen')]) {
  if (existsSync(path.join(serviceRoot, forbidden))) {
    throw new Error(`desktop service unexpectedly contains ${forbidden}`);
  }
}

for (const required of allowedRootEntries) {
  if (!existsSync(path.join(serviceRoot, required))) {
    throw new Error(`desktop service is missing required root entry ${required}`);
  }
}

process.stdout.write(`${serviceRoot}\n`);
