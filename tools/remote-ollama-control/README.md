# Remote Ollama Control

This package makes the MacBook the control/client machine and the Ubuntu box the Ollama host.

- MacBook: runs Claude CLI, benchmarks, SSH control, and result collection.
- Ubuntu: runs one or more Ollama profile instances.
- Default architecture: `Mac Claude CLI -> selected remote Ollama endpoint`.
- Optional project workflow: Ubuntu can keep a git checkout synced, snapshot dirty work, pull from `origin/main`, and push `HEAD` back to `main` when explicitly invoked.

## What this tool is for

Use this tool when local agent workflows should spend inference work on the Ubuntu GPU machine while the Mac keeps control of prompts, tunnels, benchmarks, and result files. It manages three concerns in one place:

- starting/stopping profile-specific Ollama instances on Ubuntu;
- opening safe SSH-tunnel routes from the Mac;
- running local or remote benchmark/control commands with consistent environment variables.

## Common tasks

| Need | Command family |
| --- | --- |
| Check remote Ollama state | `status`, `ps`, `logs`, `telemetry`, `doctor` |
| Start or restart a profile | `start`, `restart`, `stop`, `dry-run start` |
| Run Claude/Codex-side work through remote Ollama | `claude`, `run-local`, `use-remote-ollama` |
| Run Claude/Codex-side work offline on the Mac's own Ollama | `claude --local`, `run-local --local`, `print-env --local` |
| Run commands on Ubuntu | `exec` |
| Benchmark models or tool-call generation | `benchmark`, `benchmark-matrix`, `benchmark-hardware`, `run-content-gen`, `run-abstract-plan` |
| Keep the remote checkout safe | `project-safety-check`, `project-sync`, `project-push-main` |

## Profiles

Profiles live at `tools/remote-ollama-control/config/llm-profiles.json` in the `agent-kernel` repo. From this tool directory, the relative path is `config/llm-profiles.json`.

| Profile | GPU visibility | Intended GPU | Port | Default model | Default context | Default num_predict |
|---|---:|---|---:|---|---:|---:|
| `primary` | `0` | GPU 0 / x16 primary card | `11434` | `qwen3.8:27b` | `32768` | `4096` |
| `secondary` | `1` | GPU 1 / x4 service profile; excluded from single-GPU benchmarks | `11435` | `qwen3:14b` | `8192` | `4096` |
| `dual` | `0,1` | both GPUs for split/offloaded 27B/30B models | `11436` | `qwen3.8:27b` | `65536` | `32768` |

The remote manager sets `ROCR_VISIBLE_DEVICES`, `HIP_VISIBLE_DEVICES`, `HSA_OVERRIDE_GFX_VERSION`, and `OLLAMA_HOST` per profile. The default `HSA_OVERRIDE_GFX_VERSION=10.3.0` is included because RX 6700/6750 class `gfx1031` cards commonly need that compatibility override for Ollama ROCm offload.

Profile starts resolve the Ollama executable in this order: explicit `OLLAMA_BIN`, executable
`~/.local/bin/ollama`, then `ollama` from PATH. The resolved value is also written into systemd profile
state, so unattended services use the same version as interactive control commands.

Qwen 3.8 currently has one Ollama parameter size: 27B Q4_K_M (about 17.7 GB including its projector).
On this host it runs at the declared 32K primary context with a measured 52% CPU / 48% GPU split. At
the declared 65K dual context it uses 16% CPU / 84% GPU; at 32K dual it reaches 95% GPU. The primary
profile is therefore a valid minimum-hardware hybrid, while dual remains the preferred throughput
configuration.

## Setup

Run these commands from the tool directory on the Mac:

```bash
cd /Users/darren/Documents/GitHub/agent-kernel/tools/remote-ollama-control
cp config/llm-host.env.example config/llm-host.env
```

Edit `config/llm-host.env` for the Mac-side SSH settings. Keep `LLM_OLLAMA_BIND_HOST=127.0.0.1` for SSH-tunnel access. Use a LAN/VPN bind address only if the Ubuntu firewall limits access.

### SSH Host Aliases (Recommended)

The preferred connection method uses SSH host aliases defined in `~/.ssh/config`:

This is the recommended setup precisely because it keeps addresses, ports, and key paths in your own `~/.ssh/config` — outside the repository — leaving only an opaque alias name in any file the project tracks.

```
Host llm-lan
  HostName <lan-host-or-ip>
  User <remote-user>
  Port <ssh-port>
  IdentityFile ~/.ssh/<key-name>
  IdentitiesOnly yes
  AddKeysToAgent yes
  UseKeychain yes

Host llm-vpn
  HostName <wan-hostname-or-ip>
  User <remote-user>
  Port <ssh-port>
  IdentityFile ~/.ssh/<key-name>
  IdentitiesOnly yes
  AddKeysToAgent yes
  UseKeychain yes
```

Set the alias in `config/llm-host.env`:

```bash
LLM_SSH_HOST_ALIAS=llm-vpn
```

When `LLM_SSH_HOST_ALIAS` is set, the tooling uses `ssh llm-vpn` directly instead of constructing SSH arguments from `LLM_*_HOST`, `LLM_SSH_PORT`, and `LLM_SSH_KEY`. This is simpler and respects any ProxyJump, VPN routing, or keychain integration in your SSH config.

Quick connectivity check:

```bash
ssh llm-vpn 'echo ok'
```

### Manual SSH Key Setup (Alternative)

If not using host aliases, load the key into the Mac SSH agent:

