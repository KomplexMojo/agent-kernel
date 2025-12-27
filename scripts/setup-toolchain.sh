#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -d "packages/core-as/assembly" ]]; then
  echo "Expected packages/core-as/assembly. Run from the repo root."
  exit 1
fi

if [[ ! -d ".git" ]]; then
  git init
  git branch -M main >/dev/null 2>&1 || true
fi

if [[ ! -f ".gitignore" ]]; then
  cat > .gitignore <<'EOF'
# Node/tooling
node_modules/
.pnpm-store/
.pnp.*
npm-debug.log*
pnpm-debug.log*
yarn-debug.log*
yarn-error.log*

# Build outputs
build/
dist/
coverage/
*.wasm
*.wat
*.map

# Environment/OS
.DS_Store
.env
EOF
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js (LTS) is required. Install from https://nodejs.org/ or via nvm."
  exit 1
fi

if command -v pnpm >/dev/null 2>&1; then
  PM="pnpm"
else
  PM="npm"
fi

if [[ "$PM" == "pnpm" && ! -f "pnpm-workspace.yaml" ]]; then
  cat > pnpm-workspace.yaml <<'EOF'
packages:
  - "packages/*"
EOF
fi

if [[ ! -f "package.json" ]]; then
  if [[ "$PM" == "pnpm" ]]; then
    npm init -y
  else
    "$PM" init -y
  fi
fi

node - <<'NODE'
const fs = require("fs");
const path = "package.json";
const pkg = JSON.parse(fs.readFileSync(path, "utf8"));
pkg.name ||= "agent-kernel";
pkg.private = true;
pkg.workspaces ||= ["packages/*"];
pkg.scripts ||= {};
pkg.scripts["build:wasm"] ||= "mkdir -p build && asc packages/core-as/assembly/index.ts -o build/core-as.wasm -t build/core-as.wat --sourceMap --optimize && mkdir -p packages/ui-web/assets && cp build/core-as.wasm packages/ui-web/assets/core-as.wasm";
pkg.scripts["test"] ||= "node --test";
pkg.devDependencies ||= {};
pkg.devDependencies["assemblyscript"] ||= "^0.27.0";
fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n");
NODE

"$PM" install

echo "Toolchain ready. Try: $PM run build:wasm && $PM test"
