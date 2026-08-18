#!/usr/bin/env python3
"""Regenerate graphify-out/graph.html from graphify-out/graph.json.

WHY THIS EXISTS
    `graphify update .` (and `graphify.watch._rebuild_code`, which it wraps)
    rewrites graph.json and GRAPH_REPORT.md and nothing else. `to_html` is called
    only from the full `/graphify` skill flow, so the interactive visualization
    silently drifts from the graph it claims to show — and because graph.html is
    gitignored, nothing ever surfaces the gap. It was three months stale when
    this script was written.

    Run it after every `graphify update .`:

        graphify update . && python3 scripts/setup/regenerate-graph-viz.py

WHY IT RE-EXECS
    graphify is installed under a specific interpreter, recorded by graphify
    itself in graphify-out/.graphify_python. On this machine `python3` resolves
    to Homebrew 3.14 while graphify lives under the 3.12 framework python, so
    importing it from whatever `python3` wins fails. Rather than hardcode a path
    into a checked-in script, we read the one graphify wrote down.
"""
from __future__ import annotations

import json
import os
import re
import sys
from collections import defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "graphify-out"
GRAPH_JSON = OUT / "graph.json"
GRAPH_HTML = OUT / "graph.html"
REPORT = OUT / "GRAPH_REPORT.md"
INTERPRETER_RECORD = OUT / ".graphify_python"


def _reexec_under_graphify_interpreter() -> None:
    """Re-run this script under the interpreter that actually has graphify."""
    if os.environ.get("_GRAPHIFY_VIZ_REEXEC") == "1":
        sys.exit(
            "graphify is not importable even under the recorded interpreter.\n"
            f"  recorded: {INTERPRETER_RECORD.read_text().strip() if INTERPRETER_RECORD.exists() else '(missing)'}\n"
            "  fix: reinstall graphify, or update graphify-out/.graphify_python"
        )
    if not INTERPRETER_RECORD.exists():
        sys.exit(
            f"graphify is not importable under {sys.executable}, and "
            f"{INTERPRETER_RECORD} does not exist to say which interpreter has it.\n"
            "  fix: run `graphify update .` once — it writes that file."
        )
    interpreter = INTERPRETER_RECORD.read_text().strip()
    if not interpreter or not Path(interpreter).exists():
        sys.exit(f"recorded interpreter is missing or unusable: {interpreter!r}")
    os.environ["_GRAPHIFY_VIZ_REEXEC"] = "1"
    os.execv(interpreter, [interpreter, str(Path(__file__).resolve()), *sys.argv[1:]])


try:
    import networkx as nx
    from graphify.export import MAX_NODES_FOR_VIZ, to_html
except ImportError:
    _reexec_under_graphify_interpreter()


def community_labels() -> dict[int, str]:
    """Names from GRAPH_REPORT.md, so the viz and the report agree.

    A code-only rebuild does not NAME communities — that needs the LLM pass of a
    full `/graphify` run — so these are usually the generic "Community N". Read
    anyway rather than invented here: whatever the report calls them is what a
    reader has open beside the graph.
    """
    if not REPORT.exists():
        return {}
    labels: dict[int, str] = {}
    for line in REPORT.read_text(errors="replace").splitlines():
        m = re.match(r"^- \*\*(.+?)\*\* \(`?Community (\d+)`?\)", line)
        if m:
            labels[int(m.group(2))] = m.group(1)
    return labels


def main() -> int:
    if not GRAPH_JSON.exists():
        sys.exit(f"{GRAPH_JSON} not found — run `graphify update .` first.")

    data = json.loads(GRAPH_JSON.read_text())
    graph = nx.node_link_graph(data, edges="links")

    node_count = graph.number_of_nodes()
    # The ceiling is READ from graphify, never restated here. A second copy of
    # the number would drift the moment graphify retunes it, and this script
    # would then either refuse a graph that is fine or attempt one that is not.
    if node_count > MAX_NODES_FOR_VIZ:
        print(
            f"SKIPPED: {node_count} nodes exceeds graphify's MAX_NODES_FOR_VIZ "
            f"({MAX_NODES_FOR_VIZ}). graph.json and GRAPH_REPORT.md are still "
            "current; only the HTML view is unavailable at this size."
        )
        # Deliberately exit 0. This runs chained after `graphify update .`, and a
        # graph too large to draw is not a failed rebuild.
        return 0

    communities: dict[int, list[str]] = defaultdict(list)
    for node_id, attrs in graph.nodes(data=True):
        communities[int(attrs.get("community", -1))].append(node_id)

    labels = community_labels()
    to_html(graph, dict(communities), str(GRAPH_HTML), community_labels=labels or None)

    headroom = MAX_NODES_FOR_VIZ - node_count
    print(
        f"graph.html regenerated — {node_count} nodes, {graph.number_of_edges()} edges, "
        f"{len(communities)} communities ({headroom} nodes of headroom before the viz ceiling)."
    )
    print(f"  open: {GRAPH_HTML}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
