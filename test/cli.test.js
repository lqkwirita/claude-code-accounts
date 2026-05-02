import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync, existsSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const cli = new URL('../bin/cli.js', import.meta.url).pathname;

function makeHome() {
  const home = mkdtempSync(join(tmpdir(), 'claude-acc-test-'));
  mkdirSync(join(home, '.claude'), { recursive: true });
  return home;
}

function run(home, args, options = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    env: {
      ...process.env,
      HOME: home,
      SHELL: '/bin/zsh',
      PATH: options.path || process.env.PATH,
      ...(options.env || {}),
    },
    cwd: options.cwd || process.cwd(),
    input: options.input || '',
    encoding: 'utf8',
  });
}

test('profile create writes registry, manifest, private config, and no legacy symlinks', () => {
  const home = makeHome();
  const result = run(home, ['profile', 'create', 'personal', '--email', 'personal@example.com', '--preset', 'personal-balanced']);
  assert.equal(result.status, 0, result.stderr);

  const registry = JSON.parse(readFileSync(join(home, '.claude-acc', 'config.json'), 'utf8'));
  const profile = JSON.parse(readFileSync(join(home, '.claude-acc', 'profiles', 'personal', 'profile.json'), 'utf8'));
  const managed = JSON.parse(readFileSync(join(home, '.claude-acc', 'profiles', 'personal', 'managed-files.json'), 'utf8'));

  assert.equal(registry.supportMatrix.cli, 'official-config-selection');
  assert.equal(profile.expectedEmail, 'personal@example.com');
  assert.ok(managed.entries.some(entry => entry.path === 'code/config/settings.json'));
  assert.equal(existsSync(join(home, '.claude-personal')), false);
  assert.equal((lstatSync(join(home, '.claude-acc', 'profiles', 'personal')).mode & 0o777), 0o700);
});

test('share audit denies credentials, history, unknown entries and allows reviewed defaults', () => {
  const home = makeHome();
  writeFileSync(join(home, '.claude', '.credentials.json'), '{}\n');
  writeFileSync(join(home, '.claude', 'history.jsonl'), 'secret\n');
  writeFileSync(join(home, '.claude', 'unknown-state'), 'x\n');
  mkdirSync(join(home, '.claude', 'skills'), { recursive: true });
  writeFileSync(join(home, '.claude', 'skills', 'SKILL.md'), '# skill\n', { mode: 0o755 });

  assert.equal(run(home, ['profile', 'create', 'personal']).status, 0);
  const audit = run(home, ['share', 'audit', 'personal', '--json']);
  assert.equal(audit.status, 0, audit.stderr);
  const plan = JSON.parse(audit.stdout);
  const byEntry = new Map(plan.actions.map(action => [action.entry, action]));

  assert.equal(byEntry.get('.credentials.json').action, 'skip');
  assert.equal(byEntry.get('history.jsonl').action, 'skip');
  assert.equal(byEntry.get('unknown-state').classification, 'unknown');
  assert.equal(byEntry.get('skills').action, 'copy');
});

test('share apply does not preserve executable bit for SKILL.md', () => {
  const home = makeHome();
  mkdirSync(join(home, '.claude', 'skills', 'demo'), { recursive: true });
  writeFileSync(join(home, '.claude', 'skills', 'demo', 'SKILL.md'), '# skill\n', { mode: 0o755 });
  mkdirSync(join(home, '.claude', 'skills', 'demo', 'scripts'), { recursive: true });
  writeFileSync(join(home, '.claude', 'skills', 'demo', 'scripts', 'run.sh'), '#!/bin/sh\n', { mode: 0o755 });

  assert.equal(run(home, ['profile', 'create', 'personal']).status, 0);
  const apply = run(home, ['share', 'apply', 'personal']);
  assert.equal(apply.status, 0, apply.stderr);

  const skillFile = join(home, '.claude-acc', 'profiles', 'personal', 'code', 'config', 'skills', 'demo', 'SKILL.md');
  const scriptFile = join(home, '.claude-acc', 'profiles', 'personal', 'code', 'config', 'skills', 'demo', 'scripts', 'run.sh');
  assert.equal((lstatSync(skillFile).mode & 0o111), 0);
  assert.notEqual((lstatSync(scriptFile).mode & 0o111), 0);
});

