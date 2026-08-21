#!/usr/bin/env bash
# ufw-llm.sh — firewall policy for the agent-kernel LLM box (darren-LLM, 192.168.1.170)
#
# Use case (verified 2026-07-11):
#   - SSH (2222/tcp) reachable ONLY from the trusted LAN and from the private VPN exit.
#       * On the LAN: your Mac over WiFi or Ethernet (any 192.168.1.0/24 address).
#       * Remote: Mac on the private VPN -> egress 86.38.64.24 -> router port-forwards
#         2222 -> here. Port-forward preserves the source IP, so UFW is the real gate.
#   - Ollama (11434/11435/11436) is INTENTIONALLY NOT exposed. It binds 127.0.0.1 and is
#     reached through the SSH tunnel, so there is nothing to open. Never port-forward these.
#   - Everything else is denied by default.
#
# Run ON the box:   sudo bash ufw-llm.sh
# Re-runnable: it resets to a known-good state each time.
set -Eeuo pipefail

# ---------------------------- edit for your environment ----------------------------
SSH_PORT=2222
LAN_CIDR="192.168.1.0/24"     # trusted home LAN (covers the Mac's WiFi + Ethernet IPs)
VPN_SOURCE="86.38.64.24"      # your PRIVATE VPN exit IP (the source UFW sees after the port-forward)

# -----------------------------------------------------------------------------------

# --- safety guards -----------------------------------------------------------------
[ "$(uname -s)" = "Linux" ] || { echo "ERROR: run this on the Ubuntu box, not the Mac." >&2; exit 2; }
[ "$(id -u)" -eq 0 ]        || { echo "ERROR: run with sudo: sudo bash $0" >&2; exit 2; }
command -v ufw >/dev/null   || { echo "ERROR: ufw is not installed." >&2; exit 1; }
[ -n "$LAN_CIDR" ]   || { echo "ERROR: LAN_CIDR empty — refusing (would risk SSH lockout)." >&2; exit 1; }
[ -n "$VPN_SOURCE" ] || { echo "ERROR: VPN_SOURCE empty — refusing (would drop remote access)." >&2; exit 1; }
case "$VPN_SOURCE" in
  0.0.0.0/0|::/0|any) echo "ERROR: refusing to expose SSH to the whole internet." >&2; exit 1 ;;
esac

echo "Applying LLM-box firewall policy..."
echo "  SSH ${SSH_PORT}/tcp  <-  ${LAN_CIDR}  and  ${VPN_SOURCE}"
echo "  Ollama 11434-11436: not exposed (loopback + SSH tunnel)"

# Reset briefly disables the firewall (allow-all), so an in-flight SSH session survives;
# established connections are then kept alive by conntrack once re-enabled.
ufw --force reset
ufw default deny incoming
ufw default allow outgoing

# SSH — the only inbound service, scoped to LAN + private VPN exit.
ufw allow from "$LAN_CIDR"   to any port "$SSH_PORT" proto tcp comment 'llm ssh (LAN)'
ufw allow from "$VPN_SOURCE" to any port "$SSH_PORT" proto tcp comment 'llm ssh (private VPN)'

# To tighten the LAN rule to just this Mac instead of the whole /24, replace the LAN line
# above with one rule per reserved IP, e.g.:
#   ufw allow from 192.168.1.152 to any port 2222 proto tcp comment 'llm ssh (mac wifi)'
#   ufw allow from 192.168.1.164 to any port 2222 proto tcp comment 'llm ssh (mac eth)'
# (Reserve both on the router and disable the Mac's private WiFi MAC first, or the IPs drift.)

ufw --force enable
echo
ufw status verbose
