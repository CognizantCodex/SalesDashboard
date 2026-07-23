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

## React call

Post the workbook as `multipart/form-data`:

```js
const formData = new FormData();
formData.append('workbook', file);
formData.append('slsName', 'Saxena, Gaurav');

const response = await fetch('http://127.0.0.1:3001/api/forecast/analyze', {
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
