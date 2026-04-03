#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, symlinkSync, lstatSync, unlinkSync, rmSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';

const VERSION = '1.1.1';
const HOME = homedir();
const CLAUDE_HOME = join(HOME, '.claude');
const CLAUDE_JSON = join(HOME, '.claude.json');
const CREDENTIAL_FILES = new Set(['.claude.json']);
const SKIP_FILES = new Set(['.DS_Store', 'backups']);
const SYNC_KEYS = ['installMethod', 'autoUpdates', 'autoUpdatesProtectedForNative', 'lastOnboardingVersion'];
const SHELL_INIT_LINE = 'eval "$(claude-acc shell-init)"';
const CONFIG_FILE = join(HOME, '.claude-acc.json');

// ── Config ──

function loadConfig() {
  try {
    if (existsSync(CONFIG_FILE)) {
      return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch { /* skip */ }
  return { exclude: [] };
}

function saveConfig(config) {
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');
}

function getExcludeSet() {
  const config = loadConfig();
  const exclude = new Set(config.exclude || []);
  // Always exclude these regardless of config
  for (const f of SKIP_FILES) exclude.add(f);
  for (const f of CREDENTIAL_FILES) exclude.add(f);
  return exclude;
}

// ── Helpers ──

function die(msg) {
  console.error(`\x1b[31merror:\x1b[0m ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`\x1b[32m✓\x1b[0m ${msg}`);
}

function info(msg) {
  console.log(`\x1b[36mℹ\x1b[0m ${msg}`);
}

function warn(msg) {
  console.log(`\x1b[33m!\x1b[0m ${msg}`);
}

function getAccountDir(name) {
  return join(HOME, `.claude-${name}`);
}

function isSymlink(filepath) {
  try {
    return lstatSync(filepath).isSymbolicLink();
  } catch {
    return false;
  }
}

function getAccounts() {
  try {
    return readdirSync(HOME, { withFileTypes: true })
      .filter(e => e.name.startsWith('.claude-') && e.isDirectory())
      .map(e => e.name.replace('.claude-', ''))
      .filter(name => {
        const dir = getAccountDir(name);
        try {
          return readdirSync(dir).some(f => isSymlink(join(dir, f)));
        } catch {
          return false;
        }
      })
      .sort();
  } catch {
    return [];
  }
}

function createSymlinks(dir) {
  const exclude = getExcludeSet();
  const entries = readdirSync(CLAUDE_HOME, { withFileTypes: true });
  for (const entry of entries) {
    if (exclude.has(entry.name)) continue;
    const link = join(dir, entry.name);
    if (existsSync(link) || isSymlink(link)) continue;
    symlinkSync(join(CLAUDE_HOME, entry.name), link);
  }
}

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(`${question} (y/N) `, answer => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

function ensureClaude() {
  if (!existsSync(CLAUDE_HOME)) {
    die('~/.claude not found. Run claude first to set up your primary account.');
  }
}

function validateName(name) {
  if (!name) return false;
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    die('Account name must be alphanumeric (hyphens and underscores allowed).');
  }
  return true;
}

function getShellConfigPath() {
  const shell = process.env.SHELL || '';
  if (shell.includes('zsh')) return join(HOME, '.zshrc');
  if (shell.includes('bash')) {
    // macOS uses .bash_profile, Linux uses .bashrc
    const profile = join(HOME, '.bash_profile');
    if (existsSync(profile)) return profile;
    return join(HOME, '.bashrc');
  }
  return null;
}

function shellInitInstalled() {
  const configPath = getShellConfigPath();
  if (!configPath || !existsSync(configPath)) return false;
  const content = readFileSync(configPath, 'utf8');
  return content.includes('claude-acc shell-init');
}

async function ensureShellInit() {
  if (shellInitInstalled()) return;

  const configPath = getShellConfigPath();
  if (!configPath) {
    warn('Could not detect shell config file.');
    info(`Manually add this line to your shell config:\n  ${SHELL_INIT_LINE}`);
    return;
  }

  const shortPath = configPath.replace(HOME, '~');
  const confirmed = await confirm(`Add claude-acc to ${shortPath}?`);

  if (confirmed) {
    const content = existsSync(configPath) ? readFileSync(configPath, 'utf8') : '';
    const newline = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
    appendFileSync(configPath, `${newline}\n# claude-acc: auto-generated shell functions\n${SHELL_INIT_LINE}\n`);
    ok(`Added to ${shortPath}`);

    info(`Run \`source ${shortPath}\` or open a new terminal.`);
  } else {
    info(`Add manually: ${SHELL_INIT_LINE}`);
  }
}

// ── Commands ──

async function cmdAdd(name) {
  if (!validateName(name)) die('Usage: claude-acc add <account-name>');
  ensureClaude();

  const dir = getAccountDir(name);
  if (existsSync(dir)) die(`Account "${name}" already exists at ${dir}`);

  mkdirSync(dir);
  createSymlinks(dir);

  ok(`Created account "${name}"`);

  // Auto-configure shell
  await ensureShellInit();

  console.log();
  info(`After login, use: claude-${name}`);
  console.log();

  // Launch Claude for login
  const result = spawnSync('claude', ['--append-system-prompt', `The user just created a new Claude Code account named "${name}" using claude-acc. They need to authenticate. Greet them briefly and tell them to run /login to sign in with their second Claude account. Keep it to 1-2 sentences.`], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: dir },
    stdio: 'inherit',
  });

  process.exit(result.status ?? 0);
}

async function cmdRemove(name) {
  if (!validateName(name)) die('Usage: claude-acc remove <account-name>');

  const dir = getAccountDir(name);
  if (!existsSync(dir)) die(`Account "${name}" not found.`);

  // Safety: refuse to delete standalone (non-symlinked) configs
  const settingsPath = join(dir, 'settings.json');
  if (existsSync(settingsPath) && !isSymlink(settingsPath)) {
    die(`${dir} is a standalone config, not managed by claude-acc.`);
  }

  const confirmed = await confirm(`Remove account "${name}"? This deletes its credentials.`);
  if (!confirmed) {
    info('Cancelled.');
    return;
  }

  const entries = readdirSync(dir);
  for (const entry of entries) {
    const filepath = join(dir, entry);
    if (isSymlink(filepath)) {
      unlinkSync(filepath);
    } else {
      rmSync(filepath, { recursive: true, force: true });
    }
  }
  rmSync(dir, { recursive: true, force: true });

  ok(`Removed account "${name}"`);

  // Check if any accounts remain
  const remaining = getAccounts();
  if (remaining.length === 0) {
    // Remove shell-init from config if no accounts left
    const configPath = getShellConfigPath();
    if (configPath && existsSync(configPath)) {
      const content = readFileSync(configPath, 'utf8');
      if (content.includes('claude-acc shell-init')) {
        const cleaned = content
          .replace(/\n?# claude-acc: auto-generated shell functions\n.*claude-acc shell-init.*\n?/g, '\n')
          .replace(/\n{3,}/g, '\n\n');
        writeFileSync(configPath, cleaned);
        ok('Removed claude-acc from shell config (no accounts left).');
      }
    }
  }
}

function cmdList() {
  ensureClaude();

  const accounts = getAccounts();

  console.log();
  console.log(`  \x1b[32m●\x1b[0m default    ~/.claude`);

  for (const name of accounts) {
    const dir = getAccountDir(name);
    const hasLogin = existsSync(join(dir, '.claude.json'));
    const status = hasLogin ? '' : '  \x1b[33m(needs login)\x1b[0m';
    console.log(`  \x1b[36m●\x1b[0m ${name.padEnd(10)} ~/.claude-${name}${status}`);
  }

  if (accounts.length === 0) {
    console.log();
    info('No additional accounts. Run `claude-acc add <name>` to create one.');
  }
  console.log();
}

function cmdSync({ quiet = false, accountName = null } = {}) {
  const accounts = accountName ? [accountName] : getAccounts();
  if (accounts.length === 0) {
    if (!quiet) info('No accounts to sync.');
    return;
  }

  let syncedVersion = 0;
  let addedLinks = 0;
  let removedLinks = 0;

  // Sync version info
  if (existsSync(CLAUDE_JSON)) {
    try {
      const main = JSON.parse(readFileSync(CLAUDE_JSON, 'utf8'));

      for (const name of accounts) {
        const altJson = join(getAccountDir(name), '.claude.json');
        if (!existsSync(altJson)) continue;

        try {
          const alt = JSON.parse(readFileSync(altJson, 'utf8'));
          let changed = false;

          for (const key of SYNC_KEYS) {
            if (key in main && alt[key] !== main[key]) {
              alt[key] = main[key];
              changed = true;
            }
          }

          if (changed) {
            writeFileSync(altJson, JSON.stringify(alt, null, 2));
            syncedVersion++;
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  // Sync symlinks
  const exclude = getExcludeSet();
  for (const name of accounts) {
    const dir = getAccountDir(name);
    if (!existsSync(dir)) continue;

    try {
      const claudeEntries = readdirSync(CLAUDE_HOME);
      for (const entry of claudeEntries) {
        if (exclude.has(entry)) continue;
        const link = join(dir, entry);
        if (existsSync(link) || isSymlink(link)) continue;
        symlinkSync(join(CLAUDE_HOME, entry), link);
        addedLinks++;
      }
    } catch { /* skip */ }

    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const filepath = join(dir, entry);
        if (isSymlink(filepath) && !existsSync(filepath)) {
          unlinkSync(filepath);
          removedLinks++;
        }
      }
    } catch { /* skip */ }
  }

  if (!quiet) {
    const parts = [];
    if (syncedVersion > 0) parts.push(`${syncedVersion} version synced`);
    if (addedLinks > 0) parts.push(`${addedLinks} new symlink(s)`);
    if (removedLinks > 0) parts.push(`${removedLinks} broken link(s) cleaned`);

    if (parts.length > 0) {
      ok(parts.join(', '));
    } else {
      ok('Everything up to date.');
    }
  }
}

function cmdConfig(action, item) {
  const config = loadConfig();

  // No args — show current config + available items
  if (!action) {
    ensureClaude();
    const allItems = readdirSync(CLAUDE_HOME).filter(
      f => !CREDENTIAL_FILES.has(f) && !SKIP_FILES.has(f)
    ).sort();
    const excluded = new Set(config.exclude || []);

    console.log();
    console.log(`  \x1b[1mSync configuration\x1b[0m  (~/.claude-acc.json)`);
    console.log();

    for (const item of allItems) {
      if (excluded.has(item)) {
        console.log(`  \x1b[31m✗\x1b[0m ${item}  \x1b[33m(excluded)\x1b[0m`);
      } else {
        console.log(`  \x1b[32m✓\x1b[0m ${item}`);
      }
    }

    console.log();
    info('Use `claude-acc config exclude <item>` or `claude-acc config include <item>` to change.');
    console.log();
    return;
  }

  if (action === 'exclude') {
    if (!item) die('Usage: claude-acc config exclude <item>');

    // Validate item exists in ~/.claude
    if (!existsSync(join(CLAUDE_HOME, item))) {
      die(`"${item}" not found in ~/.claude`);
    }

    const excluded = config.exclude || [];
    if (excluded.includes(item)) {
      info(`"${item}" is already excluded.`);
      return;
    }

    excluded.push(item);
    config.exclude = excluded.sort();
    saveConfig(config);
    ok(`Excluded "${item}" from syncing.`);

    // Remove existing symlinks for this item in all accounts
    const accounts = getAccounts();
    for (const name of accounts) {
      const link = join(getAccountDir(name), item);
      if (isSymlink(link)) {
        unlinkSync(link);
        ok(`Removed symlink for "${item}" from ${name}`);
      }
    }
    return;
  }

  if (action === 'include') {
    if (!item) die('Usage: claude-acc config include <item>');

    const excluded = config.exclude || [];
    const idx = excluded.indexOf(item);
    if (idx === -1) {
      info(`"${item}" is already included.`);
      return;
    }

    excluded.splice(idx, 1);
    config.exclude = excluded;
    saveConfig(config);
    ok(`Included "${item}" back in syncing.`);

    // Add symlinks for this item in all accounts
    const accounts = getAccounts();
    const source = join(CLAUDE_HOME, item);
    if (existsSync(source)) {
      for (const name of accounts) {
        const link = join(getAccountDir(name), item);
        if (!existsSync(link) && !isSymlink(link)) {
          symlinkSync(source, link);
          ok(`Added symlink for "${item}" to ${name}`);
        }
      }
    }
    return;
  }

  die(`Unknown config action: ${action}. Use "exclude" or "include".`);
}

function cmdShellInit() {
  const accounts = getAccounts();

  if (accounts.length === 0) {
    console.error('# No accounts configured. Run `claude-acc add <name>` first.');
    return;
  }

  console.log('# claude-acc: shell functions with auto-sync');

  for (const name of accounts) {
    const dir = getAccountDir(name);
    console.log(`claude-${name}() { claude-acc sync -q -a ${name} 2>/dev/null; CLAUDE_CONFIG_DIR='${dir}' claude "$@"; }`);
  }
}

function cmdHelp() {
  console.log(`
\x1b[1mclaude-acc\x1b[0m v${VERSION} — Multiple Claude Code accounts, one machine

\x1b[1mUsage:\x1b[0m  claude-acc <command> [args]

\x1b[1mCommands:\x1b[0m
  add <name>                    Create account, configure shell, log in
  remove <name>                 Remove an account
  list                          Show all accounts
  sync                          Sync symlinks + version info
  config                        View what's shared across accounts
  config exclude <item>         Stop syncing an item
  config include <item>         Resume syncing an item

\x1b[1mQuick start:\x1b[0m
  claude-acc add <name>               # does everything — just log in when prompted
  claude-<name>                       # use your second account
`);
}

// ── Main ──

const [,, command, ...rawArgs] = process.argv;

function parseFlags(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--quiet' || args[i] === '-q') flags.quiet = true;
    else if ((args[i] === '--account' || args[i] === '-a') && args[i + 1]) flags.accountName = args[++i];
    else positional.push(args[i]);
  }
  return { flags, positional };
}

const { flags, positional } = parseFlags(rawArgs);

switch (command) {
  case 'add':        cmdAdd(positional[0]); break;
  case 'remove':
  case 'rm':         cmdRemove(positional[0]); break;
  case 'list':
  case 'ls':         cmdList(); break;
  case 'sync':       cmdSync({ quiet: flags.quiet, accountName: flags.accountName }); break;
  case 'config':     cmdConfig(positional[0], positional[1]); break;
  case 'shell-init': cmdShellInit(); break;
  case '--version':
  case '-v':         console.log(VERSION); break;
  case 'help':
  case '--help':
  case '-h':         cmdHelp(); break;
  default:           cmdHelp(); break;
}
