#!/usr/bin/env python3
"""Make Serena able to see `packages/runtime/src/build/` and `tests/runtime/build/`.

WHY THIS EXISTS
---------------
Serena's TypeScript adapter hardcodes a directory blocklist:

    # solidlsp/language_servers/typescript_language_server.py
    @override
    def is_ignored_dirname(self, dirname: str) -> bool:
        return super().is_ignored_dirname(dirname) or dirname in [
            "node_modules", "dist", "build",
        ]

`solidlsp/ls.py` tests EVERY directory component of a requested path against that
list and returns "ignored" BEFORE it ever consults `.gitignore`, `ignored_paths`,
or any project configuration. There is no config key that reaches it.

This repo keeps real domain source and tests in directories named `build`
(`packages/runtime/src/build/` — including the 1,664-line `orchestrate-build.js` —
and `tests/runtime/build/`), all of them tracked in git. The hardcoded rule
therefore hides 8 files / ~2,700 lines of live code from every structural query,
silently: `find_symbol` returns test-local import consts and never the definition.

WHY DROPPING `build`/`dist` IS SAFE
-----------------------------------
The blocklist is redundant with `.gitignore` for genuine build output — this repo
already ignores `dist/`, `/artifacts/` and the retired `*.wasm`/`*.wat` — and
Serena still applies `.gitignore` after this check. So removing these two entries
defers the decision to the project's own declaration, which is where it belongs.
`node_modules` is deliberately KEPT: it is the one entry whose cost is real
(traversal blow-up) regardless of ignore files.

USAGE
-----
    python3 scripts/setup/patch-serena-ignored-dirs.py          # apply
    python3 scripts/setup/patch-serena-ignored-dirs.py --check  # report only

Idempotent. **Re-run after every `uv tool upgrade serena-agent`** — an upgrade
replaces the file and silently restores the blind spot. `--check` exits 1 when the
patch is missing, so it can be wired into the session-start checklist.
"""

from __future__ import annotations

import argparse
import glob
import sys
from pathlib import Path

ORIGINAL = """        return super().is_ignored_dirname(dirname) or dirname in [
            "node_modules",
            "dist",
            "build",
        ]"""

PATCHED = """        # PATCHED by agent-kernel scripts/setup/patch-serena-ignored-dirs.py
        # `dist` and `build` removed: this repo keeps tracked source and tests in
        # directories named `build`, and .gitignore already covers real build output.
        return super().is_ignored_dirname(dirname) or dirname in [
            "node_modules",
        ]"""

MARKER = "PATCHED by agent-kernel"


def find_target() -> Path | None:
    patterns = [
        "/Users/*/.local/share/uv/tools/serena-agent/lib/python*/site-packages"
        "/solidlsp/language_servers/typescript_language_server.py",
        str(Path.home() / ".local/share/uv/tools/serena-agent/lib/python*/site-packages"
            "/solidlsp/language_servers/typescript_language_server.py"),
    ]
    for pattern in patterns:
        for hit in sorted(glob.glob(pattern)):
            return Path(hit)
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="report status without writing")
    args = parser.parse_args()

    target = find_target()
    if target is None:
        print("SKIP: Serena's typescript_language_server.py not found (serena-agent not installed?)")
        return 0 if not args.check else 1

    source = target.read_text()

    if MARKER in source:
        print(f"OK: already patched — {target}")
        return 0

    if ORIGINAL not in source:
        print(f"WARN: expected block not found in {target}")
        print("      Serena's source has changed. Re-check whether `is_ignored_dirname` still")
        print("      hardcodes 'build'; if upstream made it configurable, retire this script.")
        return 1

    if args.check:
        print(f"MISSING: patch not applied — {target}")
        print("         Serena cannot see packages/runtime/src/build/ or tests/runtime/build/.")
        print("         Fix: python3 scripts/setup/patch-serena-ignored-dirs.py")
        return 1

    target.write_text(source.replace(ORIGINAL, PATCHED, 1))
    print(f"PATCHED: {target}")
    print("         Restart the Serena MCP server for this to take effect.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
