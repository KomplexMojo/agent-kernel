'use strict';

const fs = require('fs');
const { spawnSync } = require('child_process');
const { hostForRoute, shellQuote } = require('./config');

function sshBaseArgs(config, routeName) {
  // When an SSH host alias is configured (e.g. "llm-vpn" from ~/.ssh/config),
  // use it directly — the alias already encodes host, port, user, and key.
  const hostAlias = config.host.sshHostAlias;
  if (hostAlias) {
    const args = [
      '-o',
      `ConnectTimeout=${config.host.sshConnectTimeoutSec || 10}`,
      '-o',
      'ServerAliveInterval=30',
      '-o',
      'ServerAliveCountMax=3',
      '-o',
      'BatchMode=yes',
      hostAlias
    ];
    return args;
  }

  const args = [
    '-p',
    String(config.host.sshPort),
    '-o',
    `ConnectTimeout=${config.host.sshConnectTimeoutSec || 10}`,
    '-o',
    'ServerAliveInterval=30',
    '-o',
    'ServerAliveCountMax=3',
    '-o',
    'BatchMode=yes'
  ];

  if (config.host.sshKey && fs.existsSync(config.host.sshKey)) {
    args.push(
      '-i',
      config.host.sshKey,
      '-o',
      'IdentitiesOnly=yes',
      '-o',
      'PreferredAuthentications=publickey',
      '-o',
      'PasswordAuthentication=no'
    );
  }

  args.push(`${config.host.remoteUser}@${hostForRoute(config, routeName)}`);
  return args;
}

function remoteCommandFor(config, executable, remoteArgs) {
  const pathPrefix = [
    config.host.remoteScriptsDir,
    '/home/darren/bin',
    '/home/darren/.local/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin'
  ].filter(Boolean).join(':');
  const command = [
    `export PATH=${shellQuote(pathPrefix)}:$PATH;`,
    'exec',
    shellQuote(executable),
    ...remoteArgs.map((arg) => shellQuote(arg))
  ].join(' ');
  return command;
}

function remoteCommand(config, remoteArgs) {
  return remoteCommandFor(config, config.host.remoteProfileCommand, remoteArgs);
}

function displayCommand(program, args) {
  return [program, ...args].map(shellQuote).join(' ');
}

function runRemote(config, routeName, remoteArgs, options = {}) {
  return runRemoteScript(config, routeName, config.host.remoteProfileCommand, remoteArgs, options);
}

function runRemoteScript(config, routeName, executable, remoteArgs, options = {}) {
  const sshArgs = [...sshBaseArgs(config, routeName), remoteCommandFor(config, executable, remoteArgs)];
  const printable = displayCommand('ssh', sshArgs);

  if (options.dryRun) {
    process.stdout.write(`${printable}\n`);
    return { status: 0, stdout: '', stderr: '', command: printable };
  }

  const result = spawnSync('ssh', sshArgs, {
    encoding: 'utf8',
    env: process.env,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    timeout: options.timeoutMs || undefined
  });

  if (options.capture) {
    return {
      status: result.status === null ? 1 : result.status,
      stdout: result.stdout || '',
      stderr: result.error
        ? `${result.stderr || ''}${result.error.message}`.trim()
        : (result.stderr || ''),
      command: printable
    };
  }

  if (result.error) {
    process.stderr.write(`${result.error.message}\n`);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status === null ? 1 : result.status);
  }

  return { status: 0, stdout: '', stderr: '', command: printable };
}

module.exports = {
  displayCommand,
  remoteCommand,
  remoteCommandFor,
  runRemote,
  runRemoteScript,
  sshBaseArgs
};
