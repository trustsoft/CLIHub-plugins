#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  MAX_DESCRIPTOR_BYTES,
  readReservedIds,
  validateDescriptor,
  validateLogo,
  validatePackage
} from './lib/plugin-validation.mjs';

const root = process.cwd();
const pluginsDir = join(root, 'plugins');
const requestedIds = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));

let errors = 0;
let warnings = 0;

function reportError(file, message) {
  errors += 1;
  console.log(`::error file=${file}::${message}`);
}

function reportWarning(file, message) {
  warnings += 1;
  console.log(`::warning file=${file}::${message}`);
}

let reservedIds;
try {
  reservedIds = readReservedIds(root);
} catch (exception) {
  reportError('reserved-ids.json', exception.message);
  process.exit(1);
}

let targetIds = requestedIds;
if (targetIds.length === 0) {
  if (!existsSync(pluginsDir)) {
    reportError('plugins', 'plugins directory is missing');
    process.exit(1);
  }

  targetIds = readdirSync(pluginsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith('.') && !name.startsWith('_'))
    .sort();
}

for (const id of targetIds) {
  const pluginDir = join(pluginsDir, id);
  const descriptorPath = join(pluginDir, 'plugin.json');
  const logoPath = join(pluginDir, 'logo.png');

  if (!existsSync(descriptorPath)) {
    reportError(`plugins/${id}/plugin.json`, 'missing plugin.json');
    continue;
  }

  const descriptorSize = statSync(descriptorPath).size;
  if (descriptorSize > MAX_DESCRIPTOR_BYTES) {
    reportError(
      `plugins/${id}/plugin.json`,
      `plugin.json is ${descriptorSize} bytes; the maximum is ${MAX_DESCRIPTOR_BYTES}`
    );
  }

  let descriptor;
  try {
    descriptor = JSON.parse(readFileSync(descriptorPath, 'utf8'));
  } catch (exception) {
    reportError(`plugins/${id}/plugin.json`, `invalid JSON: ${exception.message}`);
    continue;
  }

  const descriptorResult = validateDescriptor(id, descriptor, { reservedIds });
  descriptorResult.errors.forEach((message) =>
    reportError(`plugins/${id}/plugin.json`, message)
  );
  descriptorResult.warnings.forEach((message) =>
    reportWarning(`plugins/${id}/plugin.json`, message)
  );

  const logoResult = validateLogo(logoPath);
  logoResult.errors.forEach((message) => reportError(`plugins/${id}/logo.png`, message));
  logoResult.warnings.forEach((message) => reportWarning(`plugins/${id}/logo.png`, message));

  const version = String(descriptor.version ?? '');
  const zipPath = join(root, 'dist', `${id}-${version}.clihub-plugin.zip`);
  const packageResult = validatePackage(zipPath, id);
  packageResult.errors.forEach((message) =>
    reportError(`dist/${id}-${version}.clihub-plugin.zip`, message)
  );
  packageResult.warnings.forEach((message) =>
    reportWarning(`dist/${id}-${version}.clihub-plugin.zip`, message)
  );
}

if (errors > 0) {
  console.error(`Validation failed: ${errors} error(s), ${warnings} warning(s).`);
  process.exit(1);
}

console.log(`Validated ${targetIds.length} plugin(s); ${warnings} warning(s).`);
