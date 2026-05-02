#!/usr/bin/env node

import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { homedir, platform } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';

const VERSION = '2.0.0';
const HOME = process.env.HOME || homedir();
const CLAUDE_HOME = join(HOME, '.claude');
const REGISTRY_DIR = join(HOME, '.claude-acc');
const REGISTRY_CONFIG = join(REGISTRY_DIR, 'config.json');
const PROFILES_DIR = join(REGISTRY_DIR, 'profiles');
const BACKUPS_DIR = join(REGISTRY_DIR, 'backups');
const LOCKS_DIR = join(REGISTRY_DIR, 'locks');
const SHELL_INIT_LINE = 'eval "$(claude-acc shell-init)"';
const DOCS_CHECKED_AT = '2026-05-02';

const RESERVED_NAMES = new Set([
  'acc',
  'code-accounts',
  'help',
  'profile',
  'run',
  'login',
  'logout',
  'doctor',
  'migrate',
  'share',
  'credentials',
  'desktop',
  'desktop-code',
  'cowork',
  'use',
  'config',
  'sync',
  'remove',
  'rm',
  'list',
  'ls',
]);

const DEFAULT_DENY = new Set([
  '.credentials.json',
  '.claude.json',
  'projects',
  'history.jsonl',
  'file-history',
  'sessions',
  'session-env',
  'plans',
  'tasks',
  'todos',
  'cache',
  'debug',
  'paste-cache',
  'image-cache',
  'shell-snapshots',
  'stats-cache.json',
  'statsig',
  'telemetry',
  'agent-memory',
  'backups',
]);

const DEFAULT_ALLOW = new Set(['skills', 'commands', 'output-styles']);

const HIGH_RISK_ENTRIES = new Set([
  'plugins',
  'hooks',
  'agents',
  'mcp',
  '.mcp.json',
  'CLAUDE.md',
  'settings.json',
]);

const PARENT_AUTH_ENV = [
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_BEDROCK_BASE_URL',
  'ANTHROPIC_BEDROCK_MANTLE_BASE_URL',
  'ANTHROPIC_FOUNDRY_API_KEY',
  'ANTHROPIC_FOUNDRY_BASE_URL',
  'ANTHROPIC_FOUNDRY_RESOURCE',
  'ANTHROPIC_VERTEX_BASE_URL',
  'ANTHROPIC_VERTEX_PROJECT_ID',
  'AWS_BEARER_TOKEN_BEDROCK',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_REFRESH_TOKEN',
  'CLAUDE_CODE_OAUTH_SCOPES',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_MANTLE',
  'CLAUDE_CODE_SKIP_BEDROCK_AUTH',
  'CLAUDE_CODE_SKIP_VERTEX_AUTH',
  'CLAUDE_CODE_SKIP_FOUNDRY_AUTH',
  'CLAUDE_CODE_SKIP_MANTLE_AUTH',
  'DISABLE_LOGIN_COMMAND',
  'DISABLE_LOGOUT_COMMAND',
];

const HOST_MANAGED_SENTINEL = 'CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST';
const AUTH_ENV_SET = new Set([...PARENT_AUTH_ENV, HOST_MANAGED_SENTINEL]);
const CHILD_ENV_DEFAULTS = {
  CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1',
  CLAUDE_CODE_MCP_ALLOWLIST_ENV: '1',
};

const HIGH_RISK_SETTINGS_KEYS = new Set([
  'apiKeyHelper',
  'env',
  'hooks',
  'enabledPlugins',
  'extraKnownMarketplaces',
  'strictKnownMarketplaces',
  'enableAllProjectMcpServers',
  'enabledMcpjsonServers',
  'disabledMcpjsonServers',
  'allowedMcpServers',
  'deniedMcpServers',
  'allowManagedMcpServersOnly',
  'awsAuthRefresh',
  'awsCredentialExport',
  'forceLoginMethod',
  'forceLoginOrgUUID',
  'modelOverrides',
  'otelHeadersHelper',
  'httpHookAllowedEnvVars',
  'allowedHttpHookUrls',
  'disableBypassPermissionsMode',
  'skipDangerousModePermissionPrompt',
]);

function die(message, code = 1) {
  console.error(`error: ${message}`);
  process.exit(code);
}

function ok(message) {
  console.log(`[ok] ${message}`);
}

function info(message) {
  console.log(`[info] ${message}`);
}

function warn(message) {
  console.log(`[warn] ${message}`);
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function displayPath(value) {
  const resolved = resolve(value);
  return resolved === HOME || resolved.startsWith(`${HOME}${sep}`)
    ? `~${resolved.slice(HOME.length)}`
    : resolved;
}

function pathInside(parent, candidate) {
  const rel = relative(resolve(parent), resolve(candidate));
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel));
}

function safeLstat(path) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

function readJsonStrict(path, { required = true } = {}) {
  if (!existsSync(path)) {
    if (required) throw new Error(`${displayPath(path)} not found`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Could not parse ${displayPath(path)}: ${error.message}`);
  }
}

function writeJsonAtomic(path, value, mode = 0o600) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = join(dirname(path), `.${Date.now()}.${process.pid}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode });
  renameSync(tmp, path);
  chmodSync(path, mode);
}

function mkdirPrivate(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  try {
    chmodSync(path, 0o700);
  } catch {
    // Best effort on platforms that do not support POSIX modes.
  }
}

function hashFile(path) {
  const hash = createHash('sha256');
  hash.update(readFileSync(path));
  return hash.digest('hex');
}

function nowIso() {
  return new Date().toISOString();
}

function validateName(name) {
  if (!name) return false;
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    die('Profile name must be alphanumeric; hyphens and underscores are allowed.');
  }
  if (RESERVED_NAMES.has(name)) {
    die(`"${name}" is reserved and cannot be used as a profile name.`);
  }
  return true;
}

