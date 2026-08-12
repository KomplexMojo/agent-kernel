'use strict';

const { spawnSync } = require('child_process');
const { localEndpointForProfile } = require('./config');

function runCapture(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: { ...process.env, ...(options.env || {}) },
    timeout: options.timeoutMs || 15000
  });

  if (result.error && result.error.code === 'ENOENT') {
    return {
      available: false,
      command: [command, ...args].join(' '),
      status: null,
      stdout: '',
      stderr: `${command} not found`
    };
  }

  return {
    available: true,
    command: [command, ...args].join(' '),
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

function collectLocalTelemetry(profile, config, label = 'snapshot') {
  const baseUrl = localEndpointForProfile(profile);
  const env = { OLLAMA_HOST: baseUrl };
  const serviceName = `ollama-profile@${profile.name}.service`;

  return {
    label,
    timestamp: new Date().toISOString(),
    profile: profile.name,
    expectedGpuVisibility: profile.gpuDevices,
    rocrVisibleDevices: profile.rocrVisibleDevices,
    hipVisibleDevices: profile.hipVisibleDevices,
    hsaOverrideGfxVersion: profile.hsaOverrideGfxVersion || '',
    bindHost: profile.bindHost,
    port: profile.port,
    localEndpoint: baseUrl,
    managerMode: config.host.profileManager,
    commands: {
      rocmSmi: runCapture('rocm-smi', [], { timeoutMs: 20000 }),
      ollamaPs: runCapture('ollama', ['ps'], { env }),
      ssListening: runCapture('ss', ['-tulnp']),
      systemctlUserStatus: runCapture('systemctl', ['--user', 'status', serviceName, '--no-pager'], { timeoutMs: 10000 }),
      systemctlSystemStatus: runCapture('systemctl', ['status', serviceName, '--no-pager'], { timeoutMs: 10000 })
    }
  };
}

module.exports = {
  collectLocalTelemetry,
  runCapture
};
