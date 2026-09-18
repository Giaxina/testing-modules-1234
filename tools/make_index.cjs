#!/usr/bin/env node
// Rebuild index.json + retired-packages.json for this repository.
//
// Scans modules/*.zip (flat module packages: module.json + index.js at the ZIP
// root). Reads each package's manifest straight from the ZIP, keeps the NEWEST
// version of each module id live, and lists older versions in
// retired-packages.json (retired, not deleted).
//
// Usage:  node tools/make_index.cjs
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const MODULES_DIR = path.join(ROOT, 'modules');
const REPO_RAW = 'https://raw.githubusercontent.com/Giaxina/testing-modules-1234/main';

function readZipEntry(buf, wanted) {
  let eocd = -1;
  const minEocd = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= minEocd; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('EOCD not found');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('bad central directory');
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    if (name === wanted) {
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const data = buf.subarray(dataStart, dataStart + compSize);
      if (method === 0) return data;
      if (method === 8) return zlib.inflateRawSync(data);
      throw new Error('unsupported zip method ' + method);
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(wanted + ' not found inside zip');
}

function ver(v) {
  const m = String(v || '').match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
}
function cmpVerDesc(a, b) {
  const A = ver(a), B = ver(b);
  for (let i = 0; i < 3; i++) if (A[i] !== B[i]) return B[i] - A[i];
  return 0;
}

const zips = fs.readdirSync(MODULES_DIR).filter(f => f.toLowerCase().endsWith('.zip')).sort();
const byId = {};
const problems = [];
for (const f of zips) {
  const full = path.join(MODULES_DIR, f);
  const buf = fs.readFileSync(full);
  let manifest;
  try { manifest = JSON.parse(readZipEntry(buf, 'module.json').toString('utf8')); }
  catch (e) { problems.push(f + ': ' + e.message); continue; }
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  const shaFile = full + '.sha256';
  if (fs.existsSync(shaFile)) {
    const want = fs.readFileSync(shaFile, 'utf8').trim().split(/\s+/)[0];
    if (want && want !== sha) problems.push(f + ': .sha256 file mismatch');
  }
  const entry = {
    id: manifest.id,
    name: manifest.name,
    contentType: manifest.contentType,
    contractVersion: manifest.contractVersion,
    moduleVersion: manifest.moduleVersion,
    moduleFamilyId: manifest.moduleFamilyId,
    moduleIdentity: manifest.moduleIdentity,
    moduleIdentityNumber: manifest.moduleIdentityNumber,
    releaseTrack: manifest.releaseTrack,
    moduleStatus: manifest.moduleStatus,
    description: manifest.description || '',
    file: 'modules/' + f,
    url: REPO_RAW + '/modules/' + f,
    sha256: sha,
    sizeBytes: buf.length
  };
  (byId[manifest.id] = byId[manifest.id] || []).push(entry);
}

const packages = [];
const retired = [];
for (const id of Object.keys(byId)) {
  const list = byId[id].sort((a, b) => cmpVerDesc(a.moduleVersion, b.moduleVersion));
  packages.push(list[0]);
  for (let i = 1; i < list.length; i++) retired.push(list[i]);
}

const index = {
  schema: 'synthetiq-testing-repository/1',
  name: 'Testing Modules 1234',
  description: 'Unofficial testing repository for Synthetiq Player modules. Import at your own risk; modules target live third-party sources.',
  updatedAt: new Date().toISOString(),
  packages: packages
};
fs.writeFileSync(path.join(ROOT, 'index.json'), JSON.stringify(index, null, 2) + '\n');
fs.writeFileSync(path.join(ROOT, 'retired-packages.json'), JSON.stringify({
  schema: 'synthetiq-testing-repository/1',
  note: 'Retired package versions are kept for rollback; they are not offered as current.',
  packages: retired
}, null, 2) + '\n');

console.log('index.json packages: ' + packages.map(p => p.id + '@' + p.moduleVersion).join(', '));
console.log('retired entries: ' + retired.length);
if (problems.length) {
  console.log('WARNINGS:');
  problems.forEach(p => console.log(' - ' + p));
  process.exitCode = 1;
}