function validateLegacyName(name) {
  if (!name) die('Legacy profile name is required.');
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    die('Legacy profile name must be a direct .claude-<name> child using only letters, numbers, hyphens, or underscores.');
  }
  if (name.includes('.') || name.includes('/') || name.includes('\\') || name.includes('\0')) {
    die('Legacy profile name contains a path escape and was refused.');
  }
  return true;
}

function resolveLegacySource(legacyName) {
  validateLegacyName(legacyName);
  const source = resolve(HOME, `.claude-${legacyName}`);
  const expectedBase = `.claude-${legacyName}`;
  if (dirname(source) !== resolve(HOME) || basename(source) !== expectedBase) {
    die(`Legacy path escape denied for "${legacyName}".`);
  }
  return source;
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

async function typedConfirm(question, expected) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(`${question}\nType "${expected}" to continue: `, answer => {
      rl.close();
      resolve(answer === expected);
    });
  });
}

function defaultRegistryConfig() {
  return {
    schemaVersion: 1,
    createdBy: 'claude-code-accounts',
    createdByVersion: VERSION,
    profilesRoot: PROFILES_DIR,
    activeProfile: null,
    supportMatrix: {
      cli: 'official-config-selection',
      desktopCode: 'feasibility-required',
      desktopChat: 'manual-or-os-user',
      cowork: 'manual-or-os-user',
    },
    lastDocsCheckedAt: DOCS_CHECKED_AT,
  };
}

function ensureRegistry() {
  mkdirPrivate(REGISTRY_DIR);
  mkdirPrivate(PROFILES_DIR);
  mkdirPrivate(BACKUPS_DIR);
  mkdirPrivate(LOCKS_DIR);
  if (!existsSync(REGISTRY_CONFIG)) {
    writeJsonAtomic(REGISTRY_CONFIG, defaultRegistryConfig());
  } else {
    readJsonStrict(REGISTRY_CONFIG);
  }
}

function loadRegistry({ ensure = false } = {}) {
  if (ensure) ensureRegistry();
  return readJsonStrict(REGISTRY_CONFIG, { required: ensure });
}

function profileDir(name) {
  return join(PROFILES_DIR, name);
}

function profileJsonPath(name) {
  return join(profileDir(name), 'profile.json');
}

function managedFilesPath(name) {
  return join(profileDir(name), 'managed-files.json');
}

function codeConfigDir(name) {
  return join(profileDir(name), 'code', 'config');
}

function profileExists(name) {
  return existsSync(profileJsonPath(name)) && existsSync(managedFilesPath(name));
}

function loadProfile(name) {
  validateName(name);
  const profile = readJsonStrict(profileJsonPath(name));
  readJsonStrict(managedFilesPath(name));
  return profile;
}

function loadManaged(name) {
  return readJsonStrict(managedFilesPath(name));
}

function saveManaged(name, managed) {
  writeJsonAtomic(managedFilesPath(name), managed);
}

function upsertManagedEntries(name, entries) {
  const managed = loadManaged(name);
  const byPath = new Map((managed.entries || []).map(entry => [entry.path, entry]));
  for (const entry of entries) {
    byPath.set(entry.path, entry);
  }
  managed.entries = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  saveManaged(name, managed);
}

function managedEntry(profileRoot, relPath, reason) {
  const abs = join(profileRoot, relPath);
  const stat = safeLstat(abs);
  if (!stat) return null;
  const entry = {
    path: relPath,
    type: stat.isDirectory() ? 'directory' : stat.isSymbolicLink() ? 'symlink' : 'file',
    owner: 'claude-code-accounts',
    createdByAction: reason,
    mode: stat.mode & 0o777,
  };
  if (stat.isFile()) entry.sha256 = hashFile(abs);
  return entry;
}

function defaultSettingsForPreset(preset) {
  const deny = [
    'Read(./.env)',
    'Read(./.env.*)',
    'Read(./secrets/**)',
    'Read(./config/credentials.json)',
  ];
  const base = {
    cleanupPeriodDays: preset === 'client-strict' ? 7 : preset === 'work-standard' ? 14 : 30,
    permissions: { deny },
    env: { ...CHILD_ENV_DEFAULTS },
  };
  if (preset === 'ephemeral') {
    base.cleanupPeriodDays = 1;
    base.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY = '1';
  }
  return base;
}

function defaultSharingPolicy() {
  return {
    mode: 'allowlist',
    unknownTopLevel: 'deny',
    credentials: 'deny',
    entries: {
      skills: { strategy: 'copy', reviewedAt: null, source: join(CLAUDE_HOME, 'skills') },
      commands: { strategy: 'copy', reviewedAt: null, source: join(CLAUDE_HOME, 'commands') },
      'output-styles': { strategy: 'copy', reviewedAt: null, source: join(CLAUDE_HOME, 'output-styles') },
    },
  };
}

function normalizeSharingPolicy(profile) {
  return {
    ...defaultSharingPolicy(),
    ...(profile.sharingPolicy || {}),
    entries: {
      ...defaultSharingPolicy().entries,
      ...((profile.sharingPolicy && profile.sharingPolicy.entries) || {}),
    },
  };
}

function saveProfile(profile) {
  profile.updatedAt = nowIso();
  writeJsonAtomic(profileJsonPath(profile.name), profile);
}

