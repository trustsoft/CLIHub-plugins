#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  MAX_DESCRIPTOR_BYTES,
  compareVersions,
  contentHashFor,
  parseVersion,
  readReservedIds,
  sha256,
  validateDescriptor
} from './lib/plugin-validation.mjs';

const root = process.cwd();
const pluginsDir = join(root, 'plugins');
const distDir = join(root, 'dist');
const indexPath = join(root, 'index.json');
const checkOnly = process.argv.includes('--check');
const errors = [];

function error(message) {
  errors.push(message);
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (exception) {
    error(`${label}: invalid JSON (${exception.message})`);
    return null;
  }
}

let reservedIds;
try {
  reservedIds = readReservedIds(root);
} catch (exception) {
  error(exception.message);
  reservedIds = new Set();
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

    const descriptorSize = statSync(descriptorPath).size;
    if (descriptorSize > MAX_DESCRIPTOR_BYTES) {
      error(
        `plugins/${id}: plugin.json is ${descriptorSize} bytes; the maximum is ${MAX_DESCRIPTOR_BYTES}`
      );
      continue;
    }

    const descriptor = readJson(descriptorPath, `plugins/${id}/plugin.json`);
    if (!descriptor) {
      continue;
    }

    const validation = validateDescriptor(id, descriptor, { reservedIds });
    for (const message of validation.errors) {
      error(message);
    }
    for (const message of validation.warnings) {
      console.warn(`WARNING: ${message}`);
    }
    if (validation.errors.length > 0) {
      continue;
    }

    const minAppVersion = descriptor.minAppVersion ?? '0.0.0';

    const prior = existingById.get(id);
    const version = String(descriptor.version ?? '');
    const currentVersion = parseVersion(version);

    const contentHash = contentHashFor(descriptor, logoPath);

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
