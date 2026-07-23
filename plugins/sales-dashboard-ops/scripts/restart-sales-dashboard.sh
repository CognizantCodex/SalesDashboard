#!/usr/bin/env bash
set -euo pipefail

plugin_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
project_dir="${SALES_DASHBOARD_PROJECT_DIR:-$(cd "$plugin_dir/../.." && pwd)}"
port="${FRONTEND_PORT:-8090}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed. Run: $project_dir/scripts/check-install-docker.sh" >&2
  exit 1
fi

if [ ! -f "$project_dir/docker-compose.yml" ]; then
  echo "Sales Dashboard project was not found at: $project_dir" >&2
  exit 1
fi

cd "$project_dir"
docker compose restart backend frontend
curl --fail --silent --show-error "http://127.0.0.1:$port/" >/dev/null
echo "Sales Dashboard backend and frontend were restarted."
