import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const ALLOWED_COMMAND_KINDS = ['launch', 'resume', 'version', 'update'];
export const MAX_DESCRIPTOR_BYTES = 64 * 1024;
export const MAX_LOGO_BYTES = 512 * 1024;
export const MAX_LOGO_DIMENSION = 512;
export const MAX_PACKAGE_BYTES = 10 * 1024 * 1024;
export const MAX_PACKAGE_ENTRIES = 100;

const SHELL_EXECUTABLES = new Set([
  'bash',
  'cmd',
  'cmd.exe',
  'node',
  'powershell',
  'powershell.exe',
  'pwsh',
  'pwsh.exe',
  'python',
  'python.exe',
  'python3',
  'py',
  'sh',
  'wsl'
]);

const SUSPICIOUS_PATTERNS = [
  ['encoded PowerShell command', /-encodedcommand/i],
  ['PowerShell command expression', /powershell(?:\.exe)?\s+-(?:c|command)\b/i],
  ['Invoke-Expression', /invoke-expression/i],
  ['iex alias', /\biex\b/i],
  ['base64 decode', /frombase64string|base64\s+(?:-d|--decode)/i],
  ['curl piped into a shell', /curl(?:\.exe)?[^\n|]*\|/i],
  ['wget piped into a shell', /wget(?:\.exe)?[^\n|]*\|/i],
  ['cmd /c with an HTTP URL', /cmd(?:\.exe)?\s+\/c[^\n]*https?:\/\//i],
  ['bash -c with curl/wget', /bash\s+-c[^\n]*(?:curl|wget)/i]
];

export function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

export function stableStringify(value) {
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

export function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }

  return 0;
}

export function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export function readReservedIds(root) {
  const path = join(root, 'reserved-ids.json');
  const data = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(data) || data.some((id) => typeof id !== 'string' || id.length === 0)) {
    throw new Error('reserved-ids.json must be a JSON array of non-empty plugin ids');
  }

  return new Set(data);
}

export function contentHashFor(descriptor, logoPath) {
  const descriptorHash = sha256(stableStringify(descriptor));
  const logoHash = existsSync(logoPath) ? sha256(readFileSync(logoPath)) : '';
  return sha256(Buffer.from(`${descriptorHash}\n${logoHash}`, 'utf8'));
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => isNonEmptyString(item));
}