function createProfile(name, { email = null, preset = 'personal-balanced' } = {}) {
  validateName(name);
  ensureRegistry();
  if (existsSync(profileDir(name))) die(`Profile "${name}" already exists at ${displayPath(profileDir(name))}`);

  const root = profileDir(name);
  const configDir = codeConfigDir(name);
  mkdirPrivate(root);
  mkdirPrivate(join(root, 'code'));
  mkdirPrivate(configDir);
  mkdirPrivate(join(root, 'env'));
  mkdirPrivate(join(root, 'attestations'));
  mkdirPrivate(join(root, 'migration'));

  const profile = {
    schemaVersion: 1,
    name,
    expectedEmail: email,
    generatedCommand: `claude-${name}`,
    policyPreset: preset,
    paths: { codeConfigDir: configDir },
    surfaces: {
      cli: { supportLevel: 'official-config-selection', enabled: true, mode: 'claude_config_dir' },
      desktopCode: { supportLevel: 'feasibility-required', enabled: false, mode: null },
      desktopChat: { supportLevel: 'manual-or-os-user', enabled: false, mode: 'user_attested_or_os_user' },
      cowork: { supportLevel: 'manual-or-os-user', enabled: false, mode: 'inherits_desktop_chat' },
    },
    sharingPolicy: defaultSharingPolicy(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  const settingsPath = join(configDir, 'settings.json');
  writeJsonAtomic(settingsPath, defaultSettingsForPreset(preset));
  writeJsonAtomic(profileJsonPath(name), profile);
  writeJsonAtomic(managedFilesPath(name), { schemaVersion: 1, profile: name, entries: [] });

  const managed = [
    'code',
    'code/config',
    'code/config/settings.json',
    'env',
    'attestations',
    'migration',
    'profile.json',
    'managed-files.json',
  ].map(rel => managedEntry(root, rel, 'profile-create')).filter(Boolean);
  upsertManagedEntries(name, managed);
  return profile;
}

function getProfiles() {
  loadRegistry({ ensure: true });
  if (!existsSync(PROFILES_DIR)) return [];
  return readdirSync(PROFILES_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .filter(name => profileExists(name))
    .sort();
}

function classifyTopLevelEntry(name, policy = defaultSharingPolicy()) {
  if (policy.entries && policy.entries[name]?.strategy === 'disabled') {
    return { classification: 'disabled-by-policy', action: 'skip', strategy: 'disabled', reason: `profile sharing policy disables ${name}` };
  }
  if (name === '.credentials.json' || name.startsWith('.credentials.')) {
    return { classification: 'credential', action: 'skip', strategy: 'deny', reason: 'credential files are never shared' };
  }
  if (name === '.claude.json') {
    return { classification: 'mixed-global-state', action: 'skip', strategy: 'deny', reason: '.claude.json is never copied or symlinked whole' };
  }
  if (DEFAULT_DENY.has(name)) {
    return { classification: 'private-application-data', action: 'skip', strategy: 'deny', reason: 'profile-private Claude Code application data' };
  }
  if (policy.entries && policy.entries[name]) {
    const strategy = policy.entries[name].strategy || 'copy';
    return { classification: 'allowlisted', action: strategy === 'disabled' ? 'skip' : 'copy', strategy, reason: `profile sharing policy allows ${name}` };
  }
  if (HIGH_RISK_ENTRIES.has(name)) {
    return { classification: 'high-risk-config', action: 'skip', strategy: 'review-required', reason: 'plugins, MCP, hooks, and settings require review before sharing' };
  }
  return { classification: 'unknown', action: 'skip', strategy: 'deny', reason: 'unknown top-level entries are denied by default' };
}

function buildSharePlan(name, { sourceRoot = CLAUDE_HOME } = {}) {
  const profile = loadProfile(name);
  const policy = normalizeSharingPolicy(profile);
  const destRoot = codeConfigDir(name);
  const actions = [];

  if (!existsSync(sourceRoot)) {
    return { profile: name, sourceRoot, destRoot, actions, warnings: [`${displayPath(sourceRoot)} does not exist`] };
  }

  for (const entry of readdirSync(sourceRoot)) {
    const source = join(sourceRoot, entry);
    const stat = safeLstat(source);
    const base = classifyTopLevelEntry(entry, policy);
    actions.push({
      entry,
      source,
      destination: join(destRoot, entry),
      type: stat ? stat.isDirectory() ? 'directory' : stat.isSymbolicLink() ? 'symlink' : 'file' : 'missing',
      ...base,
    });
  }

  return { profile: profile.name, sourceRoot, destRoot, actions: actions.sort((a, b) => a.entry.localeCompare(b.entry)), warnings: [] };
}

function slashPath(path) {
  return path.split(sep).join('/');
}

function executableAllowed(relDest, sourceMode) {
  const rel = slashPath(relDest);
  const sourceExecutable = (sourceMode & 0o111) !== 0;
  if (!sourceExecutable) return { allowed: false, mode: 0o644, reason: 'source is not executable' };
  if (/^code\/config\/commands\/[^/]+\.md$/.test(rel)) return { allowed: false, mode: 0o644, reason: 'commands/*.md is never executable' };
  if (/^code\/config\/output-styles\/[^/]+\.md$/.test(rel)) return { allowed: false, mode: 0o644, reason: 'output-styles/*.md is never executable' };
  if (rel.endsWith('/SKILL.md')) return { allowed: false, mode: 0o644, reason: 'SKILL.md is never executable' };
  if (/^code\/config\/skills\/.+\/scripts\/[^/]+$/.test(rel)) {
    return { allowed: true, mode: sourceMode & 0o755, reason: 'allowed skill script preserved executable bit' };
  }
  return { allowed: false, mode: 0o644, reason: 'entry type does not allow executable bit' };
}

function classifySymlink(sourceRoot, linkPath) {
  let target;
  try {
    target = readlinkSync(linkPath);
  } catch {
    return { classification: 'unknown', target: null };
  }
  if (isAbsolute(target)) return { classification: 'absolute-target', target };
  const resolved = resolve(dirname(linkPath), target);
  if (!pathInside(sourceRoot, resolved)) return { classification: 'relative-escape', target };
  if (!existsSync(resolved)) return { classification: 'broken', target };
  return { classification: 'relative-inside-source', target };
}

function copyAllowedPath({ profileName, sourceRoot, source, dest, relDest, reason, managedEntries, results }) {
  const stat = safeLstat(source);
  if (!stat) {
    results.push({ source, action: 'skip', reason: 'source disappeared' });
    return;
  }

  if (stat.isSymbolicLink()) {
    const link = classifySymlink(sourceRoot, source);
    results.push({ source, action: 'skip', reason: `symlink denied: ${link.classification}`, target: link.target });
    return;
  }

  if (!pathInside(profileDir(profileName), dest)) {
    results.push({ source, action: 'skip', reason: 'destination path escape denied' });
    return;
  }

  if (stat.isDirectory()) {
    mkdirSync(dest, { recursive: true, mode: Math.min(stat.mode & 0o777, 0o755) });
    const rel = relative(profileDir(profileName), dest);
    const entry = managedEntry(profileDir(profileName), rel, reason);
    if (entry) managedEntries.push(entry);
    for (const child of readdirSync(source)) {
      copyAllowedPath({
        profileName,
        sourceRoot,
        source: join(source, child),
        dest: join(dest, child),
        relDest: join(relDest, child),
        reason,
        managedEntries,
        results,
      });
    }
    return;
  }

  if (stat.isFile()) {
    mkdirSync(dirname(dest), { recursive: true, mode: 0o700 });
    const temp = join(dirname(dest), `.${Date.now()}.${process.pid}.copy`);
    copyFileSync(source, temp);
    const policy = executableAllowed(relative(profileDir(profileName), dest), stat.mode);
    chmodSync(temp, policy.mode);
    renameSync(temp, dest);
    const rel = relative(profileDir(profileName), dest);
    const entry = managedEntry(profileDir(profileName), rel, reason);
    if (entry) {
      if (policy.allowed) entry.executablePreserved = true;
      entry.executableReason = policy.reason;
      managedEntries.push(entry);
    }
    results.push({ source, destination: dest, action: 'copy', executablePreserved: policy.allowed });
    return;
  }

  results.push({ source, action: 'skip', reason: 'unsupported file type' });
}

function applySharePlan(name, plan) {
  const managedEntries = [];
  const results = [];
  for (const action of plan.actions) {
    if (action.action !== 'copy') {
      results.push({ entry: action.entry, action: 'skip', reason: action.reason });
      continue;
    }
    copyAllowedPath({
      profileName: name,
      sourceRoot: plan.sourceRoot,
      source: action.source,
      dest: action.destination,
      relDest: join('code', 'config', action.entry),
      reason: 'share-apply',
      managedEntries,
      results,
    });
  }
  if (managedEntries.length > 0) upsertManagedEntries(name, managedEntries);
  return results;
}

function settingsSources(profileName, cwd = process.cwd()) {
  const sources = [
    { scope: 'profile-user', path: join(codeConfigDir(profileName), 'settings.json') },
    { scope: 'project-shared', path: join(cwd, '.claude', 'settings.json') },
    { scope: 'project-local', path: join(cwd, '.claude', 'settings.local.json') },
  ];

  if (platform() === 'darwin') {
    sources.push({ scope: 'managed', path: '/Library/Application Support/ClaudeCode/managed-settings.json' });
    sources.push({ scope: 'managed-mcp', path: '/Library/Application Support/ClaudeCode/managed-mcp.json' });
    const dir = '/Library/Application Support/ClaudeCode/managed-settings.d';
    if (existsSync(dir)) {
      for (const file of readdirSync(dir).filter(file => file.endsWith('.json')).sort()) {
        sources.push({ scope: 'managed', path: join(dir, file) });
      }
    }
  } else if (platform() === 'win32') {
    sources.push({ scope: 'managed', path: 'C:\\Program Files\\ClaudeCode\\managed-settings.json' });
    sources.push({ scope: 'managed-mcp', path: 'C:\\Program Files\\ClaudeCode\\managed-mcp.json' });
  } else {
    sources.push({ scope: 'managed', path: '/etc/claude-code/managed-settings.json' });
    sources.push({ scope: 'managed-mcp', path: '/etc/claude-code/managed-mcp.json' });
    const dir = '/etc/claude-code/managed-settings.d';
    if (existsSync(dir)) {
      for (const file of readdirSync(dir).filter(file => file.endsWith('.json')).sort()) {
        sources.push({ scope: 'managed', path: join(dir, file) });
      }
    }
  }

  return sources;
}

function scanSettingsSource(source) {
  if (!existsSync(source.path)) return null;
  if (source.scope === 'managed-mcp') {
    return {
      ...source,
      findings: [{ severity: 'warning', key: 'managed-mcp.json', reason: 'managed MCP policy is present; treat MCP/plugin behavior as high priority and possibly opaque' }],
    };
  }
  let data;
  try {
    data = readJsonStrict(source.path);
  } catch (error) {
    return { ...source, findings: [{ severity: 'blocking', key: 'parse-error', reason: error.message }] };
  }

  const findings = [];
  if (data && typeof data === 'object') {
    if (data.apiKeyHelper) {
      findings.push({ severity: 'blocking', key: 'apiKeyHelper', reason: 'apiKeyHelper has auth precedence over /login OAuth' });
    }
    if (data.env && typeof data.env === 'object') {
      for (const key of Object.keys(data.env)) {
        if (AUTH_ENV_SET.has(key)) {
          findings.push({ severity: 'blocking', key: `env.${key}`, reason: 'settings env can affect provider/account selection after parent env cleanup' });
        }
      }
    }
    for (const key of Object.keys(data)) {
      if (HIGH_RISK_SETTINGS_KEYS.has(key) && key !== 'apiKeyHelper' && key !== 'env') {
        findings.push({ severity: 'warning', key, reason: 'high-risk settings key should be reviewed for profile boundaries' });
      }
    }
  }
  return { ...source, findings };
}

function opaqueManagedSettingsFinding() {
  return {
    scope: 'managed-opaque',
    path: null,
    findings: [{
      severity: 'warning',
      key: 'managed-settings-present-or-unknown',
      reason: 'managed settings may also be delivered by server, MDM, plist, registry, or host policy; run /status in Claude Code to verify active settings sources',
    }],
  };
}

function effectiveAuthReport(profileName, { env = process.env, cwd = process.cwd(), allowEnv = [] } = {}) {
  const allowed = new Set(allowEnv);
  const scrubbed = [];
  const allowedPresent = [];
  const blockingRisks = [];
  const warnings = [];

  if (env[HOST_MANAGED_SENTINEL]) {
    blockingRisks.push({
      source: 'parent-env',
      key: HOST_MANAGED_SENTINEL,
      classification: 'host-managed-routing',
      reason: 'host-managed provider routing is present; claude-acc cannot safely select a subscription profile in this mode',
    });
  }

  for (const key of PARENT_AUTH_ENV) {
    if (env[key]) {
      if (allowed.has(key)) allowedPresent.push(key);
      else scrubbed.push(key);
    }
  }

  const settings = settingsSources(profileName, cwd)
    .map(scanSettingsSource)
    .filter(Boolean);
  settings.push(opaqueManagedSettingsFinding());

  for (const source of settings) {
    for (const finding of source.findings) {
      const enriched = { source: source.scope, path: source.path, ...finding };
      if (finding.severity === 'blocking') blockingRisks.push(enriched);
      else warnings.push(enriched);
    }
  }

  return {
    parentEnv: { scrubbed, allowed: allowedPresent },
    settings,
    blockingRisks,
    warnings,
    identityClaimAllowed: false,
  };
}

function cleanLaunchEnv({ allowEnv = [] } = {}) {
  if (process.env[HOST_MANAGED_SENTINEL]) {
    throw new Error('This environment appears to be managed by a host platform. claude-acc cannot safely select a subscription profile in this mode yet.');
  }
  const allowed = new Set(allowEnv);
  const env = { ...process.env };
  for (const key of PARENT_AUTH_ENV) {
    if (!allowed.has(key)) delete env[key];
  }
  return { ...env, ...CHILD_ENV_DEFAULTS };
}

function parseFlags(args) {
  const flags = {};
  const positional = [];
  const passthrough = [];
  let afterDashDash = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (afterDashDash) {
      passthrough.push(arg);
      continue;
    }
    if (arg === '--') {
      afterDashDash = true;
    } else if (arg === '--json') flags.json = true;
    else if (arg === '--dry-run') flags.dryRun = true;
    else if (arg === '--yes' || arg === '-y') flags.yes = true;
    else if (arg === '--no-launch') flags.noLaunch = true;
    else if (arg === '--delete') flags.delete = true;
    else if (arg === '--effective-auth') flags.effectiveAuth = true;
    else if (arg === '--clean-env') flags.cleanEnv = true;
    else if (arg === '--surface' && args[i + 1]) flags.surface = args[++i];
    else if (arg === '--email' && args[i + 1]) flags.email = args[++i];
    else if (arg === '--preset' && args[i + 1]) flags.preset = args[++i];
    else if (arg === '--as' && args[i + 1]) flags.as = args[++i];
    else if (arg === '--strategy' && args[i + 1]) flags.strategy = args[++i];
    else if (arg === '--typed-confirm' && args[i + 1]) flags.typedConfirm = args[++i];
    else if (arg === '--allow-env' && args[i + 1]) {
      flags.allowEnv = [...(flags.allowEnv || []), ...args[++i].split(',').map(s => s.trim()).filter(Boolean)];
    } else if (arg === '--env-file' && args[i + 1]) flags.envFile = args[++i];
    else if (arg === '--quiet' || arg === '-q') flags.quiet = true;
    else if ((arg === '--account' || arg === '-a') && args[i + 1]) flags.accountName = args[++i];
    else positional.push(arg);
  }
  return { flags, positional, passthrough };
}

function getShellConfigPath() {
  const shell = process.env.SHELL || '';
  if (shell.includes('zsh')) return join(HOME, '.zshrc');
  if (shell.includes('bash')) {
    const profile = join(HOME, '.bash_profile');
    if (existsSync(profile)) return profile;
    return join(HOME, '.bashrc');
  }
  return null;
}

function shellInitInstalled() {
  const configPath = getShellConfigPath();
  if (!configPath || !existsSync(configPath)) return false;
  return readFileSync(configPath, 'utf8').includes('claude-acc shell-init');
}

async function ensureShellInit() {
  if (shellInitInstalled()) return;
  const configPath = getShellConfigPath();
  if (!configPath) {
    warn('Could not detect shell config file.');
    info(`Manually add this line to your shell config:\n  ${SHELL_INIT_LINE}`);
    return;
  }
  const shortPath = displayPath(configPath);
  if (await confirm(`Add claude-acc to ${shortPath}?`)) {
    const content = existsSync(configPath) ? readFileSync(configPath, 'utf8') : '';
    const newline = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
    appendFileSync(configPath, `${newline}\n# claude-acc: auto-generated shell functions\n${SHELL_INIT_LINE}\n`);
    ok(`Added to ${shortPath}`);
    info(`Run \`source ${shortPath}\` or open a new terminal.`);
  } else {
    info(`Add manually: ${SHELL_INIT_LINE}`);
  }
}

async function cmdProfile(action, args, flags) {
  if (action === 'create') {
    const name = args[0];
    if (!validateName(name)) die('Usage: claude-acc profile create <name> [--email email] [--preset preset]');
    const profile = createProfile(name, { email: flags.email || null, preset: flags.preset || 'personal-balanced' });
    if (flags.json) printJson(profile);
    else ok(`Created profile "${name}" at ${displayPath(profileDir(name))}`);
    return;
  }

  if (action === 'list' || !action) {
    const profiles = getProfiles().map(name => loadProfile(name));
    if (flags.json) printJson({ profiles });
    else {
      for (const profile of profiles) {
        console.log(`${profile.name.padEnd(12)} ${profile.expectedEmail || '(email not set)'} ${displayPath(codeConfigDir(profile.name))}`);
      }
      if (profiles.length === 0) info('No managed profiles. Run `claude-acc profile create personal`.');
    }
    return;
  }

  if (action === 'show') {
    const name = args[0];
    const profile = loadProfile(name);
    if (flags.json) printJson(profile);
    else console.log(readFileSync(profileJsonPath(name), 'utf8'));
    return;
  }

  die(`Unknown profile action: ${action}`);
}

async function cmdAdd(name, flags) {
  if (!validateName(name)) die('Usage: claude-acc add <account-name> [--email email] [--no-launch]');
  const profile = createProfile(name, { email: flags.email || null, preset: flags.preset || 'personal-balanced' });
  ok(`Created managed profile "${name}"`);
  await ensureShellInit();
  if (flags.noLaunch) {
    info(`Launch with: claude-${name}`);
    return;
  }
  info('Opening Claude Code with this profile configuration.');
  info('Run /login if Claude does not prompt automatically, then run /status to verify the visible account.');
  await cmdRun(name, flags, []);
  return profile;
}

async function cmdLogin(name, flags) {
  loadProfile(name);
  info('Opening Claude Code with this profile configuration.');
  info('Run /login if Claude does not prompt automatically.');
  info('Run /status and verify the visible account before account-sensitive work.');
  await cmdRun(name, flags, []);
}

async function cmdRun(name, flags, passthrough) {
  const profile = loadProfile(name);
  const report = effectiveAuthReport(name, { allowEnv: flags.allowEnv || [] });
  if (report.blockingRisks.length > 0) {
    if (flags.json) printJson({ profile: name, status: 'blocked', effectiveAuth: report });
    die(`Refusing to launch "${name}" because effective-auth risks were found. Run \`claude-acc doctor ${name} --effective-auth --json\` for details.`);
  }
  const env = cleanLaunchEnv({ allowEnv: flags.allowEnv || [] });
  env.CLAUDE_CONFIG_DIR = profile.paths.codeConfigDir;
  const result = spawnSync('claude', passthrough, { env, stdio: 'inherit' });
  process.exit(result.status ?? 0);
}

function cmdShellInit() {
  const profiles = getProfiles();
  if (profiles.length === 0) {
    console.error('# No managed profiles. Run `claude-acc profile create <name>` first.');
    return;
  }
  console.log('# claude-acc: shell functions with clean profile launches');
  for (const name of profiles) {
    console.log(`claude-${name}() { claude-acc run ${name} --surface cli -- "$@"; }`);
  }
}

function surfaceStatus(profileName, flags) {
  const profile = loadProfile(profileName);
  const effectiveAuth = effectiveAuthReport(profileName);
  return {
    surface: flags.surface || 'cli',
    profile: profileName,
    config: { state: 'selected', path: profile.paths.codeConfigDir },
    auth: {
      level: 'env-selected',
      identity: null,
      identityClaimAllowed: false,
    },
    effectiveAuth,
    exitReadiness: effectiveAuth.blockingRisks.length ? 'blocked' : 'ok',
  };
}

function doctorForProfile(profileName, flags) {
  const profile = loadProfile(profileName);
  const managed = loadManaged(profileName);
  const findings = [];
  const root = profileDir(profileName);
  for (const entry of managed.entries || []) {
    const abs = join(root, entry.path);
    if (!existsSync(abs)) findings.push({ severity: 'warning', path: entry.path, reason: 'managed entry missing' });
  }
  const deniedPresent = ['.credentials.json', '.claude.json', 'projects', 'history.jsonl'].filter(entry => existsSync(join(codeConfigDir(profileName), entry)));
  for (const entry of deniedPresent) {
    findings.push({ severity: 'blocking', path: join('code/config', entry), reason: 'denied entry exists in profile config dir' });
  }
  return {
    profile,
    managedFiles: { count: (managed.entries || []).length },
    findings,
    surfaces: [surfaceStatus(profileName, flags)],
  };
}

function cmdDoctor(name, flags) {
  loadRegistry({ ensure: true });
  const profiles = name ? [name] : getProfiles();
  const registry = readJsonStrict(REGISTRY_CONFIG);
  const report = {
    registry: { path: REGISTRY_CONFIG, ok: true, supportMatrix: registry.supportMatrix },
    profiles: profiles.map(profile => doctorForProfile(profile, flags)),
  };
  if (flags.json) printJson(report);
  else {
    ok(`Registry: ${displayPath(REGISTRY_CONFIG)}`);
    for (const profile of report.profiles) {
      const status = profile.surfaces[0].exitReadiness;
      console.log(`${profile.profile.name}: ${status}`);
      for (const finding of profile.findings) {
        console.log(`  ${finding.severity}: ${finding.path} - ${finding.reason}`);
      }
      for (const risk of profile.surfaces[0].effectiveAuth.blockingRisks) {
        console.log(`  blocking: ${risk.key || risk.path} - ${risk.reason}`);
      }
      for (const warning of profile.surfaces[0].effectiveAuth.warnings) {
        console.log(`  warning: ${warning.key || warning.path} - ${warning.reason}`);
      }
    }
  }
}

function cmdShare(action, name, item, flags) {
  if (!name) die('Usage: claude-acc share <plan|audit|apply|enable|disable> <profile> [item]');

  if (action === 'enable') {
    if (!item) die('Usage: claude-acc share enable <profile> <item> [--strategy copy]');
    if (item.includes('/') || item.includes('\\') || item === '.' || item === '..') die('Share item must be a top-level entry name.');
    if (DEFAULT_DENY.has(item) || item === '.claude.json' || item === '.credentials.json' || item.startsWith('.credentials.')) {
      die(`"${item}" is denied and cannot be enabled for sharing.`);
    }
    const strategy = flags.strategy || 'copy';
    if (strategy !== 'copy') {
      die(`Unsupported share strategy "${strategy}". This release only supports "copy".`);
    }
    const profile = loadProfile(name);
    const policy = normalizeSharingPolicy(profile);
    policy.entries[item] = {
      strategy,
      reviewedAt: nowIso(),
      source: join(CLAUDE_HOME, item),
    };
    profile.sharingPolicy = policy;
    saveProfile(profile);
    if (flags.json) printJson({ profile: name, item, enabled: true, policy: profile.sharingPolicy.entries[item] });
    else ok(`Enabled sharing for "${item}" on "${name}".`);
    return;
  }

  if (action === 'disable') {
    if (!item) die('Usage: claude-acc share disable <profile> <item>');
    if (item.includes('/') || item.includes('\\') || item === '.' || item === '..') die('Share item must be a top-level entry name.');
    const profile = loadProfile(name);
    const policy = normalizeSharingPolicy(profile);
    policy.entries[item] = {
      strategy: 'disabled',
      reviewedAt: nowIso(),
      source: join(CLAUDE_HOME, item),
    };
    profile.sharingPolicy = policy;
    saveProfile(profile);
    if (flags.json) printJson({ profile: name, item, enabled: false });
    else ok(`Disabled sharing for "${item}" on "${name}".`);
    return;
  }

  const plan = buildSharePlan(name);
  if (action === 'plan' || action === 'audit') {
    if (flags.json) printJson(plan);
    else {
      for (const item of plan.actions) {
        console.log(`${item.entry.padEnd(20)} ${item.action.padEnd(6)} ${item.classification} - ${item.reason}`);
      }
    }
    return;
  }
  if (action === 'apply') {
    if (flags.dryRun) {
      if (flags.json) printJson(plan);
      else info('Dry run only. No files copied.');
      return;
    }
    const results = applySharePlan(name, plan);
    if (flags.json) printJson({ plan, results });
    else ok(`Applied share plan for "${name}" (${results.length} action(s))`);
    return;
  }
  die(`Unknown share action: ${action}`);
}

function inspectLegacyPath(abs, legacyName = basename(abs).replace('.claude-', '')) {
  const entries = [];
  for (const entry of readdirSync(abs)) {
    const path = join(abs, entry);
    const stat = safeLstat(path);
    let classification = classifyTopLevelEntry(entry).classification;
    if (stat?.isSymbolicLink()) {
      const link = classifySymlink(abs, path);
      classification = `symlink-${link.classification}`;
    }
    entries.push({
      entry,
      path,
      type: stat ? stat.isDirectory() ? 'directory' : stat.isSymbolicLink() ? 'symlink' : 'file' : 'missing',
      classification,
    });
  }
  return { legacyName, path: abs, managed: profileExists(legacyName), entries };
}

function inspectLegacyDir(dir) {
  const legacyName = dir.replace('.claude-', '');
  const abs = resolve(HOME, dir);
  return inspectLegacyPath(abs, legacyName);
}

function legacyDirs() {
  if (!existsSync(HOME)) return [];
  return readdirSync(HOME, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.startsWith('.claude-') && entry.name !== '.claude-acc')
    .map(entry => inspectLegacyDir(entry.name));
}

async function cmdMigrate(action, args, flags) {
  if (action === 'inspect' || !action) {
    const report = { legacy: legacyDirs() };
    if (flags.json) printJson(report);
    else {
      for (const legacy of report.legacy) {
        console.log(`${legacy.legacyName}: ${displayPath(legacy.path)} (${legacy.entries.length} entries)`);
      }
    }
    return;
  }

  if (action === 'import') {
    const legacyName = args[0];
    const profileName = flags.as;
    if (!legacyName || !profileName) die('Usage: claude-acc migrate import <legacy-name> --as <profile> [--dry-run]');
    const sourceRoot = resolveLegacySource(legacyName);
    validateName(profileName);
    if (!existsSync(sourceRoot)) die(`Legacy directory not found: ${displayPath(sourceRoot)}`);
    if (!profileExists(profileName)) createProfile(profileName, { email: flags.email || null, preset: flags.preset || 'personal-balanced' });
    const plan = buildSharePlan(profileName, { sourceRoot });
    if (flags.dryRun) {
      if (flags.json) printJson(plan);
      else info('Dry run only. No files copied.');
      return;
    }
    const rollback = {
      schemaVersion: 1,
      operation: 'migrate-import',
      source: sourceRoot,
      destinationProfile: profileName,
      createdAt: nowIso(),
      createdFiles: [],
      modifiedFiles: [],
      quarantinedPaths: [],
      renamedPaths: [],
      deletedPaths: [],
      backups: [],
    };
    writeJsonAtomic(join(profileDir(profileName), 'migration', `rollback-${Date.now()}.json`), rollback);
    const results = applySharePlan(profileName, plan);
    if (flags.json) printJson({ plan, results });
    else ok(`Imported allowed files from ${displayPath(sourceRoot)} into "${profileName}"`);
    return;
  }

  if (action === 'cleanup') {
    const legacyName = args[0];
    if (!legacyName) die('Usage: claude-acc migrate cleanup <legacy-name> [--delete]');
    const source = resolveLegacySource(legacyName);
    if (!existsSync(source)) die(`Legacy directory not found: ${displayPath(source)}`);
    const plan = {
      action: flags.delete ? 'delete' : 'quarantine',
      legacyName,
      source,
      inspectedAt: nowIso(),
      entries: inspectLegacyPath(source, legacyName).entries,
    };
    if (flags.dryRun) {
      if (flags.json) printJson(plan);
      else info('Dry run only. No files moved or deleted.');
      return;
    }
    mkdirPrivate(join(BACKUPS_DIR, 'legacy-cleanup-records'));
    const recordBase = join(BACKUPS_DIR, 'legacy-cleanup-records', `${Date.now()}-${legacyName}.json`);
    if (flags.delete) {
      const expected = `delete legacy claude profile ${legacyName}`;
      if (!flags.yes && flags.typedConfirm !== expected && !(await typedConfirm('Deletion is irreversible unless you have separate backups.', expected))) {
        die('Cleanup cancelled.');
      }
      writeJsonAtomic(recordBase, {
        schemaVersion: 1,
        operation: 'legacy-cleanup-delete',
        createdAt: nowIso(),
        source,
        deletedPaths: [source],
        quarantinedPaths: [],
        renamedPaths: [],
        entries: plan.entries,
      });
      rmSync(source, { recursive: true, force: true });
      ok(`Deleted legacy directory ${displayPath(source)}`);
      return;
    }
    const dest = join(BACKUPS_DIR, 'legacy-quarantine', new Date().toISOString().replace(/[:.]/g, '-'), `.claude-${legacyName}`);
    mkdirPrivate(dirname(dest));
    writeJsonAtomic(recordBase, {
      schemaVersion: 1,
      operation: 'legacy-cleanup-quarantine',
      createdAt: nowIso(),
      source,
      destination: dest,
      deletedPaths: [],
      quarantinedPaths: [dest],
      renamedPaths: [{ from: source, to: dest }],
      entries: plan.entries,
    });
    renameSync(source, dest);
    ok(`Quarantined legacy directory at ${displayPath(dest)}`);
    return;
  }

  die(`Unknown migrate action: ${action}`);
}

async function cmdRemove(name, flags) {
  const profile = loadProfile(name);
  const managed = loadManaged(name);
  if (!flags.yes && !(await confirm(`Remove managed profile "${name}"? Only manifest-owned files will be removed.`))) {
    info('Cancelled.');
    return;
  }
  const root = profileDir(name);
  const entries = [...(managed.entries || [])].sort((a, b) => b.path.length - a.path.length);
  for (const entry of entries) {
    const abs = join(root, entry.path);
    if (!pathInside(root, abs) || !existsSync(abs)) continue;
    const stat = safeLstat(abs);
    if (stat?.isSymbolicLink()) unlinkSync(abs);
    else rmSync(abs, { recursive: true, force: true });
  }
  if (existsSync(root)) {
    try {
      rmSync(root, { recursive: false });
    } catch {
      warn(`Profile directory not empty; left in place: ${displayPath(root)}`);
    }
  }
  ok(`Removed managed profile "${profile.name}"`);
}

function cmdList(flags) {
  return cmdProfile('list', [], flags);
}

function cmdHelp() {
  console.log(`
claude-acc v${VERSION} - Managed Claude Code profile config selection

Usage:
  claude-acc profile create <name> [--email email] [--preset preset]
  claude-acc add <name> [--email email] [--no-launch]
  claude-acc run <name> [-- args...]
  claude-acc login <name>
  claude-acc doctor [name] [--json]
  claude-acc share <plan|audit|apply|enable|disable> <name> [item] [--json] [--dry-run]
  claude-acc migrate <inspect|import|cleanup> ...
  claude-acc shell-init

Notes:
  This tool selects terminal Claude Code profile configuration. It does not claim
  Desktop Chat, Cowork, or verified account identity without separate verification.
`);
}

async function main() {
  const [,, command, ...rawArgs] = process.argv;
  const { flags, positional, passthrough } = parseFlags(rawArgs);

  switch (command) {
    case 'profile':
      await cmdProfile(positional[0], positional.slice(1), flags);
      break;
    case 'add':
      await cmdAdd(positional[0], flags);
      break;
    case 'login':
      await cmdLogin(positional[0], flags);
      break;
    case 'run':
      await cmdRun(positional[0], flags, passthrough.length ? passthrough : positional.slice(1));
      break;
    case 'doctor':
      cmdDoctor(positional[0], flags);
      break;
    case 'share':
      cmdShare(positional[0], positional[1], positional[2], flags);
      break;
    case 'migrate':
      await cmdMigrate(positional[0], positional.slice(1), flags);
      break;
    case 'remove':
    case 'rm':
      await cmdRemove(positional[0], flags);
      break;
    case 'list':
    case 'ls':
      cmdList(flags);
      break;
    case 'shell-init':
      cmdShellInit();
      break;
    case 'sync':
      if (flags.accountName) cmdShare('apply', flags.accountName, null, flags);
      else {
        for (const profile of getProfiles()) cmdShare('apply', profile, null, { ...flags, quiet: true });
        if (!flags.quiet) ok('Applied share plans for all managed profiles.');
      }
      break;
    case '--version':
    case '-v':
      console.log(VERSION);
      break;
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      cmdHelp();
      break;
    case 'config':
      warn('The old config command is deprecated. Use `claude-acc share audit <profile>` and `claude-acc share apply <profile>`.');
      break;
    default:
      cmdHelp();
      break;
  }
}

main().catch(error => die(error.message));
