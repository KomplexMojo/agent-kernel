# Remote Ollama Control

This package makes the MacBook the control/client machine and the Ubuntu box the Ollama host.

- MacBook: runs Claude CLI, benchmarks, SSH control, and result collection.
- Ubuntu: runs one or more Ollama profile instances.
- Default architecture: `Mac Claude CLI -> selected remote Ollama endpoint`.
- Optional project workflow: Ubuntu can keep a git checkout synced, snapshot dirty work, pull from `origin/main`, and push `HEAD` back to `main` when explicitly invoked.

## Profiles

Profiles live at `tools/remote-ollama-control/config/llm-profiles.json` in the `agent-kernel` repo. From this tool directory, the relative path is `config/llm-profiles.json`.

| Profile | GPU visibility | Intended GPU | Port | Default model | Default context | Default num_predict |
|---|---:|---|---:|---|---:|---:|
| `primary` | `0` | GPU 0 / x16 primary card | `11434` | `qwen3:14b` | `32768` | `4096` |
| `secondary` | `1` | GPU 1 / x4 secondary card | `11435` | `qwen3:14b` | `8192` | `4096` |
| `dual` | `0,1` | both GPUs for split/offloaded 30B models | `11436` | `qwen3-coder:30b-a3b-q4_K_M` | `65536` | `32768` |

The remote manager sets `ROCR_VISIBLE_DEVICES`, `HIP_VISIBLE_DEVICES`, `HSA_OVERRIDE_GFX_VERSION`, and `OLLAMA_HOST` per profile. The default `HSA_OVERRIDE_GFX_VERSION=10.3.0` is included because RX 6700/6750 class `gfx1031` cards commonly need that compatibility override for Ollama ROCm offload.

## Setup

Run these commands from the tool directory on the Mac:

```bash
cd /Users/darren/Documents/GitHub/agent-kernel/tools/remote-ollama-control
cp config/llm-host.env.example config/llm-host.env
```

Edit `config/llm-host.env` for the Mac-side SSH settings. Keep `LLM_OLLAMA_BIND_HOST=127.0.0.1` for SSH-tunnel access. Use a LAN/VPN bind address only if the Ubuntu firewall limits access.

### SSH Host Aliases (Recommended)

The preferred connection method uses SSH host aliases defined in `~/.ssh/config`:

```
Host llm-lan
  HostName 192.168.1.143
  User darren
  Port 2222
  IdentityFile ~/.ssh/ubuntu_llm_ed25519
  IdentitiesOnly yes
  AddKeysToAgent yes
  UseKeychain yes

Host llm-vpn
  HostName 207.6.34.73
  User darren
  Port 2222
  IdentityFile ~/.ssh/ubuntu_llm_ed25519
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
ssh-add --apple-use-keychain ~/.ssh/ubuntu_llm_ed25519
ssh-add -l
ssh -p 2222 -i ~/.ssh/ubuntu_llm_ed25519 darren@207.6.34.73 'echo ok'
```

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

## Network Modes

`--route internal` uses `192.168.1.143` (LAN). `--route external` uses the configured `LLM_EXTERNAL_HOST` (default: `207.6.34.73`, the VPN/WAN address).

When `LLM_SSH_HOST_ALIAS` is set (e.g. `llm-vpn`), the route selection is handled by the SSH alias — the tooling uses the alias directly regardless of `--route`. This is the recommended setup.

When the WAN IP changes, either update `~/.ssh/config` (preferred) or override per command:

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
  --external-host <wan-host-or-ip> \
  -- node ~/.claude/skills/local-test-gen/scripts/main.mjs --model qwen3-coder:30b --dry-run
```

For a persistent shell environment, source `use-remote-ollama`, then run tools that honor `OLLAMA_HOST`:

```bash
source ./scripts/use-remote-ollama dual external qwen3-coder:30b
node ~/.claude/skills/local-test-gen/scripts/main.mjs --model "$OLLAMA_MODEL"
```

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

./bin/remote-ollama-mac benchmark \
  --profile dual \
  --model GLM-4.7-Flash:latest \
  --context 32768 \
  --num-predict 4096 \
  --scenario vitest-generation
```

