# SalesDashboard

## SLS Forecast Agent

This converts `Forecast_Agent.html` into a Python backend agent that a React front end can call.

## Run the Python Backend

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 3001 --reload
```

The backend agent runs at:

```text
http://127.0.0.1:3001
```

## Run the React Frontend

Open a second terminal:

```bash
npm install
npm run dev
```

The frontend runs at:

```text
http://127.0.0.1:5174
```

## Docker Deployment

Docker runs the app as two containers:

- `backend`: FastAPI on port `3001` inside the Docker network
- `frontend`: Nginx serving the React production build on port `8090`

If Docker is not installed yet, run the helper script for your laptop.

macOS or Linux:

```bash
./scripts/check-install-docker.sh
```

Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\check-install-docker.ps1
```

From the project folder, run:

```bash
docker compose up --build
```

Open the app at:

```text
http://localhost:8090
```

Swagger is available through the same deployed frontend host:

```text
http://localhost:8090/docs
```

To run it in the background:

```bash
docker compose up --build -d
```

If port `8090` is already being used on the host, choose another port:

```bash
FRONTEND_PORT=8091 docker compose up --build -d
```

To stop it:

```bash
docker compose down
```

Uploaded workbook data is stored in the Docker volume `sales-dashboard-data`. `docker compose down` keeps that data. To remove uploaded data too, run:

```bash
docker compose down -v
```

To let other users access the app, deploy these containers on an internal VM/server or keep Docker running on your laptop and share:

```text
http://<your-laptop-or-server-ip>:8090
```

Your network/VPN and firewall must allow inbound access to port `8090`.

## React call

Post the workbook as `multipart/form-data`:

```js
const formData = new FormData();
formData.append('workbook', file);
formData.append('slsName', 'Saxena, Gaurav');

const response = await fetch('/api/forecast/analyze', {
  method: 'POST',
  body: formData
});

const forecast = await response.json();
```

## API

`POST /api/forecast/analyze`

Fields:

- `workbook`: `.xlsb`, `.xlsx`, or `.xlsm` file
- `slsName`: name to match in the `SLS` column
- `sheetName`: optional, defaults to `Data`

Returns JSON with:

- `metrics`: total forecast, target, gap, account count, labels
- `matchedSlsNames`: SLS name permutations found in the workbook
- `accounts`: grouped account and practice breakdown
- `rows`: flat rows suitable for tables or CSV export

`POST /api/forecast/export.csv`

Uses the same fields and returns a CSV download.
# Sales Dashboard

## Node.js API fallback

The Python/FastAPI backend remains the default API. A parallel Node.js fallback
is available for environments where Python cannot be installed. It uses a
separate SQLite database, so the two runtimes can run side by side safely.

```bash
npm install
npm run api:node
```

The Node server listens on `http://127.0.0.1:3002`. To direct the frontend to
it, start Vite with `VITE_API_BASE_URL=http://127.0.0.1:3002`.

Core revenue, pipeline, SLS, SLSM, SLSL, metadata, SLS breakdown, RA, and
Frontier Security & Defense opportunity upload APIs are available with the same
route names as the Python service.
