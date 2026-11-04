# Security

CLIHub plugins are **data-only descriptors**, but their commands execute real programs in the user's
terminal. A plugin package is effectively executable content.

## Maintainer review

Every pull request that adds or changes a plugin is reviewed for:

- only `plugin.json` and optional `logo.png` in the plugin folder;
- no reserved built-in ids;
- every declared command (`launch`, `resume`, `version`, `update`) is intentional and matches the
  agent CLI's documented interface;
- no encoded, obfuscated, or download-and-execute commands;
- HTTPS-only `homepage` and `releaseNotesUrl`.

## Integrity

- Packages are published as immutable GitHub Release assets.
- `index.json` records a SHA-256 hash of every package; CLIHub verifies it before installation.
- The feed index itself is served over HTTPS. Index signing is reserved for a future change
  (`signature` is always `null` today).

## Reporting

Report a malicious or broken plugin privately to the maintainers of `trustsoft/CLIHub-plugins`
rather than opening a public issue with exploit details.
