from __future__ import annotations

import asyncio
import re

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse

from .database import load_revenue_forecast, load_revenue_forecast_metadata, replace_revenue_forecast
from .forecast_agent import analyze_forecast_rows, parse_workbook, result_to_csv


app = FastAPI(title="SLS Forecast Agent", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str | bool]:
    return {"ok": True, "agent": "sls-forecast-agent", "backend": "python"}


@app.get("/api/forecast/current/metadata")
async def current_forecast_metadata() -> dict:
    metadata = await asyncio.to_thread(load_revenue_forecast_metadata)
    return {"available": metadata["available"], "database": metadata}


@app.get("/api/forecast/current")
async def current_forecast(slsName: str = Query("Saxena, Gaurav")) -> dict:
    try:
        headers, rows, source_filename = await asyncio.to_thread(load_revenue_forecast)
        if not rows:
            return {"available": False, "database": {"table": "revenue_forecast", "rowsSaved": 0}}

        col_map = {header: index for index, header in enumerate(headers) if header}
        result = await asyncio.to_thread(analyze_forecast_rows, rows, col_map, slsName)
        result["available"] = True
        result["database"] = {
            "table": "revenue_forecast",
            "rowsSaved": len(rows),
            "sourceFilename": source_filename,
        }
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/forecast/analyze")
async def analyze_forecast(
    workbook: UploadFile = File(...),
    slsName: str = Form(...),
    sheetName: str = Form("Data"),
) -> dict:
    try:
        file_bytes = await workbook.read()
        headers, rows, col_map = parse_workbook(file_bytes, workbook.filename or "", sheetName)
        saved_rows, result = await _store_and_analyze(headers, rows, col_map, workbook.filename or "", slsName)
        result["available"] = True
        result["database"] = {"table": "revenue_forecast", "rowsSaved": saved_rows, "sourceFilename": workbook.filename or ""}
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/forecast/export.csv", response_class=PlainTextResponse)
async def export_forecast_csv(
    workbook: UploadFile = File(...),
    slsName: str = Form(...),
    sheetName: str = Form("Data"),
) -> PlainTextResponse:
    try:
        file_bytes = await workbook.read()
        headers, rows, col_map = parse_workbook(file_bytes, workbook.filename or "", sheetName)
        _saved_rows, result = await _store_and_analyze(headers, rows, col_map, workbook.filename or "", slsName)
        safe_name = re.sub(r"[^a-zA-Z0-9_-]+", "_", slsName or "SLS")
        return PlainTextResponse(
            result_to_csv(result),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{safe_name}_Forecast_2026.csv"'},
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


async def _store_and_analyze(
    headers: list[str],
    rows: list[list],
    col_map: dict[str, int],
    filename: str,
    sls_name: str,
) -> tuple[int, dict]:
    save_task = asyncio.to_thread(replace_revenue_forecast, headers, rows, filename)
    analyze_task = asyncio.to_thread(analyze_forecast_rows, rows, col_map, sls_name)
    saved_rows, result = await asyncio.gather(save_task, analyze_task)
    return saved_rows, result
