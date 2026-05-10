#!/bin/bash
set -e

SPIKE_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SPIKE_DIR"

echo "==> Cleaning previous run artifacts"
rm -f /tmp/spike-cat-i-result.json /tmp/spike-cat-i-retry-count.txt

echo "==> Installing deps"
bun install

echo "==> Starting Inngest Dev Server (background, port 8288)"
bunx inngest-cli@latest dev --no-discovery -u http://localhost:3123/api/inngest &
INNGEST_PID=$!
sleep 4

echo "==> Starting app server (background, port 3123)"
bun run serve.ts &
APP_PID=$!
sleep 2

echo "==> Syncing functions with Inngest dev server"
curl -s -X PUT http://localhost:3123/api/inngest || true
sleep 1

echo "==> Sending trigger event"
curl -s -X POST "http://localhost:8288/e/local" \
  -H "Content-Type: application/json" \
  -d '{"name": "pipeline/run.requested", "data": {"url": "https://example.com"}}' || true

echo "==> Waiting for execution (20s max — covers at least one retry)"
sleep 20

echo ""
echo "==> Checking result file"
if [ -f /tmp/spike-cat-i-result.json ]; then
  echo "RESULT FILE FOUND:"
  cat /tmp/spike-cat-i-result.json
else
  echo "NO RESULT FILE — pipeline did not complete (checking retry counter)"
fi

echo ""
echo "==> Retry counter"
if [ -f /tmp/spike-cat-i-retry-count.txt ]; then
  echo "Retry invocation count: $(cat /tmp/spike-cat-i-retry-count.txt)"
else
  echo "NO RETRY COUNTER — process step never ran"
fi

echo ""
echo "==> Cleanup"
kill $APP_PID $INNGEST_PID 2>/dev/null || true
echo "Done."