```bash
ssh-add --apple-use-keychain ~/.ssh/<key-name>
ssh-add -l
ssh -p <ssh-port> -i ~/.ssh/<key-name> <remote-user>@<wan-hostname-or-ip> 'echo ok'
```

If the agent is empty, key auth fails as `Permission denied (publickey,password)` — which reads exactly like a dead host. Load the key before diagnosing anything else.

Install the package onto Ubuntu from the Mac:

```bash
cd /Users/darren/Documents/GitHub/agent-kernel/tools/remote-ollama-control
./scripts/install-remote.sh internal
```

Do not run `install-remote.sh` on Ubuntu, and do not run it with `sudo`. It is a Mac-to-Ubuntu SSH deploy script. If you are already logged into Ubuntu and have this repo checkout there, use the local installer instead:

```bash
cd ~/Documents/GitHub/agent-kernel/tools/remote-ollama-control
./scripts/install-local-ubuntu.sh
```

The install script copies this tool to `/home/darren/remote-ollama-control` and creates these Ubuntu-side command links:

- `/home/darren/bin/remote-ollama-profile`
- `/home/darren/bin/remote-project-safety-check`

Create a remote runtime config on Ubuntu:

```bash
ssh llm-vpn
cd /home/darren/remote-ollama-control
cp config/llm-host.env.example config/llm-host.env
```

For safe SSH-tunnel mode, leave this in the Ubuntu config:

```bash
LLM_OLLAMA_BIND_HOST=127.0.0.1
```

For direct LAN/VPN mode, set `LLM_OLLAMA_BIND_HOST` to a LAN/VPN-reachable address and firewall the ports first.

Optional user-systemd install on Ubuntu:

```bash
mkdir -p ~/.config/systemd/user
cp ~/remote-ollama-control/systemd/ollama-profile@.service ~/.config/systemd/user/
systemctl --user daemon-reload
```

Without the systemd unit, `remote-ollama-profile` uses managed pid files under `~/.local/state/remote-ollama`.

`start --dry-run` is plan-only and reads no live process state: it prints the command it would run
and names the preflight it did **not** evaluate. That is deliberate — a plan must be the same plan on
every host, and the benchmark box always has Ollama running, so a dry run that consulted live state
exited 1 there and failed the source preflight that gates every benchmark run. A real `start` still
reads live state and still refuses when the profile is already running or the port is occupied.

## Unattended Benchmark Agent (M4b)

Canonical content-gen scenario count: 100 (source: `loadScenarioCatalog()`)

The Ubuntu installer also deploys `agent-kernel-benchmark`, its unprivileged user service/timer, and
an operator-owned environment template. Installation is idempotent and never overwrites an existing
`~/.config/agent-kernel-benchmark/benchmark-agent.env`. Source fetches use a mirror under
`~/.local/share/agent-kernel-benchmark/source.git`; local state and the isolated result checkout live
under `~/.local/state/agent-kernel-benchmark/`. The operator's project checkout is never used.

M4b ships with `AK_BENCHMARK_DRY_RUN=1`. In that mode the agent fetches the configured source ref,
computes the immutable run key, classifies path/hash triggers, prints JSON, and exits without writing
poll state, running a model/GPU, or publishing Git results. The internal Node lock is the only
single-instance mechanism; the timer does not add a second lock.

On Ubuntu, install and inspect without enabling scheduling:

```bash
./scripts/install-local-ubuntu.sh
$EDITOR ~/.config/agent-kernel-benchmark/benchmark-agent.env
agent-kernel-benchmark
systemctl --user status agent-kernel-benchmark.timer
```

Derive the three immutable identities from the exact installed source instead of transcribing hashes:

```bash
cd ~/remote-ollama-control
node - <<'NODE'
const path = require('node:path');
const { currentBenchmarkIdentity } = require('./scripts/lib/benchmark-result-reader');
const identity = currentBenchmarkIdentity(path.resolve('.'));
process.stdout.write([
  `AK_BENCHMARK_SCENARIO_HASH=${identity.scenarioSet.sha256}`,
  `AK_BENCHMARK_MATRIX_HASH=${identity.matrix.sha256}`,
  `AK_BENCHMARK_EXECUTION_SUITE_HASH=${identity.execution.executionSuiteHash}`,
  '',
].join('\n'));
NODE
```

Copy those lines into `~/.config/agent-kernel-benchmark/benchmark-agent.env`, keep
`AK_BENCHMARK_DRY_RUN=1` and `AK_BENCHMARK_LIVE=0`, then retain the read-only handoff:

```bash
mkdir -p ~/.local/state/agent-kernel-benchmark
agent-kernel-benchmark --dry-run | tee ~/.local/state/agent-kernel-benchmark/operator-dry-run.json
node -e 'const r=require(process.argv[1]); if(r.status!=="dry_run"||!r.trigger?.modes) process.exit(1)' \
  ~/.local/state/agent-kernel-benchmark/operator-dry-run.json
```

Do not enable live mode until both Git-owned route manifests named in the environment template exist in
the pinned source commit and cover every execution scenario/variant. Missing manifests deliberately fail
closed; an operator-created placeholder or generic fixture mapping is not valid benchmark evidence.

After reviewing a successful dry-run, enable scheduling explicitly:

```bash
systemctl --user enable --now agent-kernel-benchmark.timer
systemctl --user list-timers agent-kernel-benchmark.timer
journalctl --user -u agent-kernel-benchmark.service
```

Disable and uninstall without deleting retained state/results:

