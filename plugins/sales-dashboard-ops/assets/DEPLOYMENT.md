# Sales Dashboard Deployment

## Prerequisites

- A laptop, internal server, or VM reachable by the intended users.
- Docker Desktop or Docker Engine with Docker Compose.
- Network, VPN, and firewall access to TCP port 8090 on the host.

## Start the Shared Dashboard

From the project folder run:

```bash
docker compose up --build -d
curl -f http://127.0.0.1:8090/
```

Open it locally at `http://localhost:8090`.

## Share with the Team

Give users the address `http://<server-ip-or-hostname>:8090`. The host must stay powered on with Docker running. Configure the corporate firewall and VPN for inbound access to port 8090 from the permitted network.

## Data Persistence

The `sales-dashboard-data` Docker volume retains uploaded workbooks. Normal restarts and `docker compose down` keep that data. `docker compose down -v` permanently removes it.

## Operations

```bash
docker compose restart backend frontend
docker compose logs -f backend frontend
docker compose up --build -d
```

If port 8090 is occupied, run `FRONTEND_PORT=8091 docker compose up --build -d` and use port 8091 in the team URL.
