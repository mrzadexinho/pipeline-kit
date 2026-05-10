#!/bin/bash
set -e
echo "==> Installing deps"
bun install
echo "==> Running spike"
bun run spike.ts