```bash
systemctl --user disable --now agent-kernel-benchmark.timer
rm ~/.config/systemd/user/agent-kernel-benchmark.service
rm ~/.config/systemd/user/agent-kernel-benchmark.timer
systemctl --user daemon-reload
rm ~/bin/agent-kernel-benchmark
```

Remove `~/remote-ollama-control`, `~/.local/share/agent-kernel-benchmark`,
`~/.local/state/agent-kernel-benchmark`, or the operator environment only after separately deciding
their retained data is no longer needed. M5—not this installer—authorizes live GPU execution and the
first `benchmark-results` branch publication.

### Heartbeat and interim progress

A full matrix is 7 configurations × 100 scenarios × up to 3 passes — 700 attempts at the floor,
2,100 at the ceiling — and runs for **days**. Two things follow, and both are wired in:

**The agent's failure mode is silence, not error.** Two incidents exited zero the whole time: 147
consecutive nightlies dying on a deleted branch ref, and a nine-day stretch returning `dry_run` on
every poll. Nothing that watches for a non-zero exit catches either. So `agent-kernel-heartbeat`
publishes a beacon every five minutes to the **`benchmark-heartbeat`** branch, and
`.github/workflows/benchmark-heartbeat-alarm.yml` opens an issue when that beacon goes quiet for an
hour.

The heartbeat is a **separate timer from the benchmark**, deliberately: a run occupies
`agent-kernel-benchmark` for days, so a beat emitted by the agent would fall silent for exactly the
stretch that most needs watching. It reads state and progress from disk and never waits on the run.

```bash
systemctl --user enable --now agent-kernel-heartbeat.timer
systemctl --user list-timers agent-kernel-heartbeat.timer
agent-kernel-heartbeat          # publish one beat by hand
```

The heartbeat branch holds exactly **one commit**, force-replaced on every beat. That is why it does
not share a code path with `publishResult`, which treats a force as an error because results are
append-only evidence. The published document carries no host, port, route, or hostname — this is a
public repository, and `composeHeartbeat` emits a fixed shape so topology cannot ride along.

**Progress is a range, not a percentage.** Early stop means a configuration can finish holding far
fewer records than scenarios × passes, so recorded attempts cannot predict the remainder. Every
count `progress.json` reports is a floor/ceiling pair, and every quality figure is **per
configuration** — the collapse breaker and early stop both evaluate one configuration at a time, so
a matrix-wide average hides the case it most needs to show: one configuration collapsing while the
others carry the mean.

`run-content-gen` rewrites `progress.json` in its result directory after every attempt (local disk,
atomic rename). The heartbeat publishes whatever it last said, which keeps a days-long run decoupled
from the publish cadence — pushing per attempt would be ~2,000 commits per run. Reported per
configuration: attempts and passes complete, tool-call / verdict / score rates against the
qualification bars, whether the configuration **can still qualify**, and headroom to each collapse
floor. Alerts name the configuration.

### Long runs, timeouts, and resume

The authoring child is killed at **72h** (`AUTHORING_TIMEOUT_MS`). This was 24h until 2026-08-23,
which sat *inside* the matrix's plausible duration — the guard rail would SIGTERM the run it exists
to protect, and `spawnSync` surfaced it as an opaque `content generation failed` after a day of GPU
time. A timeout kill now says so explicitly and names the retained evidence.

A killed run is **resumable and resumes itself**. The pipeline passes `--resume <dir>` whenever the
retention directory already holds a content-gen run with a manifest. That is safe without an
identity check here because the retention directory is keyed by `runKey`, which already covers the
source commit and all three identity hashes — anything found there belongs to this exact run and
cannot blend two catalogs. The directory is named explicitly rather than relying on bare `--resume`,
whose `latest` is resolved against `LLM_RESULTS_DIR` by the child.

### Reading published benchmark evidence

Fetch the results ref, then use the result reader from the repository root. `latest_attempt` answers
whether the newest scheduled run completed; `latest_success` is the last completed qualifying result.
They are deliberately different: an infrastructure failure updates the former without replacing the
latter.

```bash
git fetch origin benchmark-results:refs/remotes/origin/benchmark-results
node - <<'NODE'
const path = require('node:path');
const {
  currentBenchmarkIdentity,
  readPublishedBenchmarkResult,
} = require('./tools/remote-ollama-control/scripts/lib/benchmark-result-reader');
const toolRoot = path.resolve('tools/remote-ollama-control');
const evidence = readPublishedBenchmarkResult({
  repoRoot: process.cwd(),
  ref: 'origin/benchmark-results',
  selection: 'latest_attempt',
  expectedIdentity: currentBenchmarkIdentity(toolRoot),
});
process.stdout.write(`${JSON.stringify(evidence.record, null, 2)}\n`);
NODE
```

Use `selection: 'latest_success'` only when the question explicitly asks for the last qualifying
baseline. The reader rejects unsupported schemas, malformed identities, and scenario-count,
scenario-hash, matrix-hash, or execution-suite drift. Compact JSON is committed on `benchmark-results`; raw prompts,
responses, generated artifacts, and telemetry remain ignored and local.

New publications use `agent-kernel-benchmark-result/v2`, which requires the execution-suite identity
used for qualification. Legacy v1 records remain readable as `historical_incomparable`; the reader
does not invent the missing execution identity or compare them with current evidence. If
`latest-success.json` does not exist, `latest_success` returns `record: null` with compatibility status
`no_qualifying_evidence`. Malformed files and inaccessible refs still fail closed.

