#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const pluginsDir = join(root, 'plugins');
const distDir = join(root, 'dist');
const indexPath = join(root, 'index.json');
const reservedPath = join(root, 'reserved-ids.json');
const checkOnly = process.argv.includes('--check');
const errors = [];

function error(message) {
  errors.push(message);
}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }

  return 0;
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (exception) {
    error(`${label}: invalid JSON (${exception.message})`);
    return null;
  }
}

const reserved = readJson(reservedPath, 'reserved-ids.json');
const reservedIds = new Set(Array.isArray(reserved) ? reserved : []);
if (!Array.isArray(reserved)) {
  error('reserved-ids.json must be a JSON array of plugin ids');
}

const existingIndex = existsSync(indexPath)
  ? readJson(indexPath, 'index.json') ?? { schemaVersion: 1, plugins: [] }
  : { schemaVersion: 1, plugins: [] };
const existingById = new Map((existingIndex.plugins ?? []).map((plugin) => [plugin.id, plugin]));

const entries = [];
const seenIds = new Set();

if (!existsSync(pluginsDir)) {
  error('plugins directory is missing');
} else {
  const pluginDirectories = readdirSync(pluginsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith('.') && !name.startsWith('_'))
    .sort();

  for (const id of pluginDirectories) {
    seenIds.add(id);
    const pluginDir = join(pluginsDir, id);
    const descriptorPath = join(pluginDir, 'plugin.json');
    const logoPath = join(pluginDir, 'logo.png');

    if (!existsSync(descriptorPath)) {
      error(`plugins/${id}: missing plugin.json`);
      continue;
    }

    const descriptor = readJson(descriptorPath, `plugins/${id}/plugin.json`);
    if (!descriptor) {
      continue;
    }

    if (descriptor.id !== id) {
      error(`plugins/${id}: plugin.json id '${descriptor.id}' must match the folder name '${id}'`);
    }
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) {
      error(`plugins/${id}: invalid id (lowercase letters, digits, dot, underscore, hyphen)`);
    }
    if (!descriptor.name) {
      error(`plugins/${id}: missing name`);
    }
    if (!descriptor.version || !parseVersion(String(descriptor.version))) {
      error(`plugins/${id}: version is required and must be major.minor.patch`);
    }
    if (!descriptor.publisher) {
      error(`plugins/${id}: missing publisher`);
    }
    if (!descriptor.homepage || !isHttpsUrl(descriptor.homepage)) {
      error(`plugins/${id}: homepage is required and must be an HTTPS URL`);
    }
    if (descriptor.releaseNotesUrl && !isHttpsUrl(descriptor.releaseNotesUrl)) {
      error(`plugins/${id}: releaseNotesUrl must be an HTTPS URL`);
    }
    if (!descriptor.commands?.launch?.executable) {
      error(`plugins/${id}: missing commands.launch`);
    }
    if (reservedIds.has(id)) {
      error(`plugins/${id}: id is reserved for a CLIHub built-in plugin`);
    }
    if (descriptor.schemaVersion != null && descriptor.schemaVersion !== 1) {
      error(`plugins/${id}: unsupported schemaVersion ${descriptor.schemaVersion}`);
    }

    const minAppVersion = descriptor.minAppVersion ?? '0.0.0';
    if (!parseVersion(String(minAppVersion))) {
      error(`plugins/${id}: minAppVersion must be major.minor.patch`);
    }

    const prior = existingById.get(id);
    const version = String(descriptor.version ?? '');
    const currentVersion = parseVersion(version);

    const descriptorHash = sha256(stableStringify(descriptor));
    const logoHash = existsSync(logoPath) ? sha256(readFileSync(logoPath)) : '';
    const contentHash = sha256(Buffer.from(`${descriptorHash}\n${logoHash}`, 'utf8'));

    if (prior) {
      const priorVersion = parseVersion(String(prior.version ?? ''));
      if (priorVersion && currentVersion && compareVersions(currentVersion, priorVersion) < 0) {
        error(`plugins/${id}: version ${version} is older than the published ${prior.version}; versions must increase`);
        continue;
      }

      if (prior.version === version) {
        if (!prior.contentHash) {
          error(`plugins/${id}: published version ${version} has no contentHash; bump the version to republish`);
          continue;
        }
        if (prior.contentHash !== contentHash) {
          error(`plugins/${id}: version ${version} was already published with different content; bump the version`);
          continue;
        }

        entries.push({ ...prior });
        continue;
      }
    }

    const zipName = `${id}-${version}.clihub-plugin.zip`;
    const zipPath = join(distDir, zipName);
    if (!existsSync(zipPath)) {
      error(`plugins/${id}: missing dist/${zipName}; run scripts/package-plugin.ps1 ${id} first`);
      continue;
    }

    entries.push({
      id,
      name: descriptor.name,
      description: descriptor.description ?? '',
      version,
      schemaVersion: descriptor.schemaVersion ?? 1,
      minAppVersion,
      publisher: descriptor.publisher,
      homepage: descriptor.homepage,
      packageUrl: `https://github.com/trustsoft/CLIHub-plugins/releases/download/${id}-${version}/${zipName}`,
      sha256: sha256(readFileSync(zipPath)),
      releaseNotesUrl: descriptor.releaseNotesUrl ?? null,
      signature: null,
      contentHash
    });
  }
}

for (const id of existingById.keys()) {
  if (!seenIds.has(id)) {
    console.log(`removed: ${id} (release remains immutable)`);
  }
}

if (errors.length > 0) {
  for (const message of errors) {
    console.error(`ERROR: ${message}`);
  }
  process.exit(1);
}

entries.sort((left, right) => left.id.localeCompare(right.id));

if (checkOnly) {
  console.log(`Validated ${entries.length} plugin(s).`);
  process.exit(0);
}

const existingPlugins = [...(existingIndex.plugins ?? [])].sort((left, right) =>
  left.id.localeCompare(right.id)
);

if (existsSync(indexPath) && JSON.stringify(existingPlugins) === JSON.stringify(entries)) {
  console.log('No index changes.');
  process.exit(0);
}

const index = {
  schemaVersion: 1,
  lastUpdated: new Date().toISOString(),
  plugins: entries
};

writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
console.log(`Wrote index.json with ${entries.length} plugin(s).`);
