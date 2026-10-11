'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function statIfPresent(filename) {
  try { return fs.lstatSync(filename); } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

function readAppCache(filename) {
  const cached = JSON.parse(fs.readFileSync(filename, 'utf8'));
  if (!cached || !/^bs:\/\/[A-Za-z0-9_-]+$/.test(cached.appUrl || '') ||
      typeof cached.source !== 'string' || !cached.source ||
      (cached.platform !== undefined && !['android', 'ios'].includes(cached.platform)) ||
      Object.keys(cached).some((key) => !['appUrl', 'source', 'platform', 'uploadedAt'].includes(key))) {
    throw new Error('Refusing to replace a file that is not an app upload cache.');
  }
  return cached;
}

function resolveCachePath(projectRoot, requested = '.runtime/browserstack/app.json') {
  if (typeof requested !== 'string' || !requested || path.posix.isAbsolute(requested) ||
      path.win32.parse(requested).root || requested.split(/[\\/]/).includes('..')) {
    throw new Error('App cache must be a relative JSON path under .runtime/browserstack.');
  }
  const root = path.resolve(projectRoot);
  const cacheRoot = path.join(root, '.runtime', 'browserstack');
  const candidate = path.resolve(root, requested);
  const relative = path.relative(cacheRoot, candidate);
  if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`) ||
      path.extname(candidate).toLowerCase() !== '.json') {
    throw new Error('App cache must be a relative JSON path under .runtime/browserstack.');
  }
  // lstat also catches dangling links; reject junctions and hard-linked cache files.
  for (let current = candidate; ; current = path.dirname(current)) {
    const stat = statIfPresent(current);
    if (stat?.isSymbolicLink()) throw new Error('App cache paths must not traverse symbolic links or junctions.');
    if (stat && current === candidate && (!stat.isFile() || stat.nlink !== 1)) {
      throw new Error('App cache must be a regular, single-link file.');
    }
    if (stat && current !== candidate && !stat.isDirectory()) throw new Error('App cache parent must be a directory.');
    if (current === root) break;
  }
  if (statIfPresent(candidate)) readAppCache(candidate);
  return candidate;
}

function writeAppCache(projectRoot, requested, data) {
  const destination = resolveCachePath(projectRoot, requested);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  resolveCachePath(projectRoot, requested);
  const temporary = path.join(path.dirname(destination), `.app-cache-${randomUUID()}.tmp`);
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(descriptor, JSON.stringify(data, null, 2));
    fs.closeSync(descriptor);
    descriptor = undefined;
    // Recheck after the upload/write; rename avoids truncating a linked destination.
    resolveCachePath(projectRoot, requested);
    fs.renameSync(temporary, destination);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (statIfPresent(temporary)) fs.unlinkSync(temporary);
  }
  return destination;
}

module.exports = { resolveCachePath, readAppCache, writeAppCache };