Each run records endpoint, profile, model, context, `num_predict`, wall time, Ollama timing fields, prompt size, response size, early-stop detection, valid code block detection, rubric score, and telemetry before/after: `rocm-smi`, `ollama ps`, `ss -tulnp`, and `systemctl status` where available.

## Content-Gen Benchmark

Compare how well each Ubuntu GPU node (primary, secondary, dual) handles the 50 agent-kernel MCP scenarios. Each run sends the scenario prompt to the remote Ollama node via `/v1/chat/completions` with the `ak_create` tool, extracts the generated tool call, runs `ak.mjs create` locally with those arguments, and scores the result against the reference vault artifacts.

Scenarios are loaded from the vault at `LLM_AK_VAULT_DIR` (default: `~/Documents/Obsidian/agent-kernel-vault`). Set this in `config/llm-host.env` if the vault is in a non-default location.

```bash
# Dry-run: show what would run without opening tunnels
./bin/remote-ollama-mac dry-run run-content-gen

# Run all 50 scenarios × 3 profiles (primary, secondary, dual)
./bin/remote-ollama-mac run-content-gen --route internal

# Run a subset of scenarios (e.g., simple tier only, IDs 1–9)
./bin/remote-ollama-mac run-content-gen --scenario-ids 1,2,3,4,5,6,7,8,9 --route internal

# Run 3 trials of each scenario on the dual profile only
./bin/remote-ollama-mac run-content-gen --profiles dual --runs 3 --route internal

# Use a specific model override (otherwise uses each profile's default)
./bin/remote-ollama-mac run-content-gen --profiles dual --model qwen3-coder:30b-a3b-q4_K_M --runs 2
```

Results are written to `results/<timestamp>-content-gen/`:
- `runs.jsonl` — one JSON line per run
- `summary.md` — aggregate table by profile + per-run detail table
- `raw/<runId>/create/` — generated artifacts for each run

Scoring (100 pts per run):
| Component | Points | How |
|---|---:|---|
| Tool call produced | 20 | LLM called `ak_create` |
| Exec succeeded | 10 | `ak.mjs create` exited 0 |
| Entity types match | 20 | Same entity types as reference |
| Entity counts match | 20 | Same count-per-type as reference |
| Affinity match | 20 | Same primary affinity per type |
| Budget delta | 10 | Total spend within 80% of reference |

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

If UFW rules are reset, restore a conservative firewall from the Ubuntu host:

```bash
cd ~/remote-ollama-control
cp config/ufw.env.example config/ufw.env
nano config/ufw.env
sudo ./scripts/ufw-remote-ollama.sh
```

The script resets UFW, denies inbound by default, allows outbound, keeps SSH on `2222`, and opens Ollama ports `11434-11436` only to `UFW_OLLAMA_SOURCES`. Do not set `UFW_OLLAMA_SOURCES` to `0.0.0.0/0`.

## Troubleshooting

- Port already in use: stop the existing profile or the default `ollama.service`; the manager refuses to kill unrelated processes.
- `STATE=unmanaged`: something is already listening on that profile's port, usually the default `ollama.service` on `11434`. Stop or disable it before starting the managed profile, or choose a different profile port.
- Ollama not listening: run `logs --profile NAME` and `telemetry --profile NAME`.
- SSH key failure: verify `LLM_SSH_KEY`, port `2222`, and `BatchMode` access. If the key has a passphrase, run `ssh-add --apple-use-keychain ~/.ssh/ubuntu_llm_ed25519` on the Mac first.
- Model not installed: run `ollama pull MODEL` on Ubuntu or start with a model that exists.
- Model does not fit in 12GB: use `dual` or a smaller quant/model.
- Only one GPU appears active: compare `rocm-smi` before/after snapshots and confirm `ROCR_VISIBLE_DEVICES`, `HIP_VISIBLE_DEVICES`, and `HSA_OVERRIDE_GFX_VERSION`.
- x4 GPU bottleneck: expect lower dual-profile throughput if the model moves data heavily across the secondary card.
