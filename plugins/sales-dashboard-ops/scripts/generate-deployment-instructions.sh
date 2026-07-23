#!/usr/bin/env bash
set -euo pipefail

plugin_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
project_dir="${SALES_DASHBOARD_PROJECT_DIR:-$(cd "$plugin_dir/../.." && pwd)}"
deployment_file="$project_dir/DEPLOYMENT.md"

if [ ! -d "$project_dir" ]; then
  echo "Sales Dashboard project was not found at: $project_dir" >&2
  exit 1
fi

if [ -f "$deployment_file" ]; then
  echo "Deployment instructions already exist at: $deployment_file"
  exit 0
fi

cp "$plugin_dir/assets/DEPLOYMENT.md" "$deployment_file"
echo "Created deployment instructions at: $deployment_file"
