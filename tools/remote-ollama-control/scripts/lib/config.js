'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');

function stripInlineComment(value) {
  let quote = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if ((char === '"' || char === "'") && value[index - 1] !== '\\') {
      quote = quote === char ? null : quote || char;
    }
    if (char === '#' && quote === null && /\s/.test(value[index - 1] || ' ')) {
      return value.slice(0, index).trim();
    }
  }
  return value.trim();
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const env = {};
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const normalized = line.startsWith('export ') ? line.slice(7).trim() : line;
    const match = normalized.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) {
      continue;
    }
    let value = stripInlineComment(match[2]);
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value;
  }
  return env;
}

function expandHome(input) {
  if (!input) {
    return input;
  }
  if (input === '~') {
    return os.homedir();
  }
  if (input.startsWith('~/')) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

function resolveMaybeRelative(root, input) {
  const expanded = expandHome(input);
  if (!expanded) {
    return expanded;
  }
  if (path.isAbsolute(expanded)) {
    return expanded;
  }
  return path.resolve(root, expanded);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function numberFrom(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveIntegerFrom(value, fallback) {
  const parsed = numberFrom(value, fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function loadConfig(rootDir = ROOT_DIR) {
  const envFile = path.join(rootDir, 'config', 'llm-host.env');
  const env = { ...parseEnvFile(envFile), ...process.env };
  const profilesJson = readJson(path.join(rootDir, 'config', 'llm-profiles.json'));
  const modelsJson = readJson(path.join(rootDir, 'config', 'models.json'));

  const remoteScriptsDir = env.LLM_REMOTE_SCRIPTS_DIR || '/home/darren/bin';
  const bindHost = env.LLM_OLLAMA_BIND_HOST || '127.0.0.1';
  const profiles = {};

  for (const [name, profile] of Object.entries(profilesJson.profiles || {})) {
    profiles[name] = {
      name,
      ...profile,
      bindHost: profile.bindHost || bindHost,
      port: numberFrom(profile.port, 11434),
      rocrVisibleDevices: profile.rocrVisibleDevices || profile.gpuDevices || '',
      hipVisibleDevices: profile.hipVisibleDevices || profile.gpuDevices || ''
    };
  }

  return {
    rootDir,
    env,
    envFile,
    profiles,
    models: modelsJson.models || {},
    benchmark: modelsJson.benchmark || {},
    host: {
      remoteUser: env.LLM_REMOTE_USER || 'darren',
      internalHost: env.LLM_INTERNAL_HOST || '192.168.1.143',
      externalHost: env.LLM_EXTERNAL_HOST || '154.5.75.3',
      sshPort: numberFrom(env.LLM_SSH_PORT, 2222),
      sshKey: resolveMaybeRelative(rootDir, env.LLM_SSH_KEY || '~/.ssh/ubuntu_llm_ed25519'),
      defaultRoute: env.LLM_DEFAULT_ROUTE || 'internal',
      remoteProjectDir: env.LLM_REMOTE_PROJECT_DIR || '/home/darren/Documents/GitHub/agent-kernel',
      remoteScriptsDir,
      remotePackageDir: env.LLM_REMOTE_PACKAGE_DIR || '/home/darren/remote-ollama-control',
      remoteProfileCommand: env.LLM_REMOTE_PROFILE_CMD || `${remoteScriptsDir}/remote-ollama-profile`,
      resultsDir: resolveMaybeRelative(rootDir, env.LLM_RESULTS_DIR || './results'),
      profileManager: env.LLM_PROFILE_MANAGER || 'auto',
      sshConnectTimeoutSec: positiveIntegerFrom(env.LLM_SSH_CONNECT_TIMEOUT, 10)
    }
  };
}

function getProfile(config, profileName) {
  const name = profileName || 'primary';
  const profile = config.profiles[name];
  if (!profile) {
    const available = Object.keys(config.profiles).join(', ');
    throw new Error(`Unknown profile '${name}'. Available profiles: ${available}`);
  }
  return profile;
}

function hostForRoute(config, routeName) {
  const route = routeName || config.host.defaultRoute || 'internal';
  if (route === 'internal' || route === 'lan') {
    return config.host.internalHost;
  }
  if (route === 'external' || route === 'vpn') {
    return config.host.externalHost;
  }
  throw new Error(`Unknown route '${route}'. Use internal or external.`);
}

function endpointFor(config, profile, routeName) {
  return `http://${hostForRoute(config, routeName)}:${profile.port}`;
}

function localEndpointForProfile(profile) {
  const host = profile.bindHost === '0.0.0.0' || profile.bindHost === '::' ? '127.0.0.1' : profile.bindHost;
  return `http://${host}:${profile.port}`;
}

function serviceEnvironment(profile) {
  const env = {
    ROCR_VISIBLE_DEVICES: profile.rocrVisibleDevices,
    HIP_VISIBLE_DEVICES: profile.hipVisibleDevices,
    OLLAMA_HOST: `${profile.bindHost}:${profile.port}`,
    OLLAMA_PROFILE: profile.name
  };
  if (profile.hsaOverrideGfxVersion) {
    env.HSA_OVERRIDE_GFX_VERSION = profile.hsaOverrideGfxVersion;
  }
  return env;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

module.exports = {
  ROOT_DIR,
  endpointFor,
  expandHome,
  getProfile,
  hostForRoute,
  loadConfig,
  localEndpointForProfile,
  parseEnvFile,
  resolveMaybeRelative,
  serviceEnvironment,
  shellQuote
};