## Network Modes

Two routes, both resolved from your untracked `config/llm-host.env`.

| Route | Env var | Use when |
|---|---|---|
| `--route internal` | `LLM_INTERNAL_HOST` | Client and host are on the same local network |
| `--route external` | `LLM_EXTERNAL_HOST` | Reaching the host from outside that network |

Neither has a default address. If the variable is unset, the tooling errors and points back at the env file rather than guessing.

### Route auto-detection (the default)

**You do not need to pick a route.** `--route auto` is the default (`LLM_DEFAULT_ROUTE=auto`): it opens a TCP probe to each host in turn and takes the first that answers, preferring internal because it is the faster path. Move between the local network and remote and the same command keeps working. The chosen route is announced on stderr as `[route] auto-detected: <route>`, and the result is cached for the invocation so repeated calls probe once.

An explicit `--route internal` or `--route external` is always honoured and skips probing — use it to pin a path or to see the underlying error when auto-detection reports that neither answered.

**The probe tests reachability; it does not infer anything from VPN state.** That distinction matters: whether a VPN leaves the local network reachable depends on its tunneling mode, and that is not stable. Both behaviours were observed on this setup within minutes — split tunneling kept the LAN reachable with the VPN up, then full tunneling did not. So "is the VPN on?" cannot decide the route; only "does this host answer?" can. With a VPN up but the LAN still reachable, auto correctly stays on the fast internal path.

Deadlines are asymmetric on purpose. `LLM_ROUTE_PROBE_INTERNAL_MS` (default 600) is short because a host on the same network answers in well under 100 ms — a longer wait cannot turn a "no" into a "yes", it only taxes every off-network run, which pays that timeout in full before falling through to the route it was always going to use. `LLM_ROUTE_PROBE_MS` (default 1500) keeps a generous budget because it crosses the internet. Measured on this setup: off-network detection costs ~700 ms, down from ~1600 ms with a symmetric timeout.

When `LLM_SSH_HOST_ALIAS` is set, the alias handles route selection and the tooling uses it directly regardless of `--route`. This is the recommended setup.

### Setting up external access

