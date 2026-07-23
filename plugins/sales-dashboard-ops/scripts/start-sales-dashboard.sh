#!/usr/bin/env bash
set -euo pipefail

plugin_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
project_dir="${SALES_DASHBOARD_PROJECT_DIR:-$(cd "$plugin_dir/../.." && pwd)}"
port="8090"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --port) port="${2:?--port requires a port number}"; shift 2 ;;
    *) echo "Usage: $0 [--port PORT]" >&2; exit 2 ;;
  esac
done

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed. Run: $project_dir/scripts/check-install-docker.sh" >&2
  exit 1
fi

if [ ! -f "$project_dir/docker-compose.yml" ]; then
  echo "Sales Dashboard project was not found at: $project_dir" >&2
  echo "Set SALES_DASHBOARD_PROJECT_DIR to the project folder and try again." >&2
  exit 1
fi

cd "$project_dir"
FRONTEND_PORT="$port" docker compose up --build -d
curl --fail --silent --show-error "http://127.0.0.1:$port/" >/dev/null
echo "Sales Dashboard is running at http://localhost:$port"
