# claude-code-accounts

Managed terminal Claude Code profile configuration selection.

As of 2026-05-02, this package automatically selects isolated **terminal Claude Code** profile configuration with `CLAUDE_CONFIG_DIR`. It does **not** claim automatic Claude Desktop Chat, Claude Desktop Code, or Cowork account switching. Desktop/Cowork work remains gated behind a separate feasibility review.

## Why this exists

Claude Code supports alternate config directories with `CLAUDE_CONFIG_DIR`. This tool wraps that primitive with safer local profile management:

- managed profiles under `~/.claude-acc/`;
- private profile config directories;
- default-deny sharing instead of live symlinking everything from `~/.claude`;
- credential and transcript isolation by default;
- effective-auth auditing for environment variables, `apiKeyHelper`, and settings-defined auth risks;
- migration inspection for legacy `~/.claude-*` directories.

Use this wording carefully: the tool selects a **profile config**. It only claims an account/email identity after user attestation or a future official machine-readable identity source.

## Support Matrix

| Surface | Status |
|---|---|
| Terminal Claude Code CLI | Supported: automatic profile config selection |
| Claude Desktop Code tab | Not supported yet; feasibility required |
| Claude Desktop Chat | Manual/OS-user isolation only |
| Claude Cowork | Manual/OS-user isolation only |
| Claude web/mobile | Out of scope |

## Install

```bash
npm install -g claude-code-accounts
```

## Create Profiles

```bash
claude-acc profile create personal --email personal@example.com --preset personal-balanced
claude-acc profile create company --email work@example.com --preset work-standard
claude-acc profile create client --email client@example.com --preset client-strict
```

Compatibility alias:

```bash
claude-acc add personal --no-launch
```

Generated shell functions:

```bash
eval "$(claude-acc shell-init)"
claude-personal
claude-company
claude-client
```

The generated functions call `claude-acc run <profile>` and set `CLAUDE_CONFIG_DIR` for the selected profile.

## Login and Run

```bash
claude-acc login personal
claude-acc run personal -- --help
```

During login, run `/login` if Claude does not prompt automatically, then run `/status` and verify the visible account before account-sensitive work.

## Audits

```bash
claude-acc doctor personal
claude-acc doctor personal --effective-auth --json
claude-acc share audit personal
claude-acc migrate inspect --json
```

`doctor` reports:

- registry/profile validity;
- managed-file state;
- denied files accidentally present in a profile;
- effective-auth risks from parent environment and settings;
- managed MCP policy presence;
- Desktop attestation status when Desktop support is added later.

## Sharing Policy

New profiles do not share transcripts, history, project memory, tasks, caches, telemetry, or credentials.

Default allowlist:

- `skills/`
- `commands/`
- `output-styles/`

Default denylist includes:

- `.credentials.json`
- `.credentials.*`
- `.claude.json`
- `projects/`
- `history.jsonl`
- `sessions/`
- `tasks/`
- `todos/`
- `cache/`
- `telemetry/`
- unknown top-level entries

Apply allowed copies explicitly:

```bash
claude-acc share audit personal
claude-acc share apply personal --dry-run
claude-acc share apply personal
```

Copying is symlink-safe by default: symlinks are not followed, absolute targets and path escapes are denied, and copied files are recorded in `managed-files.json`.

## Migration

Legacy directories such as `~/.claude-alt` are not managed automatically.

```bash
claude-acc migrate inspect --json
claude-acc migrate import alt --as personal --dry-run
claude-acc migrate import alt --as personal
```

Legacy cleanup defaults to quarantine/rename, not deletion:

```bash
claude-acc migrate cleanup alt --dry-run
claude-acc migrate cleanup alt
```

Deletion requires an explicit delete command and typed confirmation.

## Security Notes

- `CLAUDE_CONFIG_DIR` selects config; it is not proof of account identity.
- `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, cloud-provider vars, `apiKeyHelper`, and `CLAUDE_CODE_OAUTH_TOKEN` can affect terminal Claude Code auth.
- `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST` is treated as a blocking host-managed-routing sentinel.
- Whole `.claude.json` files are never copied or symlinked between profiles.
- Linux/Windows `.credentials.json` is never copied or symlinked between profiles.
- Plugins, MCP servers, hooks, and settings are high risk and require review before sharing.

## Commands

```bash
claude-acc profile create <name> [--email email] [--preset preset]
claude-acc profile list [--json]
claude-acc profile show <name> [--json]
claude-acc add <name> [--email email] [--no-launch]
claude-acc login <name>
claude-acc run <name> -- [claude args...]
claude-acc doctor [name] [--json]
claude-acc share <plan|audit|apply|enable|disable> <name> [item] [--json] [--dry-run]
claude-acc migrate <inspect|import|cleanup> ...
claude-acc shell-init
```

## Requirements

- Node.js 18+
- Claude Code installed for `run`/`login`
- macOS, Linux, or Windows for terminal Claude Code profile config selection

Claude Desktop/Cowork support is not claimed by this release.