External reachability depends on your own network, so the specifics belong in your env file and `~/.ssh/config`, not here. In general it requires each layer in the path to permit the connection — typically a router port-forward for the SSH port, and a host firewall that accepts your source address. Keep the exposed surface to SSH alone and tunnel everything else; see [Security](#security).

**Where only the SSH port is exposed, an external route must tunnel.** `--direct` targets a service port directly, so it cannot work from outside when that port is not reachable. Use the SSH tunnel (the default) for external runs and treat `--direct` as a local-network shortcut.

**Prefer a hostname over a literal IP for the external address** when that address is dynamic. A residential WAN address changes on router reboot or power loss, so a literal IP is correct only until the next outage; a dynamic-DNS name tracks it. Set it once in `config/llm-host.env`, or per command:

```bash
./bin/remote-ollama-mac status --route external --external-host <wan-hostname-or-ip> --profile dual
```

### Diagnosing a failed external route

Work down this list before concluding the host is down — in practice it usually is not.

1. **Is the SSH agent loaded?** An empty agent fails as `Permission denied (publickey,password)`, which reads exactly like a dead host. `ssh-add -l` to check.
2. **Are you inside the host's own network?** Many routers do not hairpin NAT, so the external address is unreachable from the local network *by design*. Use `--route internal` there. The tell: the hostname and its resolved IP fail **identically** — that pattern means a routing path problem, never a stale address.
3. **Does the name still resolve correctly?** `host <wan-hostname>`. A dynamic-DNS record can go stale and point somewhere unrelated. Only after the name is *proven* wrong, override with `--external-host <current-ip>` until it propagates.
4. **Is your source address the one the host's firewall accepts?** If access is restricted to specific sources, confirm your egress matches: `curl -s https://api.ipify.org`. A restricted source that has changed produces a timeout indistinguishable from a dead host.

⚠️ When access is gated on a VPN or jump host, remember that **its address is your own egress, not the host's.** Pinging it always succeeds and proves nothing about whether the host is reachable.

```bash
./bin/remote-ollama-mac status --route external --external-host <wan-host-or-ip> --profile dual
```

Safe bind default is `127.0.0.1`. In this mode, use an SSH tunnel before querying from the Mac. The Mac wrapper's default tunnel ports are offset by `+10000` so they do not collide with a Mac-local Ollama:

| Profile | Remote Ubuntu port | Default Mac tunnel endpoint |
|---|---:|---|
| `primary` | `11434` | `http://127.0.0.1:21434` |
| `secondary` | `11435` | `http://127.0.0.1:21435` |
| `dual` | `11436` | `http://127.0.0.1:21436` |

Print a manual tunnel command when you want to keep a tunnel open yourself:

```bash
./bin/remote-ollama-mac tunnel-command --profile primary --route internal
# Run the printed ssh command in a separate terminal.
export OLLAMA_HOST=http://127.0.0.1:21434
```

Use a specific local tunnel port only when needed:

```bash
./bin/remote-ollama-mac tunnel-command --profile primary --route internal --local-port 21434
# Run the printed ssh command in a separate terminal.
export OLLAMA_HOST=http://127.0.0.1:21434
```

For direct LAN/VPN queries without a tunnel, set `LLM_OLLAMA_BIND_HOST` on Ubuntu to a LAN/VPN-reachable address, open only the needed ports to trusted source IPs, restart the profile, and use the endpoint printed by `remote-ollama-mac`.

## Control Commands

```bash
cd /Users/darren/Documents/GitHub/agent-kernel/tools/remote-ollama-control
./bin/remote-ollama-mac status --route internal
./bin/remote-ollama-mac start --profile primary --model qwen2.5-coder:14b
./bin/remote-ollama-mac start --profile secondary --model qwen2.5-coder:7b
./bin/remote-ollama-mac start --profile dual --model qwen3-coder:30b
./bin/remote-ollama-mac stop --profile primary
./bin/remote-ollama-mac restart --profile dual --model qwen3-coder:30b
./bin/remote-ollama-mac ps
./bin/remote-ollama-mac logs --profile primary
./bin/remote-ollama-mac telemetry --profile dual
./bin/remote-ollama-mac doctor --profile dual --model qwen3-coder:30b --route external
./bin/remote-ollama-mac dry-run start --profile dual --model qwen3-coder:30b
```

## Claude CLI On Mac

Run Claude against a selected remote Ollama endpoint:

```bash
./bin/remote-ollama-mac claude --profile primary --model qwen2.5-coder:14b
```

By default this opens a temporary SSH tunnel over port `2222`, points Claude at the tunnel endpoint, and closes the tunnel when Claude exits. Use `--direct` only when the Ollama profile ports are intentionally reachable from the Mac without a tunnel:

```bash
./bin/remote-ollama-mac claude --profile dual --model qwen3-coder:30b --route external
./bin/remote-ollama-mac claude --profile primary --model qwen2.5-coder:7b --direct
```

Or source environment variables:

```bash
source ./scripts/use-remote-ollama primary
claude --model qwen2.5-coder:14b
```

`use-remote-ollama` defaults to SSH-tunnel endpoints. If you used a non-default local tunnel port:

```bash
REMOTE_OLLAMA_LOCAL_PORT=21434 source ./scripts/use-remote-ollama primary
claude --model qwen2.5-coder:14b
```

For direct LAN/VPN access without a tunnel:

```bash
REMOTE_OLLAMA_TUNNEL=0 source ./scripts/use-remote-ollama primary
```

The wrapper sets `OLLAMA_HOST`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN=ollama` unless already set, and `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`. Claude CLI compatibility can vary by version, so this is isolated in one wrapper.

## Local Skill Execution

Use `run-local` when Claude Code, Codex, or a repo skill should run on the Mac but spend tokens on the Ubuntu Ollama hardware. The wrapper opens a temporary tunnel, verifies the selected endpoint and model, sets `OLLAMA_HOST`/`OLLAMA_MODEL`, runs the command, and closes the tunnel:

```bash
./bin/remote-ollama-mac run-local \
  --profile dual \
  --model qwen3-coder:30b \
  --route external \
  --external-host <wan-hostname-or-ip> \
  -- node ~/.claude/skills/local-test-gen/scripts/main.mjs --model qwen3-coder:30b --dry-run
```

On the same local network as the host, use `--route internal` instead and drop `--external-host`; the internal route resolves from `LLM_INTERNAL_HOST`.

For a persistent shell environment, source `use-remote-ollama`, then run tools that honor `OLLAMA_HOST`:

```bash
source ./scripts/use-remote-ollama dual external qwen3-coder:30b
node ~/.claude/skills/local-test-gen/scripts/main.mjs --model "$OLLAMA_MODEL"
```

## Local Mac Ollama (Offline / Low Bandwidth)

Use `--local` to run constrained coding work against the MacBook's **own** Ollama service instead of the Ubuntu GPU box. This is the mode for working offline, on a metered/low-bandwidth link, or with the lid closing on travel where the SSH tunnel to `darren-llm` is unavailable or too slow. It keeps the same ergonomics as the remote route.

`--local` is supported for `claude`, `run-local`, and `print-env`:

```bash
./bin/remote-ollama-mac claude --local --model qwen3.5:9b
./bin/remote-ollama-mac run-local --local --model qwen3.5:9b -- node ~/.claude/skills/local-test-gen/scripts/main.mjs --dry-run
./bin/remote-ollama-mac print-env --local --model qwen3.5:9b
```

What local mode does:

- Resolves the endpoint from `LLM_LOCAL_OLLAMA_HOST` (default `http://127.0.0.1:11434`) — no profile, route, or WAN host is consulted.
- Bypasses SSH tunnels, remote profile status/lifecycle calls, and remote telemetry entirely.
- Before a non-dry-run `claude`/`run-local`, verifies the local endpoint (`GET /api/version`) and the selected model (`POST /api/show`) using the same Ollama-compatible checks as the remote path. If Ollama isn't running you get a clear error pointing at `ollama serve` / `LLM_LOCAL_OLLAMA_HOST`.
- Passes the standard client environment to the launched tool: `OLLAMA_HOST`, `OLLAMA_MODEL`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` (defaults to `ollama`), and `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`.

Point it at a non-default local endpoint (e.g. a second Ollama on another port) with the env var:

```bash
LLM_LOCAL_OLLAMA_HOST=http://127.0.0.1:11435 ./bin/remote-ollama-mac claude --local --model qwen3.5:9b
```

Local mode rejects remote-only flags rather than silently ignoring them. `--profile`, `--route`, `--tunnel`, `--direct`, `--external-host`, and `--local-port` all error when combined with `--local`, because none of them apply when the endpoint comes from `LLM_LOCAL_OLLAMA_HOST`.

### Model recommendation for the Mac

The MacBook has far less VRAM/unified memory headroom than the dual-GPU Ubuntu box, so keep local models small:

- **Default: a code-specialized ~7B model** (e.g. `qwen2.5-coder:7b`). Fastest generation of the local set (~27 tok/s measured on this Mac) and emits code directly, so it fits tight `num_predict` budgets. This is the everyday local coding model — it stays responsive and leaves memory for the editor and browser.
- **Occasional: a ~14B coder** (e.g. `qwen2.5-coder:14b`) for a harder one-off task when you can spare the memory and tolerate slower tokens (~14 tok/s).
- **Reasoning ~9B models (e.g. `qwen3.5:9b`) need a large token budget.** They stream their answer through a separate reasoning/`thinking` channel, so under a small `num_predict` cap they can burn the whole budget thinking and return an *empty* completion. If you use one, raise `num_predict` substantially; for constrained/offline coding a `qwen2.5-coder` model is the safer default.
- **Avoid ~33B models during normal development** (e.g. `deepseek-coder:33b`, ~6–7 tok/s here — 2–4× slower). They fit only by heavy swapping/offload on the Mac and will stall interactive work. Save 30B+ for the remote `dual` profile.

This mirrors the local-test-gen harness, which already defaults to `localhost:11434`; `--local` reuses that same service and default port.

## Remote Command Execution

Use `exec` when a local harness workflow needs a command to run on the Ubuntu machine:

```bash
./bin/remote-ollama-mac exec -- pwd
./bin/remote-ollama-mac exec -- git status --short
./bin/remote-ollama-mac exec -- pnpm test
```

Commands run over SSH on port `2222`, with the working directory set to `LLM_REMOTE_PROJECT_DIR` when it exists.

## Benchmarks

Results are written locally under `results/<timestamp>-<scenario>/` as `runs.jsonl`, `summary.md`, and raw prompt/response files.

```bash
./bin/remote-ollama-mac benchmark \
  --profile primary \
  --model qwen2.5-coder:14b \
  --context 8192 \
  --num-predict 4096 \
  --scenario vitest-generation

./bin/remote-ollama-mac benchmark-matrix \
  --profiles primary,secondary,dual \
  --models qwen2.5-coder:14b,qwen2.5-coder:7b,qwen3-coder:30b \
  --contexts 4096,8192,16384,32768 \
  --scenario vitest-generation
```

Use the hardware benchmark when you want standard settings for the installed
model catalog. It reads `config/models.json`, runs 30B models only on `dual`,
runs smaller models on both single-card profiles, starts each profile/model in
isolation, resets a running profile with `restart` before testing a model, and
writes recommendation tables that prioritize rubric score over runtime:

```bash
./bin/remote-ollama-mac benchmark-hardware \
  --route internal
```

Useful narrower overnight runs:

```bash
./bin/remote-ollama-mac benchmark-hardware \
  --route internal \
  --contexts 8192,16384,32768,65536 \
  --efforts high,max,overnight

./bin/remote-ollama-mac benchmark-hardware \
  --route internal \
  --models qwen3-coder:30b,qwen2.5-coder:14b \
  --scenarios vitest-generation,tool-use-structured-output
```

Add future Ollama models by adding entries to `config/models.json` with their
eligible `profiles`. The benchmark defaults live in the top-level `benchmark`
section: `defaultScenarios`, `defaultContexts`, and `defaultEfforts`. Use
`--no-reset` only when you intentionally want the command to fail instead of
restarting an already-running profile.

```bash
./bin/remote-ollama-mac benchmark \
  --profile dual \
  --model GLM-4.7-Flash:latest \
  --context 32768 \
  --num-predict 4096 \
  --scenario vitest-generation
```

Each run records endpoint, profile, model, context, `num_predict`, wall time, Ollama timing fields, prompt size, response size, early-stop detection, valid code block detection, rubric score, and telemetry before/after: `rocm-smi`, `ollama ps`, `ss -tulnp`, and `systemctl status` where available.

## Content-Gen Benchmark

Compare how well the primary single-card profile and the two-card dual profile handle the current 100 agent-kernel MCP scenarios. The secondary card is not benchmarked alone; it participates only through the dual profile. Each run sends the scenario prompt to the remote Ollama node via `/v1/chat/completions` with the `ak_create` tool, extracts the generated tool call, runs `ak.mjs create` locally with those arguments, and scores the result against the reference expectations.

The benchmark questions are versioned under `benchmarks/content-gen/` as four reviewed tier catalogs with 25 simple, 25 affinity, 25 complex, and 25 constrained scenarios. `loadScenarioCatalog()` validates the complete 1–100 id range and returns a canonical SHA-256, so a scenario-set change is visible in Git and has a stable identity. Canonical payloads use `$RUN_OUTPUT/create` rather than a machine-specific output path.

Scoring reads compact entity-count, affinity, and spend expectations from each catalog entry. Room
affinity is deliberately excluded: rooms are containers, while hazards carry the affinity that can
give a room a descriptive theme. `scoreRun` retains its legacy `spec.json` and
`budget-receipt.json` inputs as a tested compatibility fallback, but `run-content-gen` has no runtime
dependency on the vault.

```bash
# Dry-run: plan the complete model × GPU-profile qualification matrix without network access
./bin/remote-ollama-mac dry-run run-content-gen

# Run all 100 scenarios across eligible primary and dual configurations
./bin/remote-ollama-mac run-content-gen --route internal

# Run a subset of scenarios (e.g., simple tier only, IDs 1–9)
./bin/remote-ollama-mac run-content-gen --scenario-ids 1,2,3,4,5,6,7,8,9 --route internal

# Run 3 trials of each scenario on the dual profile only
./bin/remote-ollama-mac run-content-gen --profiles dual --runs 3 --route internal

# Use a specific model override (otherwise uses each profile's default)
./bin/remote-ollama-mac run-content-gen --profiles dual --model qwen3-coder:30b-a3b-q4_K_M --runs 2
```

The default dry-run is the M3a planning contract. It reads the seven Git-owned model definitions and
three service profiles, emits seven eligible configurations (four single-card candidates on primary
and three 27B/30B candidates on dual), and reports a stable matrix hash plus the declared resource
order. The secondary card is reserved for dual and has no standalone benchmark configuration. One
complete pass is 700 calls; three qualifying passes are at most 2,100 calls. `--profiles`, `--model`,
`--context`, `--num-predict`, `--runs`, and `--scenario-ids` narrow or override the offline plan.

Live `run-content-gen` now executes the eligible configurations in declared resource order. It runs
one complete pass, continues up to three while qualification remains mathematically possible, and
keeps expected budget denial separate from raw process success.

### Collapse breaker

A full matrix is 700–2,100 calls and can take a day of GPU time, so the run aborts early when the
evidence says the **rig** is broken. It deliberately does not abort when a model is merely weak:
"this model scores badly" is the finding the run exists to record, and aborting on it would destroy
the evidence rather than protect it. Two floors separate the cases, evaluated per configuration and
only after `minimumAttempts` (20) — single-pass variance is wide enough that a handful of attempts
cannot tell collapse from noise.

| Floor | Default | Why |
|---|---:|---|
| `toolCallRate` | 0.10 | A weak model still *emits* tool calls. Near-zero means a broken tool schema, prompt, or endpoint. |
| `averageScore` | 25 | Far below the 75 qualification bar, because these models score in the 30s–40s against it normally. Traps collapse, not regression. |

`qwen3.5:9b` is the designated control in `config/models.json` and runs first, so a trip there is
reported as *suspect the harness, not the model* and spares the expensive 27–30B dual rows.

On a trip the run writes **no `result.json`** — its absence is already what marks an aborted run
unpublishable — plus a `collapse-abort.json` carrying `publication: false`, the trip detail, and the
run identity, and exits non-zero. The unattended agent spawns this CLI and already fails on a
non-zero child, so the nightly inherits the breaker without extra wiring.

Override with `--no-collapse-breaker`, `--collapse-score-floor N`, `--collapse-tool-call-floor RATIO`,
or `--collapse-min-attempts N`. The nightly service, which cannot pass flags, reads
`AK_BENCHMARK_COLLAPSE_BREAKER=0`, `AK_BENCHMARK_COLLAPSE_SCORE_FLOOR`,
`AK_BENCHMARK_COLLAPSE_TOOL_CALL_FLOOR`, and `AK_BENCHMARK_COLLAPSE_MIN_ATTEMPTS`; explicit flags win.
Turn it off for adversarial or diagnostic subsets, for the same reason `--no-early-stop` exists — a
subset chosen to fail must be allowed to fail.

Results are written to `results/<timestamp>-content-gen/`:
- `runs.jsonl` — one JSON line per run
- `result.json` — schema-versioned configuration, tier, qualification, Pareto, and minimum result
- `summary.md` — aggregate table by profile + per-run detail table
- `collapse-abort.json` — written **only** on a breaker trip; its presence means the run is not evidence
- `raw/<runId>/create/` — generated artifacts for each run

The Markdown aggregate retains the historical `Profile | Model | Scenarios | Runs | Avg score |
Tool call ok | Exec ok` projection. `result.json` adds scenario verdicts without rewriting raw
execution failures, so an expected budget rejection can qualify while remaining visible as exec-fail.

Scoring (100 pts per run):
| Component | Points | How |
|---|---:|---|
| Tool call produced | 20 | LLM called `ak_create` |
| Exec succeeded | 10 | `ak.mjs create` exited 0 |
| Entity types match | 20 | Same entity types as reference |
| Entity counts match | 20 | Same count-per-type as reference |
| Affinity match | 20 | Same primary affinity per type |
| Budget delta | 10 | Total spend within 80% of reference |

## Abstract Planning Benchmark

`run-abstract-plan` separates reasoning quality from game vocabulary. The model receives only a
domain-neutral component catalog, exact quantity/capacity/signal/budget constraints, and a
minimum-cost objective. It returns opaque component ids through `submit_abstract_build_plan`.
A hidden deterministic mapping then translates those ids into production `ak_create` arguments and
runs `ak.mjs create`.

The catalog is versioned under `benchmarks/abstract-plan/`. `pilot.json` is one hand-authored stress
case. `parallel.json` contains 100 generated cases aligned one-to-one with the content-generation
catalog; `tools/benchmark/generate-abstract-parallel.mjs --check` fails when it is stale. Every visible
problem contains no
room, hazard, actor, dungeon, or affinity terms. The hidden map puts environmental affinity on
hazards rather than rooms; room specs contain size and count only. Actors retain their own
affinities. Results keep three verdicts separate: abstract planning score, mapping success, and
program execution success.

```bash
# Inspect the visible problem and scenario-set identity without network access
./bin/remote-ollama-mac run-abstract-plan --dry-run

# Inspect the complete one-to-one abstract set
./bin/remote-ollama-mac run-abstract-plan --abstract-set parallel --dry-run

# Run the pilot on the primary single-GPU profile
./bin/remote-ollama-mac run-abstract-plan --profile primary --model qwen3.8:27b --route internal

# Run against an already-running dual profile without restarting it
./bin/remote-ollama-mac run-abstract-plan --profile dual --model qwen3.8:27b --route internal --no-start

# Compare two paired result directories by profile/model/scenario/repeat
node scripts/compare-abstract-content.js \
  --content-dir results/<timestamp>-content-gen \
  --abstract-dir results/<timestamp>-abstract-plan
```

Results are written to `results/<timestamp>-abstract-plan/` as `runs.jsonl`, `result.json`,
`summary.md`, and the mapped production artifacts under `raw/<runId>/create/`.
The comparator writes `comparison/comparison.json` and `comparison/summary.md` beneath the abstract
result directory. It refuses incomplete attempt pairs, stale source-catalog identities, and
profile/model/context/output mismatches. Domain semantic scores and abstract planning scores remain
separate native metrics; only end-to-end verdict, raw execution, and latency receive paired deltas.

## Smoke Test

From the Mac, run one prompt through an SSH tunnel and require GPU evidence:

```bash
./bin/remote-ollama-mac smoke-test \
  --profile primary \
  --model qwen2.5-coder:7b \
  --route internal \
  --local-port 21434 \
  --prompt "Write a short Vitest for an add function." \
  --require-gpu
```

The command opens a temporary SSH tunnel over port `2222`, sends the prompt to the selected remote Ollama profile, samples remote telemetry while the request is running, and writes a JSON report under `results/smoke-tests/`. Use `--direct` only when Ollama ports are intentionally reachable from the Mac without a tunnel.

## Diagnostics

For troubleshooting, collect one uploadable text file instead of running individual checks:

```bash
remote-ollama-diagnostics primary > ~/remote-ollama-diagnostics-primary.txt 2>&1
```

The optional first argument is the profile name: `primary`, `secondary`, or `dual`. The report includes profile status, ports, Ollama processes and environment, ROCm device state, logs, API inventory, and a short telemetry sample during one request.

## Project Git Workflow

Starting Ollama never requires a project checkout or GitHub auth. Project operations are explicit:

```bash
./bin/remote-ollama-mac project-safety-check
./bin/remote-ollama-mac project-sync --branch main
./bin/remote-ollama-mac project-push-main --branch main
```

`remote-project-safety-check` validates the repo, snapshots dirty work, can `git pull --ff-only origin main`, and can push `HEAD:main`. The Ubuntu host must have normal git/SSH credentials configured if it needs to pull or push. No PATs or Copilot tokens are stored here.

## Security Notes

The old `remote-claude-start` contained an unreachable GitHub/Copilot `Authorization` command after `exec`. Treat that credential as compromised and rotate/revoke it. The replacement shims contain no embedded secrets.

Keep `config/llm-host.env` uncommitted. Prefer SSH keys and normal git remotes over tokens. Do not bind Ollama to `0.0.0.0` unless firewall rules limit access to the Mac/VPN.

## Firewall Restore

**UFW runs on the LLM host itself, not on the router or the client** — it is the host's own firewall that decides which sources may reach SSH and the Ollama ports. The script enforces this: it exits unless run on Linux as root. Run it while logged into the host.

If UFW rules are reset, restore a conservative firewall from the Ubuntu host:

```bash
ssh llm-lan            # or llm-vpn from off the LAN
cd ~/remote-ollama-control
cp config/ufw.env.example config/ufw.env
nano config/ufw.env
sudo ./scripts/ufw-remote-ollama.sh
```

The script resets UFW, denies inbound by default, allows outbound, keeps SSH on `2222`, and opens Ollama ports `11434-11436` only to `UFW_OLLAMA_SOURCES`. Do not set `UFW_OLLAMA_SOURCES` to `0.0.0.0/0`.

⚠️ **`UFW_SSH_SOURCES` must list every source you need to keep.** The script begins with `ufw --force reset`, so any source the env file omits is revoked the moment it runs. Dropping a remote source leaves the local network working perfectly while killing every external connection — a failure you will not notice until you are away and can no longer connect in to fix it. The script ships no defaults: if `config/ufw.env` is missing or a required value is empty, it errors instead of applying a policy you did not choose.

Run it over the local network when you can. Applying it remotely means resetting the firewall through the very rule carrying your session.

## Troubleshooting

- Port already in use: stop the existing profile or the default `ollama.service`; the manager refuses to kill unrelated processes.
- `STATE=unmanaged`: something is already listening on that profile's port, usually the default `ollama.service` on `11434`. Stop or disable it before starting the managed profile, or choose a different profile port.
- Ollama not listening: run `logs --profile NAME` and `telemetry --profile NAME`.
- SSH key failure: verify `LLM_SSH_KEY`, `LLM_SSH_PORT`, and `BatchMode` access. If the key has a passphrase, run `ssh-add --apple-use-keychain ~/.ssh/<key-name>` on the client first.
- Model not installed: run `ollama pull MODEL` on Ubuntu or start with a model that exists.
- Model does not fit in 12GB: use `dual` or a smaller quant/model.
- Only one GPU appears active: compare `rocm-smi` before/after snapshots and confirm `ROCR_VISIBLE_DEVICES`, `HIP_VISIBLE_DEVICES`, and `HSA_OVERRIDE_GFX_VERSION`.
- x4 GPU bottleneck: expect lower dual-profile throughput if the model moves data heavily across the secondary card.