test('run scrubs parent auth env and sets CLAUDE_CONFIG_DIR', () => {
  const home = makeHome();
  const bin = join(home, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'claude'), [
    '#!/bin/sh',
    'printf "%s\\n" "$CLAUDE_CONFIG_DIR" > "$HOME/config-dir"',
    'if [ -n "$ANTHROPIC_API_KEY" ]; then echo bad > "$HOME/auth-env"; fi',
    'exit 0',
    '',
  ].join('\n'), { mode: 0o755 });

  assert.equal(run(home, ['profile', 'create', 'personal']).status, 0);
  const result = run(home, ['run', 'personal'], {
    path: `${bin}:${process.env.PATH}`,
    env: { ANTHROPIC_API_KEY: 'secret' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(home, 'config-dir'), 'utf8').trim(), join(home, '.claude-acc', 'profiles', 'personal', 'code', 'config'));
  assert.equal(existsSync(join(home, 'auth-env')), false);
});

test('doctor blocks settings-defined apiKeyHelper and auth env', () => {
  const home = makeHome();
  assert.equal(run(home, ['profile', 'create', 'personal']).status, 0);
  const settings = join(home, '.claude-acc', 'profiles', 'personal', 'code', 'config', 'settings.json');
  writeFileSync(settings, JSON.stringify({
    apiKeyHelper: '~/bin/key',
    env: { ANTHROPIC_API_KEY: 'secret' },
  }));

  const result = run(home, ['doctor', 'personal', '--effective-auth', '--json']);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  const risks = report.profiles[0].surfaces[0].effectiveAuth.blockingRisks;
  assert.ok(risks.some(risk => risk.key === 'apiKeyHelper'));
  assert.ok(risks.some(risk => risk.key === 'env.ANTHROPIC_API_KEY'));
});

test('migrate inspect reports legacy profile without managing it', () => {
  const home = makeHome();
  mkdirSync(join(home, '.claude-alt'));
  writeFileSync(join(home, '.claude-alt', '.credentials.json'), '{}\n');
  symlinkSync('/tmp/outside', join(home, '.claude-alt', 'outside-link'));

  const result = run(home, ['migrate', 'inspect', '--json']);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.legacy[0].legacyName, 'alt');
  assert.ok(report.legacy[0].entries.some(entry => entry.entry === '.credentials.json'));
  assert.ok(report.legacy[0].entries.some(entry => entry.classification === 'symlink-absolute-target'));
});

test('migrate import refuses traversal legacy names before planning', () => {
  const home = makeHome();
  mkdirSync(join(home, '.claude-foo'));
  mkdirSync(join(home, 'target', 'skills'), { recursive: true });
  writeFileSync(join(home, 'target', 'skills', 'SKILL.md'), '# skill\n');

  const result = run(home, ['migrate', 'import', 'foo/../target', '--as', 'personal', '--dry-run', '--json']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Legacy profile name|path escape|direct/);
});

test('migrate cleanup refuses traversal legacy names before mutation', () => {
  const home = makeHome();
  mkdirSync(join(home, '.claude-foo'));
  mkdirSync(join(home, 'target'));
  writeFileSync(join(home, 'target', 'marker.txt'), 'outside\n');

  const result = run(home, ['migrate', 'cleanup', 'foo/../target', '--yes']);
  assert.notEqual(result.status, 0);
  assert.equal(existsSync(join(home, 'target', 'marker.txt')), true);
});

test('migrate cleanup quarantine writes rollback metadata', () => {
  const home = makeHome();
  mkdirSync(join(home, '.claude-alt'));
  writeFileSync(join(home, '.claude-alt', 'settings.json'), '{}\n');

  const result = run(home, ['migrate', 'cleanup', 'alt', '--yes']);
  assert.equal(result.status, 0, result.stderr);
  const recordsDir = join(home, '.claude-acc', 'backups', 'legacy-cleanup-records');
  const records = readdirSync(recordsDir);
  assert.equal(records.length, 1);
  const record = JSON.parse(readFileSync(join(recordsDir, records[0]), 'utf8'));
  assert.equal(record.operation, 'legacy-cleanup-quarantine');
  assert.equal(record.source, join(home, '.claude-alt'));
  assert.equal(existsSync(join(home, '.claude-alt')), false);
});

