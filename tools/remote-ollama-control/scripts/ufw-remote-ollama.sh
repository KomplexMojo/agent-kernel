#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${1:-$ROOT_DIR/config/ufw.env}"

if [ "$(uname -s)" != "Linux" ]; then
  printf 'ERROR: ufw-remote-ollama.sh must be run on the Ubuntu LLM host.\n' >&2
  exit 2
fi

if [ "$(id -u)" -ne 0 ]; then
  printf 'ERROR: run with sudo: sudo %s\n' "$0" >&2
  exit 2
fi

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

UFW_SSH_PORT="${UFW_SSH_PORT:-2222}"
UFW_SSH_SOURCES="${UFW_SSH_SOURCES:-192.168.1.0/24}"
UFW_OLLAMA_PORTS="${UFW_OLLAMA_PORTS:-11434,11435,11436}"
UFW_OLLAMA_SOURCES="${UFW_OLLAMA_SOURCES:-192.168.1.0/24}"
UFW_EXTRA_TCP_RULES="${UFW_EXTRA_TCP_RULES:-}"
UFW_ALLOW_OUTGOING="${UFW_ALLOW_OUTGOING:-1}"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    printf 'ERROR: missing command: %s\n' "$1" >&2
    exit 1
  }
}

split_csv_or_space() {
  printf '%s\n' "$1" | tr ',' ' ' | xargs -n1 printf '%s\n' | sed '/^$/d'
}

allow_tcp_from_sources() {
  local label="$1"
  local port="$2"
  local sources="$3"

  for source in $(split_csv_or_space "$sources"); do
    printf 'Allowing %s tcp/%s from %s\n' "$label" "$port" "$source"
    ufw allow from "$source" to any port "$port" proto tcp comment "$label"
  done
}

require_cmd ufw

if [ -z "$UFW_SSH_SOURCES" ]; then
  printf 'ERROR: UFW_SSH_SOURCES is empty. Refusing to risk locking out SSH.\n' >&2
  exit 1
fi

if [ -z "$UFW_OLLAMA_SOURCES" ]; then
  printf 'ERROR: UFW_OLLAMA_SOURCES is empty. Refusing to expose Ollama implicitly.\n' >&2
  exit 1
fi

for source in $(split_csv_or_space "$UFW_OLLAMA_SOURCES"); do
  if [ "$source" = "0.0.0.0/0" ] || [ "$source" = "::/0" ] || [ "$source" = "any" ]; then
    printf 'ERROR: refusing to expose Ollama to %s. Use a trusted Mac/VPN CIDR.\n' "$source" >&2
    exit 1
  fi
done

printf 'Resetting UFW and applying remote Ollama rules.\n'
printf 'SSH port: %s from %s\n' "$UFW_SSH_PORT" "$UFW_SSH_SOURCES"
printf 'Ollama ports: %s from %s\n' "$UFW_OLLAMA_PORTS" "$UFW_OLLAMA_SOURCES"

ufw --force reset
ufw default deny incoming
if [ "$UFW_ALLOW_OUTGOING" = "1" ]; then
  ufw default allow outgoing
else
  ufw default deny outgoing
fi

allow_tcp_from_sources "remote-ollama ssh" "$UFW_SSH_PORT" "$UFW_SSH_SOURCES"

for port in $(split_csv_or_space "$UFW_OLLAMA_PORTS"); do
  allow_tcp_from_sources "remote-ollama api" "$port" "$UFW_OLLAMA_SOURCES"
done

for rule in $(split_csv_or_space "$UFW_EXTRA_TCP_RULES"); do
  port="${rule%%:*}"
  sources="${rule#*:}"
  if [ -z "$port" ] || [ -z "$sources" ] || [ "$port" = "$sources" ]; then
    printf 'ERROR: invalid UFW_EXTRA_TCP_RULES entry: %s\n' "$rule" >&2
    exit 1
  fi
  allow_tcp_from_sources "remote-ollama extra" "$port" "$sources"
done

ufw --force enable
ufw status verbose