export function validateDescriptor(id, descriptor, options = {}) {
  const errors = [];
  const warnings = [];
  const reservedIds = options.reservedIds ?? new Set();
  const error = (message) => errors.push(`plugins/${id}: ${message}`);
  const warning = (message) => warnings.push(`plugins/${id}: ${message}`);

  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
    error('plugin.json must be a JSON object');
    return { errors, warnings };
  }

  if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) {
    error('id must use lowercase letters, digits, dot, underscore, or hyphen');
  }
  if (descriptor.id !== id) {
    error(`plugin.json id '${descriptor.id}' must match the folder name '${id}'`);
  }
  if (reservedIds.has(id)) {
    error('id is reserved for a CLIHub built-in plugin');
  }
  if (!isNonEmptyString(descriptor.name)) {
    error('missing name');
  } else if (descriptor.name.length > 100) {
    warning('name is longer than 100 characters');
  }
  if (!isNonEmptyString(descriptor.description)) {
    error('missing description');
  } else if (descriptor.description.length > 500) {
    warning('description is longer than 500 characters');
  }
  if (!parseVersion(String(descriptor.version ?? ''))) {
    error('version is required and must be major.minor.patch');
  }
  if (!isNonEmptyString(descriptor.publisher)) {
    error('missing publisher');
  }
  if (!isHttpsUrl(descriptor.homepage)) {
    error('homepage is required and must be an HTTPS URL');
  }
  if (descriptor.releaseNotesUrl != null && !isHttpsUrl(descriptor.releaseNotesUrl)) {
    error('releaseNotesUrl must be an HTTPS URL');
  }
  if (descriptor.schemaVersion != null && descriptor.schemaVersion !== 1) {
    error(`unsupported schemaVersion ${descriptor.schemaVersion}`);
  }

  const minAppVersion = descriptor.minAppVersion ?? '0.0.0';
  if (!parseVersion(String(minAppVersion))) {
    error('minAppVersion must be major.minor.patch');
  }

  const commands = descriptor.commands;
  if (!commands || typeof commands !== 'object' || Array.isArray(commands)) {
    error('commands must be an object');
  } else {
    if (!commands.launch || !isNonEmptyString(commands.launch.executable)) {
      error('missing commands.launch.executable');
    }

    for (const key of Object.keys(commands)) {
      if (!ALLOWED_COMMAND_KINDS.includes(key)) {
        warning(`unknown command '${key}' (CLIHub ignores it)`);
      }

      const command = commands[key];
      if (!command || typeof command !== 'object' || Array.isArray(command)) {
        error(`commands.${key} must be an object`);
        continue;
      }
      if (!isNonEmptyString(command.executable)) {
        error(`commands.${key}.executable is required`);
      }
      if (command.arguments != null && typeof command.arguments !== 'string') {
        error(`commands.${key}.arguments must be a string`);
      }
      const extra = Object.keys(command).filter(
        (field) => !['name', 'executable', 'arguments'].includes(field)
      );
      if (extra.length > 0) {
        warning(`commands.${key} has unknown fields: ${extra.join(', ')}`);
      }

      const executable = String(command.executable ?? '');
      const base = executable.split(/[\\/]/).pop().toLowerCase();
      if (SHELL_EXECUTABLES.has(base)) {
        warning(`commands.${key} uses a shell/interpreter executable '${executable}'`);
      }
      if (/^[A-Za-z]:[\\/]/.test(executable) || executable.startsWith('/')) {
        warning(`commands.${key}.executable is an absolute path`);
      }
      if (executable.includes('..') || String(command.arguments ?? '').includes('..')) {
        warning(`commands.${key} contains a parent-directory reference`);
      }
    }

    const commandText = JSON.stringify(commands);
    for (const [label, pattern] of SUSPICIOUS_PATTERNS) {
      if (pattern.test(commandText)) {
        warning(`suspicious command pattern: ${label}`);
      }
    }
  }

  if (descriptor.detection != null) {
    if (typeof descriptor.detection !== 'object' || Array.isArray(descriptor.detection)) {
      error('detection must be an object');
    } else {
      if (descriptor.detection.systemPaths != null && !isStringArray(descriptor.detection.systemPaths)) {
        error('detection.systemPaths must be an array of non-empty strings');
      }
      if (descriptor.detection.projectIndicators != null) {
        if (!isStringArray(descriptor.detection.projectIndicators)) {
          error('detection.projectIndicators must be an array of non-empty strings');
        } else {
          for (const indicator of descriptor.detection.projectIndicators) {
            if (
              indicator === '..' ||
              indicator.startsWith('../') ||
              indicator.startsWith('..\\') ||
              indicator.startsWith('/') ||
              /^[A-Za-z]:[\\/]/.test(indicator)
            ) {
              error(`detection.projectIndicators '${indicator}' must be project-relative`);
            }
          }
        }
      }
    }
  }

  if (descriptor.updateCheck != null) {
    if (typeof descriptor.updateCheck !== 'object' || Array.isArray(descriptor.updateCheck)) {
      error('updateCheck must be an object');
    } else if (!['npm', 'githubReleases'].includes(descriptor.updateCheck.source)) {
      warning(`unknown updateCheck source '${descriptor.updateCheck.source}'`);
    } else if (descriptor.updateCheck.source === 'npm' && !isNonEmptyString(descriptor.updateCheck.package)) {
      error('updateCheck.package is required for npm');
    } else if (
      descriptor.updateCheck.source === 'githubReleases' &&
      !isNonEmptyString(descriptor.updateCheck.repo)
    ) {
      error('updateCheck.repo is required for githubReleases');
    }
  }

  if (
    descriptor.name === 'My Agent' ||
    descriptor.publisher === 'Your name or organization' ||
    String(descriptor.description ?? '').includes('TODO')
  ) {
    warning('placeholder metadata detected');
  }
  if (isHttpsUrl(descriptor.homepage) && new URL(descriptor.homepage).hostname === 'example.com') {
    warning('homepage still uses example.com');
  }

  return { errors, warnings };
}

