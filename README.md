# claude-multi

Use multiple Claude Code accounts on one machine. Shared settings, separate credentials.

## Install

```bash
npm install -g claude-multi
```

## Quick start

```bash
claude-multi add work       # creates account, configures shell, opens Claude to log in
claude-work                 # use your second account
```

That's it. One command does everything:
1. Creates the account directory with symlinks to `~/.claude`
2. Detects your shell and adds aliases to `~/.zshrc` / `~/.bashrc` (asks permission)
3. Opens Claude Code so you can `/login`

## How it works

All accounts share settings, plugins, skills, and history from `~/.claude` via symlinks. Only OAuth credentials are separate. Install a plugin once — every account sees it.

```
~/.claude/              ← primary account (source of truth)
~/.claude-work/         ← symlinks to ~/.claude + own credentials
~/.claude-personal/     ← symlinks to ~/.claude + own credentials
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
claude-work         # second account (auto-syncs before launch)
claude-personal     # third account
```

All arguments pass through: `claude-work -c`, `claude-work "fix the bug"`, etc.

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
