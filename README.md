# claude-code-accounts

Use multiple Claude Code accounts on one machine. Shared settings, separate credentials.

## The problem

Claude Code Pro costs $20/month and gives you generous usage limits. If you hit those limits, the only upgrade is Max at $100/month — 5× the cost for 5× the limits.

But what if you just need 2× or 3× the capacity? You can grab another Pro account for $20, but now you're stuck with:

- **Constant login/logout** — switching accounts means re-authenticating every time
- **Lost settings** — your plugins, skills, MCP servers, and preferences don't carry over
- **Separate histories** — project context and session history stay locked to each account

`claude-code-accounts` fixes all of this. Every account shares your settings, plugins, skills, and project history through symlinks. Only credentials stay separate. Switch accounts by typing `claude-<name>` instead of `claude` — no login screens, no re-configuring, no friction.

**2 Pro accounts ($40/month) > 1 Max account ($100/month)** for most people who just need more capacity.

## Install

```bash
npm install -g claude-code-accounts
```

## Quick start

```bash
claude-code-accounts add <name>     # creates account, configures shell, opens Claude to log in
claude-<name>               # use your second account
```

That's it. One command does everything:
1. Creates the account directory with symlinks to `~/.claude`
2. Detects your shell and adds aliases to `~/.zshrc` / `~/.bashrc` (asks permission)
3. Opens Claude Code so you can `/login`

## How it works

All accounts share settings, plugins, skills, and history from `~/.claude` via symlinks. Only OAuth credentials are separate. Install a plugin once — every account sees it.

```
~/.claude/              ← primary account (source of truth)
~/.claude-<name>/       ← symlinks to ~/.claude + own credentials
```

## Commands

| Command | Description |
|---------|-------------|
| `add <name>` | Create account, configure shell, log in |
| `remove <name>` | Remove an account (with confirmation) |
| `list` | Show all accounts |
| `sync` | Sync symlinks + version info |

## Daily usage

```bash
claude              # default account
claude-second       # second account (auto-syncs before launch)
claude-third        # third account
```

All arguments pass through: `claude-second -c`, `claude-second "fix the bug"`, etc.

## After updating Claude Code

Nothing to do — shell functions auto-sync before every launch. New plugins, skills, and version info are picked up automatically.

## What's shared vs separate

| Shared | Separate |
|--------|----------|
| Settings, plugins, skills | OAuth credentials |
| Projects, history, plans | Keychain entries (macOS) |
| Everything in `~/.claude` | `.claude.json` per account |

## Requirements

- Node.js 18+
- Claude Code installed
- macOS or Linux

## License

MIT
