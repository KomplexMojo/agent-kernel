# Remote Ollama Control

This package makes the MacBook the control/client machine and the Ubuntu box the Ollama host.

- MacBook: runs Claude CLI, benchmarks, SSH control, and result collection.
- Ubuntu: runs one or more Ollama profile instances.
- Default architecture: `Mac Claude CLI -> selected remote Ollama endpoint`.
- Optional project workflow: Ubuntu can keep a git checkout synced, snapshot dirty work, pull from `origin/main`, and push `HEAD` back to `main` when explicitly invoked.

## Profiles

Profiles live at `tools/remote-ollama-control/config/llm-profiles.json` in the `agent-kernel` repo. From this tool directory, the relative path is `config/llm-profiles.json`.

| Profile | GPU visibility | Intended GPU | Port | Default model |
|---|---:|---|---:|---|
| `primary` | `0` | GPU 0 / x16 primary card | `11434` | `qwen2.5-coder:14b` |
| `secondary` | `1` | GPU 1 / x4 secondary card | `11435` | `qwen2.5-coder:7b` |
| `dual` | `0,1` | both GPUs for split/offloaded 30B models | `11436` | `qwen3-coder:30b` |

The remote manager sets `ROCR_VISIBLE_DEVICES`, `HIP_VISIBLE_DEVICES`, `HSA_OVERRIDE_GFX_VERSION`, and `OLLAMA_HOST` per profile. The default `HSA_OVERRIDE_GFX_VERSION=10.3.0` is included because RX 6700/6750 class `gfx1031` cards commonly need that compatibility override for Ollama ROCm offload.

## Setup

Run these commands from the tool directory on the Mac:

```bash
cd /Users/darren/Documents/GitHub/agent-kernel/tools/remote-ollama-control
cp config/llm-host.env.example config/llm-host.env
```

Edit `config/llm-host.env` for the Mac-side SSH settings. Keep `LLM_OLLAMA_BIND_HOST=127.0.0.1` for SSH-tunnel access. Use a LAN/VPN bind address only if the Ubuntu firewall limits access.

If `LLM_SSH_KEY` is passphrase-protected, load it into the Mac SSH agent before running remote commands:

```bash
ssh-add --apple-use-keychain ~/.ssh/ubuntu_llm_ed25519
ssh-add -l
ssh -p 2222 -i ~/.ssh/ubuntu_llm_ed25519 darren@192.168.1.143 'echo ok'
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
ssh -p 2222 -i ~/.ssh/ubuntu_llm_ed25519 darren@192.168.1.143
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

`--route internal` uses `192.168.1.143`. `--route external` uses `154.5.75.3`.

Safe bind default is `127.0.0.1`. In this mode, start an SSH tunnel before querying from the Mac:

```bash
./bin/remote-ollama-mac tunnel-command --profile primary --route internal
# Run the printed ssh command in a separate terminal.
export OLLAMA_HOST=http://127.0.0.1:11434
```

If the Mac already has local Ollama listening on `11434`, use a different local tunnel port:

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

./bin/remote-ollama-mac benchmark \
  --profile dual \
  --model GLM-4.7-Flash:latest \
  --context 32768 \
  --num-predict 4096 \
  --scenario vitest-generation
```

Each run records endpoint, profile, model, context, `num_predict`, wall time, Ollama timing fields, prompt size, response size, early-stop detection, valid code block detection, rubric score, and telemetry before/after: `rocm-smi`, `ollama ps`, `ss -tulnp`, and `systemctl status` where available.

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
