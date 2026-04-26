from __future__ import annotations

import asyncio
import re

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse

from .database import (
    load_pipeline_upload,
    load_pipeline_upload_metadata,
    load_revenue_forecast,
    load_revenue_forecast_metadata,
    load_wins_lost_metadata,
    replace_pipeline_upload,
    replace_revenue_forecast,
    replace_wins_lost,
)
from .forecast_agent import analyze_forecast_rows, analyze_pipeline_rows, analyze_won_lost_rows, parse_workbook, result_to_csv


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



@app.get("/api/pipeline/upload/metadata")
async def pipeline_upload_metadata() -> dict:
    metadata = await asyncio.to_thread(load_pipeline_upload_metadata)
    return {"available": metadata["available"], "database": metadata}


@app.get("/api/wins-lost/upload/metadata")
async def wins_lost_upload_metadata() -> dict:
    metadata = await asyncio.to_thread(load_wins_lost_metadata)
    return {"available": metadata["available"], "database": metadata}


@app.get("/api/pipeline/summary/current")
async def current_pipeline_summary(
    slsName: str = Query(...),
    currentYear: int | None = Query(None),
) -> dict:
    try:
        headers, rows, source_filename = await asyncio.to_thread(load_pipeline_upload)
        if not rows:
            return {"available": False, "database": {"table": "pipeline_upload", "rowsSaved": 0}}

        col_map = {header: index for index, header in enumerate(headers) if header}
        result = await asyncio.to_thread(analyze_pipeline_rows, rows, col_map, slsName, currentYear)
        result["database"] = {
            "table": "pipeline_upload",
            "rowsSaved": len(rows),
            "sourceFilename": source_filename,
        }
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/won-lost/summary/current")
async def current_won_lost_summary(
    slsName: str = Query(...),
    currentYear: int | None = Query(None),
) -> dict:
    try:
        headers, rows, source_filename = await asyncio.to_thread(load_pipeline_upload)
        if not rows:
            return {"available": False, "database": {"table": "pipeline_upload", "rowsSaved": 0}}

        col_map = {header: index for index, header in enumerate(headers) if header}
        result = await asyncio.to_thread(analyze_won_lost_rows, rows, col_map, slsName, currentYear)
        result["database"] = {
            "table": "pipeline_upload",
            "rowsSaved": len(rows),
            "sourceFilename": source_filename,
            "sheet": "Wins",
        }
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/pipeline/upload")
async def upload_pipeline(
    workbook: UploadFile = File(...),
    sheetName: str = Form("Data"),
) -> dict:
    try:
        file_bytes = await workbook.read()
        headers, rows, _col_map = parse_workbook(file_bytes, workbook.filename or "", sheetName)
        rows_saved = await asyncio.to_thread(replace_pipeline_upload, headers, rows, workbook.filename or "")
        wins_lost_saved = 0
        try:
            wins_headers, wins_rows, _wins_col_map = parse_workbook(file_bytes, workbook.filename or "", "Wins")
            wins_lost_saved = await asyncio.to_thread(replace_wins_lost, wins_headers, wins_rows, workbook.filename or "")
        except ValueError:
            wins_lost_saved = 0
        return {
            "available": rows_saved > 0,
            "database": {
                "table": "pipeline_upload",
                "rowsSaved": rows_saved,
                "sourceFilename": workbook.filename or "",
                "winsLostTable": "wins_lost",
                "winsLostRowsSaved": wins_lost_saved,
            },
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

@app.post("/api/pipeline/summary")
async def pipeline_summary(
    workbook: UploadFile = File(...),
    slsName: str = Form(...),
    sheetName: str = Form("Data"),
    currentYear: int | None = Form(None),
) -> dict:
    try:
        file_bytes = await workbook.read()
        headers, rows, col_map = parse_workbook(file_bytes, workbook.filename or "", sheetName)
        result = await asyncio.to_thread(analyze_pipeline_rows, rows, col_map, slsName, currentYear)
        result["database"] = {"sheet": sheetName, "rowsScanned": len(rows), "sourceFilename": workbook.filename or ""}
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