export function validateLogo(logoPath) {
  const errors = [];
  const warnings = [];

  if (!existsSync(logoPath)) {
    return { errors, warnings };
  }

  const size = statSync(logoPath).size;
  if (size > MAX_LOGO_BYTES) {
    errors.push(`logo.png is ${size} bytes; the maximum is ${MAX_LOGO_BYTES}`);
  }

  const bytes = readFileSync(logoPath);
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || !signature.every((value, index) => bytes[index] === value)) {
    errors.push('logo.png is not a valid PNG file');
    return { errors, warnings };
  }

  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width === 0 || height === 0) {
    errors.push('logo.png has invalid dimensions');
  } else if (width > MAX_LOGO_DIMENSION || height > MAX_LOGO_DIMENSION) {
    warnings.push(
      `logo.png is ${width}x${height}; consider <= ${MAX_LOGO_DIMENSION}x${MAX_LOGO_DIMENSION}`
    );
  }

  return { errors, warnings };
}

export function readPackageEntries(zipPath) {
  try {
    return execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' })
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    // Fall through to tar/PowerShell.
  }

  try {
    return execFileSync('tar', ['-tf', zipPath], { encoding: 'utf8' })
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    // Fall through to PowerShell.
  }

  if (process.platform === 'win32') {
    const escaped = zipPath.replace(/'/g, "''");
    const script = `Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[System.IO.Compression.ZipFile]::OpenRead('${escaped}'); try { $z.Entries | ForEach-Object { $_.FullName } } finally { $z.Dispose() }`;
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8'
    })
      .split(/\r?\n/)
      .filter(Boolean);
  }

  throw new Error('cannot read zip entries; install unzip or run on a platform with tar/zip support');
}

export function validatePackage(zipPath, id) {
  const errors = [];
  const warnings = [];

  if (!existsSync(zipPath)) {
    errors.push(`missing package ${zipPath}; run scripts/package-plugin.ps1 ${id} first`);
    return { errors, warnings, entries: [] };
  }

  const size = statSync(zipPath).size;
  if (size > MAX_PACKAGE_BYTES) {
    errors.push(`package is ${size} bytes; the maximum is ${MAX_PACKAGE_BYTES}`);
  }

  let entries;
  try {
    entries = readPackageEntries(zipPath);
  } catch (exception) {
    errors.push(`cannot inspect package: ${exception.message}`);
    return { errors, warnings, entries: [] };
  }

  const files = entries.filter((entry) => !entry.endsWith('/') && !entry.endsWith('\\'));
  if (files.length > MAX_PACKAGE_ENTRIES) {
    errors.push(`package has ${files.length} entries; the maximum is ${MAX_PACKAGE_ENTRIES}`);
  }

  const allowed = new Set([`${id}/plugin.json`, `${id}/logo.png`]);
  const topLevel = new Set();

  for (const entry of files) {
    const normalized = entry.replace(/\\/g, '/');
    if (
      normalized.startsWith('/') ||
      normalized.includes('../') ||
      /^[A-Za-z]:\//.test(normalized)
    ) {
      errors.push(`package entry '${entry}' uses an unsafe path`);
      continue;
    }

    topLevel.add(normalized.split('/')[0]);
    if (!allowed.has(normalized)) {
      errors.push(`package entry '${entry}' is not allowed`);
    }
  }

  if (!files.some((entry) => entry.replace(/\\/g, '/') === `${id}/plugin.json`)) {
    errors.push(`package is missing ${id}/plugin.json`);
  }
  if (topLevel.size !== 1 || !topLevel.has(id)) {
    errors.push(`package must have exactly one top-level directory '${id}'`);
  }

  return { errors, warnings, entries: files };
}
