#!/usr/bin/env node
// Build repository.json + bundles/Testing-<N>.zip for this testing repository.
//
// Format matches the community testing-repository schema used by Synthetiq Player
// indexes (schemaVersion 1: modules[] with packageUrl/packagePath/sha256, a
// "bundle" zip of all active packages, and a compact testingIdentity string).
//
// Rules:
//   - modules/*.zip are the candidate packages (flat module ZIPs).
//   - File names listed in retired-packages.json are skipped (retired, not deleted).
//   - bundle.version increments on every content change; old bundles are kept.
//   - Everything is generated from the ZIP contents, so hashes always match bytes.
//
// Usage:  node tools/build.cjs
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const MODULES_DIR = path.join(ROOT, 'modules');
const BUNDLES_DIR = path.join(ROOT, 'bundles');
const REPO_ID = 'testing-modules-1234';
const REPO_NAME = 'Testing Modules 1234';
const REPO_BASE = 'https://raw.githubusercontent.com/Giaxina/testing-modules-1234/main/';
const BUNDLE_PREFIX = 'Testing';

/* ------------------------------------------------------------ zip helpers */

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipWrite(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const data = Buffer.from(entry.data);
    const deflated = zlib.deflateRawSync(data);
    const useDeflate = deflated.length < data.length;
    const method = useDeflate ? 8 : 0;
    const body = useDeflate ? deflated : data;
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6);          // UTF-8 names
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0x21, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    parts.push(lh, nameBuf, body);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + body.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralBuf, end]);
}

function readZipEntry(buf, wanted) {
  let eocd = -1;
  const min = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= min; i--) {
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
      const start = localOff + 30 + lNameLen + lExtraLen;
      const data = buf.subarray(start, start + compSize);
      if (method === 0) return data;
      if (method === 8) return zlib.inflateRawSync(data);
      throw new Error('unsupported zip method ' + method);
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(wanted + ' not found inside ' + 'zip');
}

const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/* ------------------------------------------------------------------- build */

const retiredPath = path.join(ROOT, 'retired-packages.json');
let retired = fs.existsSync(retiredPath) ? JSON.parse(fs.readFileSync(retiredPath, 'utf8')) : [];
if (!Array.isArray(retired) || retired.some(x => typeof x !== 'string')) {
  throw new Error('retired-packages.json must be an array of ZIP file names');
}

const files = fs.readdirSync(MODULES_DIR)
  .filter(f => f.toLowerCase().endsWith('.zip') && !retired.includes(f))
  .sort();

const active = files.map(file => {
  const full = path.join(MODULES_DIR, file);
  const manifest = JSON.parse(readZipEntry(fs.readFileSync(full), 'module.json').toString('utf8'));
  return { file, manifest, full };
});

const idSet = new Set(active.map(a => a.manifest.id));
if (idSet.size !== active.length) throw new Error('Duplicate module id among active packages');
active.sort((a, b) => a.file.localeCompare(b.file));

const minAppVersion = m => (m.config && m.config.capabilities && m.config.capabilities.live_discovery_v1 === true) ? '9.0.0' : '8.0.0';

function docsNote(name, version) {
  const docsDir = path.join(ROOT, 'docs');
  const prefix = String(name).replace(/[^A-Za-z0-9]/g, '') + '-' + version;
  if (fs.existsSync(docsDir)) {
    const hit = fs.readdirSync(docsDir).find(f => f.startsWith(prefix) && f.endsWith('.md'));
    if (hit) return 'See docs/' + hit;
  }
  return 'See repository QA notes.';
}

function changelogFor(manifest) {
  return (Array.isArray(manifest.changelog) ? manifest.changelog : [])
    .concat(['TEST CANDIDATE: not certified for stable release. ' + docsNote(manifest.name, manifest.moduleVersion)]);
}

const identity = active.map(a => a.manifest.id + ':' + a.manifest.moduleVersion + ':' + sha256(a.full)).join('|');
const changelogFingerprint = JSON.stringify(active.map(a => changelogFor(a.manifest)));
const repoJsonPath = path.join(ROOT, 'repository.json');
const previous = fs.existsSync(repoJsonPath) ? JSON.parse(fs.readFileSync(repoJsonPath, 'utf8')) : null;
if (previous && previous.testingIdentity === identity && previous.enabled === !!active.length
    && JSON.stringify((previous.modules || []).map(m => m.changelog)) === changelogFingerprint) {
  console.log('repository.json is up to date; nothing rebuilt.');
  process.exit(0);
}

let maxExistingBundle = 0;
if (fs.existsSync(BUNDLES_DIR)) {
  for (const f of fs.readdirSync(BUNDLES_DIR)) {
    const m = f.match(new RegExp('^' + BUNDLE_PREFIX + '-(\\d+)\\.zip$'));
    if (m) maxExistingBundle = Math.max(maxExistingBundle, Number(m[1]));
  }
}
const bundleVersion = Math.max(((previous && previous.bundle && previous.bundle.version) || 0), maxExistingBundle) + 1;
const publishedAtMs = Date.now();

fs.mkdirSync(BUNDLES_DIR, { recursive: true });
const bundleFile = BUNDLE_PREFIX + '-' + bundleVersion + '.zip';
const bundlePath = path.join(BUNDLES_DIR, bundleFile);
fs.writeFileSync(bundlePath, zipWrite(active.map(a => ({ name: a.file, data: fs.readFileSync(a.full) }))));

function infoFor(relFile) {
  const url = REPO_BASE + relFile;
  return {
    packageUrl: url,
    packagePath: new URL(url).pathname,
    sha256: sha256(path.join(ROOT, relFile)),
    signature: ''
  };
}

const modules = active.map(({ file, manifest }) => {
  const pres = Object.assign({}, manifest.presentation || {});
  pres.recommended = false;
  pres.purpose = 'Testing only';
  return {
    moduleId: manifest.id,
    moduleFamilyId: manifest.moduleFamilyId,
    moduleIdentity: manifest.moduleIdentity,
    moduleIdentityNumber: manifest.moduleIdentityNumber,
    contentType: manifest.contentType,
    version: manifest.moduleVersion,
    ...infoFor('modules/' + file),
    minAppVersion: minAppVersion(manifest),
    publishedAtMs,
    presentation: pres,
    changelog: changelogFor(manifest)
  };
});

const repository = {
  schemaVersion: 1,
  repositoryId: REPO_ID,
  name: REPO_NAME,
  enabled: !!active.length,
  publishedAtMs,
  signature: '',
  testingIdentity: identity,
  bundle: {
    version: bundleVersion,
    ...infoFor('bundles/' + bundleFile),
    minAppVersion: active.some(a => minAppVersion(a.manifest) === '9.0.0') ? '9.0.0' : '8.0.0'
  },
  modules
};

fs.writeFileSync(repoJsonPath, JSON.stringify(repository, null, 2) + '\n');
console.log('repository.json: ' + modules.length + ' module(s), bundle Testing-' + bundleVersion + '.zip');
modules.forEach(m => console.log('  ' + m.moduleId + '@' + m.version + ' sha256=' + m.sha256.slice(0, 12) + '...'));
