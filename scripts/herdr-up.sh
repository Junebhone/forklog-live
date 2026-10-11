#!/usr/bin/env bash
# Create (or focus) the ForkLog herdr workspace: agent / services / shell tabs.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="ForkLog"

existing=$(herdr workspace list | jq -r --arg l "$LABEL" '.result.workspaces[] | select(.label==$l) | .workspace_id' | head -1)
if [[ -n "$existing" ]]; then
  herdr workspace focus "$existing" >/dev/null
  echo "Focused existing workspace $existing"
  exit 0
fi

ws=$(herdr workspace create --cwd "$ROOT" --label "$LABEL" --no-focus)
ws_id=$(jq -r '.result.workspace.workspace_id' <<<"$ws")
first_tab=$(herdr tab list --workspace "$ws_id" | jq -r '.result.tabs[0].tab_id')
herdr tab rename "$first_tab" agent >/dev/null
agent_pane=$(herdr pane list --workspace "$ws_id" | jq -r '.result.panes[0].pane_id')
herdr pane rename "$agent_pane" claude >/dev/null
# fresh pane needs a moment before its shell prompt is ready
for _ in {1..10}; do
  herdr agent start claude --kind claude --pane "$agent_pane" >/dev/null 2>&1 && break
  sleep 1
done

# services: expo (top) + supabase functions (bottom)
svc=$(herdr tab create --workspace "$ws_id" --cwd "$ROOT" --label services --no-focus)
svc_tab=$(jq -r '.result.tab.tab_id' <<<"$svc")
expo_pane=$(herdr pane list --workspace "$ws_id" | jq -r --arg t "$svc_tab" '.result.panes[] | select(.tab_id==$t) | .pane_id' | head -1)
herdr pane rename "$expo_pane" expo >/dev/null
fn=$(herdr pane split "$expo_pane" --direction down --cwd "$ROOT" --no-focus)
fn_pane=$(jq -r '.result.pane.pane_id' <<<"$fn")
herdr pane rename "$fn_pane" functions >/dev/null

if [[ -f "$ROOT/package.json" ]]; then
  herdr pane run "$expo_pane" npx expo start >/dev/null
else
  herdr pane send-text "$expo_pane" "# no package.json yet — run: npx expo start" >/dev/null
fi
if command -v supabase >/dev/null; then
  herdr pane run "$fn_pane" supabase functions serve >/dev/null
else
  herdr pane send-text "$fn_pane" "# install supabase CLI (brew install supabase/tap/supabase), then: supabase functions serve" >/dev/null
fi

sh=$(herdr tab create --workspace "$ws_id" --cwd "$ROOT" --label shell --no-focus)

herdr workspace focus "$ws_id" >/dev/null
herdr tab focus "$first_tab" >/dev/null
echo "Created workspace $ws_id ($LABEL)"
