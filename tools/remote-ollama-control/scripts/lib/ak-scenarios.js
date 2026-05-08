'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const VAULT_INDEX_RPATH = 'Sample Calls to agent-kernel MCP and Results/Index.md';
const DEFAULT_VAULT_DIR = path.join(os.homedir(), 'Documents', 'Obsidian', 'agent-kernel-vault');

function resolveVaultDir(env) {
  return (env && env.LLM_AK_VAULT_DIR) || DEFAULT_VAULT_DIR;
}

function parseIndexTable(text) {
  const rows = [];
  let headerSeen = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith('|')) {
      continue;
    }
    // Separator row: only dashes, pipes, and spaces
    if (/^\|[\s\-|:]+\|$/.test(line)) {
      continue;
    }
    const cells = line.slice(1, -1).split('|').map((c) => c.trim());
    if (cells.length < 8) {
      continue;
    }
    // Header row: first cell is '#'
    if (cells[0] === '#') {
      headerSeen = true;
      continue;
    }
    if (!headerSeen) {
      continue;
    }
    const indexNum = parseInt(cells[0], 10);
    if (!Number.isFinite(indexNum) || indexNum <= 0) {
      continue;
    }
    rows.push({
      index: indexNum,
      title: cells[1],
      notePath: cells[2],
      runId: cells[3],
      referenceSpend: parseInt(cells[4], 10) || 0,
      remaining: parseInt(cells[5], 10) || 0,
      status: cells[6],
      artifactDir: cells[7]
    });
  }
  return rows;
}

function extractPrompt(text) {
  const match = text.match(/^Prompt:\s*(.+?)(?:\r?\n|$)/m);
  return match ? match[1].trim() : '';
}

function extractMcpPayload(text) {
  const sectionMatch = text.match(/##\s+MCP Payload\s*\r?\n+```json\s*([\s\S]*?)```/i);
  if (!sectionMatch) {
    return null;
  }
  try {
    return JSON.parse(sectionMatch[1].trim());
  } catch {
    return null;
  }
}

function scenarioTier(index) {
  if (index <= 9) return 'simple';
  if (index <= 30) return 'affinity';
  return 'complex';
}

// Per-scenario budget caps. Simple scenarios (1-9) use the 1500-token default.
// Affinity scenarios scale to 5000; complex multi-room and full-dungeon scenarios
// reach up to 10000, giving the kernel room to produce richer content.
const SCENARIO_BUDGETS = {
  // Simple tier — single/multi-entity scenarios where rich specs exceed 1500
  1: 2000, 6: 2500, 7: 2000, 9: 2000,
  //  # Affinity tier — single-element rooms and small encounters
  10: 2000, 11: 2000, 12: 2000, 13: 2000, 14: 2500,
  15: 2000, 16: 2000, 17: 2000, 18: 2000, 19: 2500,
  // Affinity tier — multi-actor and opposed-affinity rooms
  20: 3000, 21: 5000, 22: 5000, 23: 5000,
  24: 2500, 25: 2000, 26: 3000,
  27: 3000, 28: 3500, 29: 3000, 30: 3000,
  // Complex tier — focused actor / trap / hazard tests
  31: 3500, 32: 3500, 33: 3500, 34: 3500,
  35: 5000, 36: 3500, 37: 3500, 38: 5000,
  39: 3500, 40: 3500, 41: 3500, 42: 3500,
  // Complex tier — multi-room and large dungeons
  43: 7500, 44: 7500, 45: 7500,
  46: 7500, 47: 7500,
  48: 10000, 49: 10000, 50: 10000,
};
const DEFAULT_BUDGET = 1500;

function scenarioBudget(index) {
  return SCENARIO_BUDGETS[index] ?? DEFAULT_BUDGET;
}

function loadScenarios(vaultDir) {
  const indexPath = path.join(vaultDir, VAULT_INDEX_RPATH);
  if (!fs.existsSync(indexPath)) {
    throw new Error(
      `Vault index not found: ${indexPath}. ` +
      `Set LLM_AK_VAULT_DIR in config/llm-host.env or ensure the vault is at the default location.`
    );
  }
  const indexText = fs.readFileSync(indexPath, 'utf8');
  const rows = parseIndexTable(indexText);
  const scenarios = [];
  for (const row of rows) {
    if (!fs.existsSync(row.notePath)) {
      process.stderr.write(`Warning: scenario note not found: ${row.notePath}\n`);
      continue;
    }
    const noteText = fs.readFileSync(row.notePath, 'utf8');
    const prompt = extractPrompt(noteText);
    const payload = extractMcpPayload(noteText);
    scenarios.push({
      ...row,
      tier: scenarioTier(row.index),
      budget: scenarioBudget(row.index),
      prompt,
      payload
    });
  }
  return scenarios;
}

module.exports = {
  DEFAULT_BUDGET,
  DEFAULT_VAULT_DIR,
  loadScenarios,
  resolveVaultDir,
  scenarioBudget,
};
