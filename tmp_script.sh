#!/usr/bin/env bash

REPO_PATH="/Users/darren/Documents/GitHub/agent-kernel"
OUTPUT_FILE="uploadable-files.txt"
STAGING_DIR="uploadable-staging"

cd "$REPO_PATH" || exit 1

# Directories to always exclude
EXCLUDE_DIRS=(
  "./.git"
  "./.playwright"
  "./tests"
  "./scripts"
  "./artifacts"
  "./local-codex"
  "./test-results"
  "./tools"
)

# Whitelisted file extensions
WHITELIST_EXT=(
  ".ts"
  ".js"
  ".json"
  ".md"
  ".yaml"
  ".yml"
)

is_excluded_dir() {
  local file="$1"
  for dir in "${EXCLUDE_DIRS[@]}"; do
    if [[ "$file" == $dir* ]]; then
      return 0
    fi
  done
  return 1
}

is_whitelisted() {
  local file="$1"
  for ext in "${WHITELIST_EXT[@]}"; do
    if [[ "$file" == *"$ext" ]]; then
      return 0
    fi
  done
  return 1
}

run_scan=true

# If output file exists, ask whether to reuse it
if [[ -f "$OUTPUT_FILE" ]]; then
  echo "$OUTPUT_FILE already exists."
  read -p "Do you want to re-run the scan? (y/n): " choice
  if [[ "$choice" != "y" ]]; then
    echo "Using existing $OUTPUT_FILE"
    run_scan=false
  fi
fi

if $run_scan; then
  # Ensure ignore files exist
  if [[ ! -f ".gitignore" ]]; then
    echo ".gitignore not found in repo root"
    exit 1
  fi

  if [[ -f ".cgcignore" ]]; then
    export GIT_CGC_IGNORE=$(mktemp)
    cat .cgcignore >> "$GIT_CGC_IGNORE"
    export GIT_IGNORE="$GIT_CGC_IGNORE"
  fi

  echo "Collecting uploadable files..."
  > "$OUTPUT_FILE"

  while IFS= read -r file; do
    [[ -d "$file" ]] && continue
    if is_excluded_dir "$file"; then continue; fi
    if ! is_whitelisted "$file"; then continue; fi
    if git check-ignore -q "$file"; then continue; fi
    echo "$file" >> "$OUTPUT_FILE"
  done < <(find . -type f)

  echo "Scan complete. File list written to $OUTPUT_FILE"
fi

# Stage 2: Build staging directory
echo "Preparing staging directory..."

if [[ -d "$STAGING_DIR" ]]; then
  read -p "Staging directory exists. Clear it? (y/n): " clear_choice
  if [[ "$clear_choice" == "y" ]]; then
    rm -rf "$STAGING_DIR"
  else
    echo "Using existing staging directory."
  fi
fi

mkdir -p "$STAGING_DIR"

echo "Copying files into staging directory..."
while IFS= read -r file; do
  dest="$STAGING_DIR/$file"
  mkdir -p "$(dirname "$dest")"
  cp "$file" "$dest"
done < "$OUTPUT_FILE"

echo "Files copied."
echo "Staging directory ready at: $STAGING_DIR"
echo "You can now upload the folder contents directly."
