---
name: sales-dashboard-operations
description: Run, maintain, test, deploy, and document the Sales Dashboard, including the BCM and INS 2 Demand Creation dashboard. Use when the user asks to start or restart the dashboard, run it on port 8090, test it, diagnose service availability, validate Demand Creation uploads, or create deployment instructions.
---

# Sales Dashboard Operations

The plugin provides these Codex commands:

| User request | Script |
| --- | --- |
| Start Sales Dashboard | `scripts/start-sales-dashboard.sh` |
| Run on port 8090 | `scripts/start-sales-dashboard.sh --port 8090` |
| Restart backend and frontend | `scripts/restart-sales-dashboard.sh` |
| Generate deployment instructions | `scripts/generate-deployment-instructions.sh` |
| Validate Demand Creation | Upload a workbook with `BCM` and `INS2` sheets, then verify the saved data after a page reload |

## Operating Rules

- Use Docker Compose for team use. It exposes the frontend on the selected port and retains uploaded data in the `sales-dashboard-data` Docker volume.
- The dashboard project directory defaults to the environment variable `SALES_DASHBOARD_PROJECT_DIR`, then the plugin repository root. The scripts accept an explicit project directory through that variable when the plugin is installed separately.
- Before starting or restarting, check that Docker is available. If it is unavailable, direct the user to `scripts/check-install-docker.sh` in the project.
- Start with `docker compose up --build -d`; default to port `8090` and honor `--port` when specified.
- Verify startup using `curl -fsS http://127.0.0.1:<port>/` and report the dashboard link.
- Restart services with `docker compose restart backend frontend`, then run the health check.
- For a shared team dashboard, deploy Docker on an internal server or VM and share `http://<server-ip-or-hostname>:8090`. Confirm firewall and VPN access to the host and port.
- Do not run `docker compose down -v` unless the user explicitly confirms removal of all uploaded dashboard data.

## Testing

Run backend tests with `python3 -m pytest tests/test_main_api.py` and the frontend production check with `npm run build` from the project root.

## Demand Creation Validation

- Upload a `.xlsx`, `.xlsm`, or `.xlsb` workbook containing `BCM` and `INS2` sheets.
- Confirm the weekly line chart has BCM and INS 2 points, and hover each point to view its demand count.
- Confirm the Demand Profile and Top 10 Accounts tables render from the combined sheet data.
- Reload the page and verify that the latest uploaded workbook result remains available.

## Deployment Documentation

Generate `DEPLOYMENT.md` in the project root. Include prerequisites, Docker installation, startup commands, network sharing guidance, data persistence, health checks, restart/update procedures, and troubleshooting.
