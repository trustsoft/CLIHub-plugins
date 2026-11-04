# Contributing a plugin

## Descriptor contract

`plugins/<id>/plugin.json`:

- `schemaVersion` — optional; `1` is the supported maximum.
- `id` — required, must equal the folder name, lowercase letters/digits/`.`/`_`/`-`.
- `name`, `description` — required display metadata.
- `version` — required `major.minor.patch`. Bump it for every published change.
- `publisher`, `homepage` — required; `homepage` must be HTTPS.
- `minAppVersion` — optional `major.minor.patch`, default `0.0.0`. The oldest CLIHub version that can
  install the plugin.
- `releaseNotesUrl` — optional HTTPS URL.
- `commands` — at least `launch`; `resume`, `version`, and `update` are optional but recommended.
  Every declared command is shown in CLIHub's confirmation dialog before installation.
- `detection` — optional host/project markers.
- `updateCheck` — optional npm/GitHub release source, as documented in CLIHub.

`logo.png` is optional. Keep it small; only `plugin.json` and `logo.png` are allowed.

## Review rules

- No binaries, scripts, or additional files in the plugin folder.
- The descriptor must not use a CLIHub built-in id (see `reserved-ids.json`).
- Commands must launch the documented agent CLI. Do not hide payloads in `resume`, `version`, or
  `update`; reviewers inspect all declared commands.
- No shell obfuscation, encoded commands, or download-and-execute one-liners that are not part of the
  agent CLI's documented interface.
- `version` must increase; a published version is immutable.

## Local checks

```powershell
pwsh scripts/package-plugin.ps1 <id>
node scripts/build-index.mjs --check
```

The CI repeats these checks, publishes the release, and updates `index.json`.

## Pull request checklist

- [ ] `plugins/<id>/plugin.json` validates.
- [ ] `version` is bumped relative to the published index (or this is a new plugin).
- [ ] Only `plugin.json` and optional `logo.png` are present.
- [ ] `homepage` and `releaseNotesUrl` use HTTPS.
- [ ] All declared commands are intentional and reviewed.
- [ ] `node scripts/build-index.mjs --check` passes after packaging.
