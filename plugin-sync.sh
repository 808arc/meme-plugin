#!/usr/bin/env bash
npm run build

set -euo pipefail

path="$HOME/Library/Application Support/LearnHarness/data/plugins/meme"

echo "deleting $path"
rm -rf "$path"

echo "copying files to $path"
mkdir -p "$path"
rsync -a \
  --exclude 'plugin-sync.sh' \
  --exclude '.DS_Store' \
  --exclude '.*' \
  ./ "$path/"

echo "result:"
ls -a "$path/"