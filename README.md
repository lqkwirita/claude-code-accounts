# claude-code-accounts

Use multiple Claude Code accounts on one machine. Shared settings, separate credentials.

## The problem

Claude Code Pro costs $20/month and gives you generous usage limits. If you hit those limits, the only upgrade is Max at $100/month — 5× the cost for 5× the limits.

But what if you just need 2× or 3× the capacity? You can grab another Pro account for $20, but now you're stuck with:

- **Constant login/logout** — switching accounts means re-authenticating every time
- **Lost settings** — your plugins, skills, MCP servers, and preferences don't carry over
- **Separate histories** — project context and session history stay locked to each account

`claude-code-accounts` fixes all of this. Every account shares your settings, plugins, skills, and project history through symlinks. Only credentials stay separate. Switch accounts by typing `claude-alt` instead of `claude` — no login screens, no re-configuring, no friction.

**2 Pro accounts ($40/month) > 1 Max account ($100/month)** for most people who just need more capacity.

## Install

```bash
npm install -g claude-code-accounts
```

## Quick start

```bash
claude-acc add alt          # creates account, configures shell, opens Claude to log in
claude-alt                  # use your second account
```

That's it. One command does everything:
1. Creates the account directory with symlinks to `~/.claude`
2. Detects your shell and adds aliases to `~/.zshrc` / `~/.bashrc` (asks permission)
3. Opens Claude Code so you can `/login`

## How it works

All accounts share settings, plugins, skills, and history from `~/.claude` via symlinks. Only OAuth credentials are separate. Install a plugin once — every account sees it.

```
~/.claude/              ← primary account (source of truth)
~/.claude-alt/          ← symlinks to ~/.claude + own credentials
~/.claude-team/         ← symlinks to ~/.claude + own credentials
```

## Commands

| Command | Description |
|---------|-------------|
| `claude-acc add <name>` | Create account, configure shell, log in |
| `claude-acc remove <name>` | Remove an account (with confirmation) |
| `claude-acc list` | Show all accounts |
| `claude-acc sync` | Sync symlinks + version info |
| `claude-acc config` | View what's shared across accounts |
| `claude-acc config exclude <item>` | Stop syncing an item |
| `claude-acc config include <item>` | Resume syncing an item |

## Daily usage

```bash
claude              # default account
claude-alt          # second account (auto-syncs before launch)
claude-team         # third account
```

All arguments pass through: `claude-alt -c`, `claude-alt "fix the bug"`, etc.

## After updating Claude Code

Nothing to do — shell functions auto-sync before every launch. New plugins, skills, and version info are picked up automatically.

## Selective sync

By default, everything in `~/.claude` is shared. You can exclude specific items if you want accounts to have independent data for certain things.

```bash
claude-acc config                       # view what's shared and what's excluded
claude-acc config exclude projects      # stop sharing project history
claude-acc config include projects      # share it again
```

Available items you can exclude or include:

| Item | What it contains |
|------|-----------------|
| `settings.json` | Claude Code settings and preferences |
| `plugins` | Installed plugins |
| `skills` | Custom skills |
| `projects` | Project-specific context and memory |
| `plans` | Saved plans |
| `todos` | Todo lists |
| `tasks` | Background tasks |
| `sessions` | Session data |
| `history.jsonl` | Command history |
| `cache` | Cached data |
| `statsig` | Feature flags |
| `telemetry` | Usage telemetry |

Config is stored in `~/.claude-acc.json`. Excluding an item immediately removes its symlink from all accounts. Including it adds it back.

## What's shared vs separate

| Shared (default) | Always separate |
|-------------------|----------------|
| Settings, plugins, skills | OAuth credentials |
| Projects, history, plans | Keychain entries (macOS) |
| Everything in `~/.claude` | `.claude.json` per account |
| Configurable via `config` | Crash recovery backups |

## Requirements

- Node.js 18+
- Claude Code installed
- macOS or Linux

## License

MIT
