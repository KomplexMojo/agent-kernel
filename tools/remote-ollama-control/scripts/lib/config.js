'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..', '..');

const ROUTE_ALIASES = {
  internal: 'internal',
  lan: 'internal',
  external: 'external',
  vpn: 'external'
};

// Probe results are stable for the life of one invocation; commands call
// hostForRoute repeatedly and must not re-probe each time.
const routeCache = new Map();

/**
 * Can we open a TCP connection to host:port within timeoutMs?
 *
 * Runs in a child process because the callers here are synchronous and node
 * has no synchronous socket API. A closed port and a silently dropped packet
 * both answer "no", which is exactly what route selection needs.
 */
function probeTcp(host, port, timeoutMs) {
  if (!host) return false;
  const script =
    'const net=require("net");' +
    'const s=net.connect({host:process.argv[1],port:Number(process.argv[2])});' +
    's.setTimeout(Number(process.argv[3]));' +
    'const done=(ok)=>{try{s.destroy();}catch(e){}process.exit(ok?0:1);};' +
    's.on("connect",()=>done(true));' +
    's.on("timeout",()=>done(false));' +
    's.on("error",()=>done(false));';
  const result = spawnSync(
    process.execPath,
    ['-e', script, String(host), String(port), String(timeoutMs)],
    { timeout: timeoutMs + 2000, stdio: 'ignore' }
  );
  return result.status === 0;
}

/**
 * Turn a requested route into a concrete one.
 *
 * An explicit route is always honoured — auto-detection never overrides what
 * the caller asked for. For 'auto', the internal route is probed first and
 * preferred whenever it answers, because it is the faster path.
 *
 * Note the probe is doing real work here, not guessing from VPN state. Whether
 * a VPN leaves the LAN reachable depends on its tunneling mode, and that is not
 * stable: both behaviours were observed on this setup within minutes of each
 * other (split tunneling kept the LAN reachable; full tunneling did not). So
 * "is the VPN on?" cannot decide the route — only "does this host answer?" can.
 */
function resolveRoute(config, routeName) {
  const requested = routeName || config.host.defaultRoute || 'auto';
  if (requested !== 'auto') {
    const canonical = ROUTE_ALIASES[requested];
    if (!canonical) {
      throw new Error(`Unknown route '${requested}'. Use internal, external, or auto.`);
    }
    return canonical;
  }

  const { internalHost, externalHost, sshPort, routeProbeMs, routeProbeInternalMs } = config.host;
  const cacheKey = `${internalHost}|${externalHost}|${sshPort}`;
  if (routeCache.has(cacheKey)) return routeCache.get(cacheKey);

  // The internal probe gets a much shorter deadline than the external one. A
  // host on the same LAN answers in well under 100ms, so a longer wait cannot
  // turn a "no" into a "yes" — it only taxes every off-LAN run, which pays this
  // timeout in full before falling through to the route it was always going to
  // use. The external probe keeps the generous budget: it crosses the internet.
  let resolved = null;
  if (probeTcp(internalHost, sshPort, routeProbeInternalMs)) {
    resolved = 'internal';
  } else if (probeTcp(externalHost, sshPort, routeProbeMs)) {
    resolved = 'external';
  }

  if (!resolved) {
    throw new Error(
      `Route auto-detection failed: neither the internal host (${routeProbeInternalMs}ms) nor the external ` +
        `host (${routeProbeMs}ms) answered on port ${sshPort}.\n` +
        `  - On the host's own network, check LLM_INTERNAL_HOST and that the host is up.\n` +
        `  - Off it, check that any required VPN is connected and that LLM_EXTERNAL_HOST still resolves ` +
        `to the current address (a dynamic-DNS record can go stale).\n` +
        `  - Force a specific path with --route internal|external to see the underlying error.`
    );
  }

  // Announce the choice on stderr, never stdout: print-env writes shell exports
  // to stdout and --json emits parseable output there.
  process.stderr.write(`[route] auto-detected: ${resolved}\n`);

  routeCache.set(cacheKey, resolved);
  return resolved;
}

function clearRouteCache() {
  routeCache.clear();
}

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
    local: {
      host: env.LLM_LOCAL_OLLAMA_HOST || 'http://127.0.0.1:11434',
      model: env.LLM_LOCAL_OLLAMA_MODEL || ''
    },
    host: {
      remoteUser: env.LLM_REMOTE_USER || 'darren',
      // Deliberately no defaults: site addresses are operator data and must not
      // be committed. Both come from the untracked config/llm-host.env.
      internalHost: env.LLM_INTERNAL_HOST || '',
      externalHost: env.LLM_EXTERNAL_HOST || '',
      // Standard SSH port as the fallback. A site running SSH elsewhere sets
      // LLM_SSH_PORT in the untracked env file rather than committing it here.
      sshPort: numberFrom(env.LLM_SSH_PORT, 22),
      sshKey: env.LLM_SSH_KEY ? resolveMaybeRelative(rootDir, env.LLM_SSH_KEY) : '',
      sshHostAlias: env.LLM_SSH_HOST_ALIAS || '',
      // 'auto' probes and prefers the internal route when it answers.
      defaultRoute: env.LLM_DEFAULT_ROUTE || 'auto',
      routeProbeMs: positiveIntegerFrom(env.LLM_ROUTE_PROBE_MS, 1500),
      routeProbeInternalMs: positiveIntegerFrom(env.LLM_ROUTE_PROBE_INTERNAL_MS, 600),
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

function requireHost(value, envVar, route) {
  if (!value) {
    throw new Error(
      `${envVar} is not set, so route '${route}' has no address. ` +
        `Copy config/llm-host.env.example to config/llm-host.env and fill it in. ` +
        `That file is untracked on purpose — host addresses are never committed.`
    );
  }
  return value;
}

function hostForRoute(config, routeName) {
  const route = resolveRoute(config, routeName);
  if (route === 'internal') {
    return requireHost(config.host.internalHost, 'LLM_INTERNAL_HOST', route);
  }
  return requireHost(config.host.externalHost, 'LLM_EXTERNAL_HOST', route);
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
  // The context the profile is meant to serve, set where the server can actually see it.
  //
  // The benchmark used to ask per request -- `options: { num_ctx }` -- while posting to
  // /v1/chat/completions. `options` is an Ollama-native field and the OpenAI-compatible shim drops
  // it silently, so every load fell back to Ollama's VRAM-based default of 32768. On `primary` that
  // default happens to equal the configured value, so the bug was invisible on half the matrix;
  // on `dual` it meant 32768 served against a configurationId reading ctx65536 and a matrixHash
  // encoding it. Identity asserting something that did not happen.
  //
  // Serving it is coarser than asking per request -- every model on a profile gets the same window
  // -- which is exactly right while the matrix holds context constant per profile, and a test
  // fails if that ever stops being true.
  if (Number.isInteger(profile.defaultContext) && profile.defaultContext > 0) {
    env.OLLAMA_CONTEXT_LENGTH = String(profile.defaultContext);
  }
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
  clearRouteCache,
  endpointFor,
  expandHome,
  getProfile,
  hostForRoute,
  probeTcp,
  resolveRoute,
  loadConfig,
  localEndpointForProfile,
  parseEnvFile,
  resolveMaybeRelative,
  serviceEnvironment,
  shellQuote
};