test('migrate cleanup delete requires explicit delete and writes rollback metadata', () => {
  const home = makeHome();
  mkdirSync(join(home, '.claude-alt'));
  writeFileSync(join(home, '.claude-alt', 'settings.json'), '{}\n');

  const result = run(home, ['migrate', 'cleanup', 'alt', '--delete', '--typed-confirm', 'delete legacy claude profile alt']);
  assert.equal(result.status, 0, result.stderr);
  const recordsDir = join(home, '.claude-acc', 'backups', 'legacy-cleanup-records');
  const record = JSON.parse(readFileSync(join(recordsDir, readdirSync(recordsDir)[0]), 'utf8'));
  assert.equal(record.operation, 'legacy-cleanup-delete');
  assert.deepEqual(record.deletedPaths, [join(home, '.claude-alt')]);
  assert.equal(existsSync(join(home, '.claude-alt')), false);
});

test('share enable and disable mutate persisted sharing policy', () => {
  const home = makeHome();
  mkdirSync(join(home, '.claude', 'plugins'), { recursive: true });
  writeFileSync(join(home, '.claude', 'plugins', 'README.md'), 'plugin\n');
  assert.equal(run(home, ['profile', 'create', 'personal']).status, 0);

  const before = run(home, ['share', 'audit', 'personal', '--json']);
  assert.equal(JSON.parse(before.stdout).actions.find(a => a.entry === 'plugins').action, 'skip');

  const enabled = run(home, ['share', 'enable', 'personal', 'plugins', '--strategy', 'copy', '--json']);
  assert.equal(enabled.status, 0, enabled.stderr);
  const afterEnable = run(home, ['share', 'audit', 'personal', '--json']);
  assert.equal(JSON.parse(afterEnable.stdout).actions.find(a => a.entry === 'plugins').action, 'copy');

  const disabled = run(home, ['share', 'disable', 'personal', 'plugins', '--json']);
  assert.equal(disabled.status, 0, disabled.stderr);
  const afterDisable = run(home, ['share', 'audit', 'personal', '--json']);
  assert.equal(JSON.parse(afterDisable.stdout).actions.find(a => a.entry === 'plugins').action, 'skip');
  assert.equal(JSON.parse(afterDisable.stdout).actions.find(a => a.entry === 'plugins').strategy, 'disabled');
});

test('share enable refuses denied credential entries', () => {
  const home = makeHome();
  assert.equal(run(home, ['profile', 'create', 'personal']).status, 0);
  const result = run(home, ['share', 'enable', 'personal', '.credentials.json']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /denied/);
});

test('share disable persists disabled overrides for default allowlist entries', () => {
  const home = makeHome();
  for (const entry of ['skills', 'commands', 'output-styles']) {
    mkdirSync(join(home, '.claude', entry), { recursive: true });
    writeFileSync(join(home, '.claude', entry, 'item.md'), '# item\n');
  }
  assert.equal(run(home, ['profile', 'create', 'personal']).status, 0);

  for (const entry of ['skills', 'commands', 'output-styles']) {
    const disabled = run(home, ['share', 'disable', 'personal', entry, '--json']);
    assert.equal(disabled.status, 0, disabled.stderr);
    const audit = run(home, ['share', 'audit', 'personal', '--json']);
    const action = JSON.parse(audit.stdout).actions.find(action => action.entry === entry);
    assert.equal(action.action, 'skip');
    assert.equal(action.strategy, 'disabled');
  }

  const apply = run(home, ['share', 'apply', 'personal']);
  assert.equal(apply.status, 0, apply.stderr);
  assert.equal(existsSync(join(home, '.claude-acc', 'profiles', 'personal', 'code', 'config', 'skills')), false);
});

test('share enable rejects unsupported strategies', () => {
  const home = makeHome();
  mkdirSync(join(home, '.claude', 'skills'), { recursive: true });
  assert.equal(run(home, ['profile', 'create', 'personal']).status, 0);
  const result = run(home, ['share', 'enable', 'personal', 'skills', '--strategy', 'link']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unsupported share strategy/);
});

test('doctor reports opaque managed settings warning', () => {
  const home = makeHome();
  assert.equal(run(home, ['profile', 'create', 'personal']).status, 0);
  const result = run(home, ['doctor', 'personal', '--json']);
  assert.equal(result.status, 0, result.stderr);
  const warnings = result.stdout;
  assert.match(warnings, /managed-settings-present-or-unknown/);
});

test('host-managed provider sentinel blocks launch', () => {
  const home = makeHome();
  const bin = join(home, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  assert.equal(run(home, ['profile', 'create', 'personal']).status, 0);
  const result = run(home, ['run', 'personal'], {
    path: `${bin}:${process.env.PATH}`,
    env: { CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1' },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /host platform|effective-auth risks/);
});
