from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.routing import APIRoute
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse

from .database import (
    load_demand_creation_upload,
    load_ra_upload,
    load_insurance_revenue_forecast_metadata,
    load_pending_validation_metadata,
    load_insurance_pipeline_upload_metadata,
    load_pipeline_upload,
    load_pipeline_upload_metadata,
    load_revenue_forecast,
    load_revenue_forecast_metadata,
    load_slsm_pending_validation,
    load_slsm_pending_validation_metadata,
    load_slsm_pipeline_upload,
    load_slsm_pipeline_upload_metadata,
    load_slsm_revenue_forecast,
    load_slsm_revenue_forecast_metadata,
    load_slsm_wins_lost,
    load_slsm_wins_lost_metadata,
    load_target_accounts,
    load_target_sls_summary,
    load_target_upload_metadata,
    load_wins_lost_metadata,
    replace_pending_validation,
    replace_demand_creation_upload,
    replace_ra_upload,
    replace_pipeline_upload,
    replace_insurance_pipeline_upload,
    replace_insurance_revenue_forecast,
    replace_revenue_forecast,
    replace_slsm_pending_validation,
    replace_slsm_pipeline_upload,
    replace_slsm_revenue_forecast,
    replace_slsm_wins_lost,
    replace_target_upload,
    replace_wins_lost,
)
from .forecast_agent import TARGETS_SHEET, SLSM_FORECAST_SHEET, _get_column, _matches_name_permutation, _to_number, analyze_forecast_rows, analyze_pending_validation_rows, analyze_pipeline_rows, analyze_won_lost_rows, normalize_slsm_forecast_rows, parse_demand_creation_workbook, parse_ra_workbook, parse_target_pivot, parse_workbook, result_to_csv, unique_person_values


OPENAPI_TAGS = [
    {"name": "Health", "description": "Service health checks."},
    {"name": "Forecast", "description": "SLS revenue forecast APIs."},
    {"name": "SLSM Forecast", "description": "SLSM revenue forecast and option APIs."},
    {"name": "SLSL Summary", "description": "SLSL dashboard rollup APIs."},
    {"name": "SLSM Breakdown", "description": "SLSM dashboard child SLS breakdown APIs."},
    {"name": "Pipeline", "description": "SLS pipeline upload and summary APIs."},
    {"name": "SLSM Pipeline", "description": "SLSM pipeline upload and summary APIs."},
    {"name": "Realized TCV", "description": "Won/lost and pending validation APIs."},
    {"name": "SLSM Realized TCV", "description": "SLSM won/lost and pending validation APIs."},
    {"name": "Targets", "description": "Target workbook upload and SLS account target APIs."},
    {"name": "Demand Creation", "description": "Weekly BCM and INS 2 demand creation reporting APIs."},
    {"name": "Reports", "description": "PowerPoint report generation APIs."},
]


app = FastAPI(
    title="SLS Forecast Agent",
    version="1.0.0",
    description="Swagger/OpenAPI documentation for the Sales Dashboard backend APIs.",
    openapi_tags=OPENAPI_TAGS,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


REPORT_EXPORT_DIR = Path(tempfile.gettempdir()) / "sales-dashboard-reports"


def _presentation_node() -> str:
    configured = os.environ.get("SALES_DASHBOARD_PRESENTATION_NODE")
    bundled = Path.home() / ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
    for candidate in (configured, str(bundled), shutil.which("node")):
        if candidate and Path(candidate).exists():
            return candidate
    raise RuntimeError("Node.js is required to create the PowerPoint report.")


def _create_report_presentation(demand: dict) -> Path:
    if not demand.get("available"):
        raise ValueError("Upload a Demand Creation workbook before generating a report.")

    REPORT_EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    report_id = uuid4().hex
    input_path = REPORT_EXPORT_DIR / f"{report_id}.json"
    output_path = REPORT_EXPORT_DIR / f"Sales_Dashboard_Report_{report_id}.pptx"
    input_path.write_text(json.dumps({"demand": demand}), encoding="utf-8")
    try:
        artifact_tool_root = Path.home() / ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool"
        command_env = os.environ.copy()
        command_env.setdefault("SALES_DASHBOARD_ARTIFACT_TOOL_ROOT", str(artifact_tool_root))
        completed = subprocess.run(
            [_presentation_node(), str(Path(__file__).with_name("report_presentation.mjs")), str(input_path), str(output_path)],
            capture_output=True,
            text=True,
            check=False,
            timeout=90,
            env=command_env,
        )
    finally:
        input_path.unlink(missing_ok=True)

    if completed.returncode != 0 or not output_path.exists():
        detail = (completed.stderr or completed.stdout or "Unable to create PowerPoint report.").strip()
        raise RuntimeError(detail)
    return output_path


def _money_label(value: float) -> str:
    return f"${value / 1_000_000:,.1f}M"


def _empty_money_labels(*keys: str) -> dict[str, str]:
    return {key: "$0.0M" for key in keys}


def _column_index(headers: list[str], *names: str) -> int | None:
    for name in names:
        if name in headers:
            return headers.index(name)
    return None


def _cell(row: list, index: int | None) -> object:
    if index is None or index >= len(row):
        return None
    return row[index]


def _person_index(headers: list[str], person_column: str) -> int | None:
    if person_column == "SLSM":
        return _column_index(headers, "SLSM", "SLSM Name", "SLS Manager")
    return _column_index(headers, person_column)


def _filter_rows_by_person(data_rows: list[list], headers: list[str], name: str, person_column: str) -> list[list]:
    person_index = _person_index(headers, person_column)
    if person_index is None:
        return []

    return [
        row
        for row in data_rows
        if _matches_name_permutation(_cell(row, person_index), name)
    ]


def _filter_rows_by_exact_person(data_rows: list[list], headers: list[str], name: str, person_column: str) -> list[list]:
    """Keep a breakdown row in one SLS bucket, including combined assignments."""
    person_index = _person_index(headers, person_column)
    if person_index is None:
        return []

    normalized_name = str(name or "").strip().casefold()
    return [
        row
        for row in data_rows
        if str(_cell(row, person_index) or "").strip().casefold() == normalized_name
    ]


def _unique_child_people(data_rows: list[list], headers: list[str], child_column: str) -> set[str]:
    child_index = _person_index(headers, child_column)
    if child_index is None:
        return set()

    return {
        str(_cell(row, child_index) or "").strip()
        for row in data_rows
        if str(_cell(row, child_index) or "").strip()
    }


def _unique_slsm_names(data_rows: list[list], headers: list[str]) -> set[str]:
    if not data_rows:
        return set()
    try:
        return set(unique_person_values(data_rows, {header: index for index, header in enumerate(headers) if header}, "SLSM"))
    except ValueError:
        return set()


def _revenue_rows_for_slsm(
    slsm_name: str,
    pivot_headers: list[str],
    pivot_rows: list[list],
    forecast_headers: list[str],
    forecast_rows: list[list],
) -> tuple[list[str], list[list], str]:
    """Use detailed revenue rows; the SLSM pivot is only a fallback source."""
    forecast_matches = _filter_rows_by_person(forecast_rows, forecast_headers, slsm_name, "SLSM")
    if forecast_matches:
        return forecast_headers, forecast_rows, "revenue_forecast"
    return pivot_headers, pivot_rows, "slsm_revenue_forecast"


@app.get("/health")
def health() -> dict[str, str | bool]:
    return {"ok": True, "agent": "sls-forecast-agent", "backend": "python"}


@app.get("/api/forecast/current/metadata")
async def current_forecast_metadata() -> dict:
    metadata = await asyncio.to_thread(load_revenue_forecast_metadata)
    insurance_metadata = await asyncio.to_thread(load_insurance_revenue_forecast_metadata)
    if insurance_metadata["available"]:
        metadata = {
            **metadata,
            "rowsSaved": metadata["rowsSaved"] + insurance_metadata["rowsSaved"],
            "sourceFilename": " + ".join(
                name for name in (metadata["sourceFilename"], insurance_metadata["sourceFilename"]) if name
            ),
            "insuranceRowsSaved": insurance_metadata["rowsSaved"],
        }
    return {"available": bool(metadata["available"] or insurance_metadata["available"]), "database": metadata}


@app.get("/api/forecast/insurance/upload/metadata")
async def insurance_forecast_upload_metadata() -> dict:
    metadata = await asyncio.to_thread(load_insurance_revenue_forecast_metadata)
    return {"available": metadata["available"], "database": metadata}


@app.get("/api/bcmi-orig/revenue-summary")
async def bcmi_orig_revenue_summary() -> dict:
    """Aggregate BCM and Insurance forecasted Net Revenue for BCMI - Orig."""
    headers, rows, source_filename = await asyncio.to_thread(load_revenue_forecast)
    if not rows:
        return {"available": False, "metrics": {}, "database": {"table": "revenue_forecast", "rowsSaved": 0}}

    col_map = {header: index for index, header in enumerate(headers) if header}
    period_columns = {
        "aug": _get_column(col_map, "Serviceline_Aug 2026", "Market_Aug 2026"),
        "q3": _get_column(col_map, "Q3'26 (SL)", "Q3 26 (SL)"),
        "q4": _get_column(col_map, "Q4'26 (SL)", "Q4 26 (SL)"),
        "year": _get_column(col_map, "FY 26 (SL)", "FY26 (SL)"),
    }
    missing = [label for label, index in period_columns.items() if index is None]
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing columns: {', '.join(missing)}")

    source_column = _get_column(col_map, "P&L Source", "PLSource")
    header_column = _get_column(col_map, "P&L Header", "PLHeader")
    totals = {period: 0.0 for period in period_columns}
    for row in rows:
        if source_column is not None:
            source = str(row[source_column] if source_column < len(row) else "").strip()
            if source != "IC/Forecasted":
                continue
        if header_column is not None:
            header = str(row[header_column] if header_column < len(row) else "").strip()
            if header != "Net Revenue":
                continue
        for period, index in period_columns.items():
            totals[period] += _to_number(row[index] if index is not None and index < len(row) else 0)

    return {
        "available": True,
        "metrics": totals,
        "database": {"table": "revenue_forecast", "rowsSaved": len(rows), "sourceFilename": source_filename},
    }


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


@app.get("/api/slsm/forecast/current/metadata")
async def current_slsm_forecast_metadata() -> dict:
    metadata = await asyncio.to_thread(load_slsm_revenue_forecast_metadata)
    if not metadata["available"]:
        metadata = await asyncio.to_thread(load_revenue_forecast_metadata)
        if metadata["available"]:
            metadata = {**metadata, "table": "revenue_forecast", "sharedFrom": "sls"}
    return {"available": metadata["available"], "database": metadata}


@app.get("/api/slsm/forecast/current")
async def current_slsm_forecast(slsmName: str = Query(...)) -> dict:
    try:
        pivot_headers, pivot_rows, pivot_source = await asyncio.to_thread(load_slsm_revenue_forecast)
        pivot_headers, pivot_rows = normalize_slsm_forecast_rows(pivot_headers, pivot_rows)
        forecast_headers, forecast_rows, forecast_source = await asyncio.to_thread(load_revenue_forecast)
        headers, rows, table_name = _revenue_rows_for_slsm(
            slsmName, pivot_headers, pivot_rows, forecast_headers, forecast_rows
        )
        source_filename = pivot_source if table_name == "slsm_revenue_forecast" else forecast_source
        if not rows:
            return {"available": False, "database": {"table": "slsm_revenue_forecast", "rowsSaved": 0}}

        col_map = {header: index for index, header in enumerate(headers) if header}
        result = await asyncio.to_thread(analyze_forecast_rows, rows, col_map, slsmName, "SLSM")
        result["available"] = True
        result["database"] = {
            "table": table_name,
            "rowsSaved": len(rows),
            "sourceFilename": source_filename,
        }
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/slsm/forecast/options/current")
async def current_slsm_forecast_options() -> dict:
    try:
        pivot_headers, pivot_rows, pivot_source = await asyncio.to_thread(load_slsm_revenue_forecast)
        pivot_headers, pivot_rows = normalize_slsm_forecast_rows(pivot_headers, pivot_rows)
        forecast_headers, forecast_rows, forecast_source = await asyncio.to_thread(load_revenue_forecast)
        options = _unique_slsm_names(pivot_rows, pivot_headers)
        options.update(_unique_slsm_names(forecast_rows, forecast_headers))
        pipeline_headers, pipeline_rows, pipeline_source = await asyncio.to_thread(load_slsm_pipeline_upload)
        if not pipeline_rows:
            pipeline_headers, pipeline_rows, pipeline_source = await asyncio.to_thread(load_pipeline_upload)
        options.update(_unique_slsm_names(pipeline_rows, pipeline_headers))
        if not options:
            return {"available": False, "options": [], "database": {"table": "slsm_revenue_forecast", "rowsSaved": 0}}
        return {
            "available": True,
            "options": sorted(options, key=lambda value: value.lower()),
            "database": {
                "table": "slsm_revenue_forecast" if pivot_rows else "revenue_forecast" if forecast_rows else "slsm_pipeline_upload",
                "rowsSaved": (len(pivot_rows) or len(forecast_rows)) + len(pipeline_rows),
                "sourceFilename": pivot_source or forecast_source or pipeline_source,
                "sheet": SLSM_FORECAST_SHEET,
            },
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/slsm/forecast/options")
async def slsm_forecast_options(
    workbook: UploadFile = File(...),
    sheetName: str = Form(SLSM_FORECAST_SHEET),
) -> dict:
    try:
        file_bytes = await workbook.read()
        headers, rows, col_map = parse_workbook(file_bytes, workbook.filename or "", sheetName)
        options = await asyncio.to_thread(unique_person_values, rows, col_map, "SLSM")
        return {
            "available": bool(options),
            "options": options,
            "database": {"sheet": sheetName, "rowsScanned": len(rows), "sourceFilename": workbook.filename or ""},
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/slsl/summary/current")
async def current_slsl_summary(currentYear: int | None = Query(None)) -> dict:
    try:
        return await asyncio.to_thread(build_slsl_summary, currentYear)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/slsm/sls-breakdown/current")
async def current_slsm_sls_breakdown(
    slsmName: str = Query(...),
    currentYear: int | None = Query(None),
) -> dict:
    try:
        return await asyncio.to_thread(build_slsm_sls_breakdown, slsmName, currentYear)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc



@app.get("/api/pipeline/upload/metadata")
async def pipeline_upload_metadata() -> dict:
    metadata = await asyncio.to_thread(load_pipeline_upload_metadata)
    insurance_metadata = await asyncio.to_thread(load_insurance_pipeline_upload_metadata)
    if insurance_metadata["available"]:
        metadata = {
            **metadata,
            "rowsSaved": metadata["rowsSaved"] + insurance_metadata["rowsSaved"],
            "sourceFilename": " + ".join(
                name for name in (metadata["sourceFilename"], insurance_metadata["sourceFilename"]) if name
            ),
            "insuranceRowsSaved": insurance_metadata["rowsSaved"],
        }
    return {"available": metadata["available"], "database": metadata}


@app.get("/api/quality-pipeline/summary")
async def quality_pipeline_summary() -> dict:
    """Return the saved BCM and Insurance qualified-pipeline profile."""
    headers, rows, source_filename = await asyncio.to_thread(load_pipeline_upload)
    if not rows:
        return {"available": False, "rows": [], "database": {"table": "pipeline_upload", "rowsSaved": 0}}

    col_map = {header: index for index, header in enumerate(headers) if header}
    stage_column = _get_column(col_map, "Grouped Sales Stage")
    sub_status_column = _get_column(col_map, "Sub-Status")
    period_columns = {
        "q3": _get_column(col_map, "CY Q3 $"),
        "q4": _get_column(col_map, "CY Q4 $"),
        "year": _get_column(col_map, "CY $", "Current Year Revenue (converted)"),
        "yearPlus": _get_column(col_map, "NY $"),
        "total": _get_column(col_map, "Net TCV Share (converted)", "Net TCV Share"),
    }
    if stage_column is None or any(index is None for index in period_columns.values()):
        missing = [name for name, index in period_columns.items() if index is None]
        if stage_column is None:
            missing.append("Grouped Sales Stage")
        raise HTTPException(status_code=400, detail=f"Missing columns: {', '.join(missing)}")

    totals = {
        "Qualified": {period: 0.0 for period in period_columns},
        "Unqualified": {period: 0.0 for period in period_columns},
    }
    for row in rows:
        stage = str(row[stage_column] if stage_column < len(row) else "").strip()
        label = "Qualified" if stage == "Qualified" else "Unqualified" if stage == "Un-Qualified" else None
        if not label:
            continue
        sub_status = str(row[sub_status_column] if sub_status_column is not None and sub_status_column < len(row) else "").strip().lower()
        if sub_status == "negotiation":
            continue
        for period, index in period_columns.items():
            totals[label][period] += _to_number(row[index] if index is not None and index < len(row) else 0)

    return {
        "available": True,
        "rows": [{"label": label, **values} for label, values in totals.items()],
        "database": {"table": "pipeline_upload", "rowsSaved": len(rows), "sourceFilename": source_filename},
    }


@app.get("/api/pipeline/insurance/upload/metadata")
async def insurance_pipeline_upload_metadata() -> dict:
    metadata = await asyncio.to_thread(load_insurance_pipeline_upload_metadata)
    return {"available": metadata["available"], "database": metadata}


@app.get("/api/wins-lost/upload/metadata")
async def wins_lost_upload_metadata() -> dict:
    metadata = await asyncio.to_thread(load_wins_lost_metadata)
    return {"available": metadata["available"], "database": metadata}


@app.get("/api/pending-validation/upload/metadata")
async def pending_validation_upload_metadata() -> dict:
    metadata = await asyncio.to_thread(load_pending_validation_metadata)
    return {"available": metadata["available"], "database": metadata}


@app.get("/api/slsm/pipeline/upload/metadata")
async def slsm_pipeline_upload_metadata() -> dict:
    metadata = await asyncio.to_thread(load_slsm_pipeline_upload_metadata)
    if not metadata["available"]:
        metadata = await asyncio.to_thread(load_pipeline_upload_metadata)
        if metadata["available"]:
            metadata = {**metadata, "table": "pipeline_upload", "sharedFrom": "sls"}
    insurance_metadata = await asyncio.to_thread(load_insurance_pipeline_upload_metadata)
    if insurance_metadata["available"]:
        metadata = {
            **metadata,
            "rowsSaved": metadata["rowsSaved"] + insurance_metadata["rowsSaved"],
            "sourceFilename": " + ".join(
                name for name in (metadata["sourceFilename"], insurance_metadata["sourceFilename"]) if name
            ),
            "insuranceRowsSaved": insurance_metadata["rowsSaved"],
        }
    return {"available": bool(metadata["available"] or insurance_metadata["available"]), "database": metadata}


@app.get("/api/slsm/wins-lost/upload/metadata")
async def slsm_wins_lost_upload_metadata() -> dict:
    metadata = await asyncio.to_thread(load_slsm_wins_lost_metadata)
    if not metadata["available"]:
        metadata = await asyncio.to_thread(load_wins_lost_metadata)
        if metadata["available"]:
            metadata = {**metadata, "table": "wins_lost", "sharedFrom": "sls"}
    return {"available": metadata["available"], "database": metadata}


@app.get("/api/slsm/pending-validation/upload/metadata")
async def slsm_pending_validation_upload_metadata() -> dict:
    metadata = await asyncio.to_thread(load_slsm_pending_validation_metadata)
    if not metadata["available"]:
        metadata = await asyncio.to_thread(load_pending_validation_metadata)
        if metadata["available"]:
            metadata = {**metadata, "table": "pending_validation", "sharedFrom": "sls"}
    return {"available": metadata["available"], "database": metadata}


@app.get("/api/targets/upload/metadata")
async def target_upload_metadata() -> dict:
    metadata = await asyncio.to_thread(load_target_upload_metadata)
    return {"available": metadata["available"], "database": metadata}


@app.get("/api/targets/current")
async def current_targets() -> dict:
    metadata = await asyncio.to_thread(load_target_upload_metadata)
    if not metadata["available"]:
        return {"available": False, "database": metadata, "metrics": [], "rows": []}

    rows = await asyncio.to_thread(load_target_sls_summary)
    return {
        "available": bool(rows),
        "database": metadata,
        "metrics": metadata.get("metrics", []),
        "rows": rows,
    }


@app.get("/api/targets/accounts/current")
async def current_target_accounts(slsName: str = Query(...)) -> dict:
    name = str(slsName or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="SLS name is required.")

    metadata = await asyncio.to_thread(load_target_upload_metadata)
    if not metadata["available"]:
        return {"available": False, "database": metadata, "metrics": [], "rows": []}

    all_rows = await asyncio.to_thread(load_target_accounts)
    rows = [
        row
        for row in all_rows
        if _matches_name_permutation(row.get("slsName"), name)
    ]
    matched_names = sorted({row["slsName"] for row in rows})
    return {
        "available": bool(rows),
        "query": name,
        "matchedSlsNames": matched_names,
        "database": metadata,
        "metrics": metadata.get("metrics", []),
        "rows": rows,
    }


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


@app.get("/api/slsm/pipeline/summary/current")
async def current_slsm_pipeline_summary(
    slsmName: str = Query(...),
    currentYear: int | None = Query(None),
) -> dict:
    try:
        headers, rows, source_filename = await asyncio.to_thread(load_slsm_pipeline_upload)
        table_name = "slsm_pipeline_upload"
        if not rows:
            headers, rows, source_filename = await asyncio.to_thread(load_pipeline_upload)
            table_name = "pipeline_upload"
        if not rows:
            return {"available": False, "database": {"table": "slsm_pipeline_upload", "rowsSaved": 0}}

        col_map = {header: index for index, header in enumerate(headers) if header}
        result = await asyncio.to_thread(analyze_pipeline_rows, rows, col_map, slsmName, currentYear, "SLSM")
        result["database"] = {
            "table": table_name,
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
            "sheet": "Data",
        }
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/slsm/won-lost/summary/current")
async def current_slsm_won_lost_summary(
    slsmName: str = Query(...),
    currentYear: int | None = Query(None),
) -> dict:
    try:
        headers, rows, source_filename = await asyncio.to_thread(load_slsm_pipeline_upload)
        table_name = "slsm_pipeline_upload"
        if not rows:
            headers, rows, source_filename = await asyncio.to_thread(load_pipeline_upload)
            table_name = "pipeline_upload"
        if not rows:
            return {"available": False, "database": {"table": "slsm_pipeline_upload", "rowsSaved": 0}}

        col_map = {header: index for index, header in enumerate(headers) if header}
        result = await asyncio.to_thread(analyze_won_lost_rows, rows, col_map, slsmName, currentYear, "SLSM")
        result["database"] = {
            "table": table_name,
            "rowsSaved": len(rows),
            "sourceFilename": source_filename,
            "sheet": "Data",
        }
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/pending-validation/summary/current")
async def current_pending_validation_summary(
    slsName: str = Query(...),
    currentYear: int | None = Query(None),
) -> dict:
    try:
        headers, rows, source_filename = await asyncio.to_thread(load_pipeline_upload)
        if not rows:
            return {"available": False, "database": {"table": "pipeline_upload", "rowsSaved": 0}}

        col_map = {header: index for index, header in enumerate(headers) if header}
        result = await asyncio.to_thread(analyze_pending_validation_rows, rows, col_map, slsName, currentYear)
        result["database"] = {
            "table": "pipeline_upload",
            "rowsSaved": len(rows),
            "sourceFilename": source_filename,
            "sheet": "Data",
        }
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/slsm/pending-validation/summary/current")
async def current_slsm_pending_validation_summary(
    slsmName: str = Query(...),
    currentYear: int | None = Query(None),
) -> dict:
    try:
        headers, rows, source_filename = await asyncio.to_thread(load_slsm_pipeline_upload)
        table_name = "slsm_pipeline_upload"
        if not rows:
            headers, rows, source_filename = await asyncio.to_thread(load_pipeline_upload)
            table_name = "pipeline_upload"
        if not rows:
            return {"available": False, "database": {"table": "slsm_pipeline_upload", "rowsSaved": 0}}

        col_map = {header: index for index, header in enumerate(headers) if header}
        result = await asyncio.to_thread(analyze_pending_validation_rows, rows, col_map, slsmName, currentYear, "SLSM")
        result["database"] = {
            "table": table_name,
            "rowsSaved": len(rows),
            "sourceFilename": source_filename,
            "sheet": "Data",
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
        await asyncio.to_thread(replace_slsm_pipeline_upload, headers, rows, workbook.filename or "")
        wins_lost_saved = 0
        try:
            wins_headers, wins_rows, _wins_col_map = parse_workbook(file_bytes, workbook.filename or "", "Wins")
            wins_lost_saved = await asyncio.to_thread(replace_wins_lost, wins_headers, wins_rows, workbook.filename or "")
            await asyncio.to_thread(replace_slsm_wins_lost, wins_headers, wins_rows, workbook.filename or "")
        except ValueError:
            wins_lost_saved = 0
        pending_validation_saved = 0
        try:
            pending_headers, pending_rows, _pending_col_map = parse_workbook(file_bytes, workbook.filename or "", "Pending Validation")
            pending_validation_saved = await asyncio.to_thread(replace_pending_validation, pending_headers, pending_rows, workbook.filename or "")
            await asyncio.to_thread(replace_slsm_pending_validation, pending_headers, pending_rows, workbook.filename or "")
        except ValueError:
            pending_validation_saved = 0
        return {
            "available": rows_saved > 0,
            "database": {
                "table": "pipeline_upload",
                "rowsSaved": rows_saved,
                "sourceFilename": workbook.filename or "",
                "winsLostTable": "wins_lost",
                "winsLostRowsSaved": wins_lost_saved,
                "pendingValidationTable": "pending_validation",
                "pendingValidationRowsSaved": pending_validation_saved,
            },
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/pipeline/insurance/upload")
async def upload_insurance_pipeline(
    workbook: UploadFile = File(...),
    sheetName: str = Form("Data"),
) -> dict:
    try:
        file_bytes = await workbook.read()
        headers, rows, _col_map = parse_workbook(file_bytes, workbook.filename or "", sheetName)
        rows_saved = await asyncio.to_thread(replace_insurance_pipeline_upload, headers, rows, workbook.filename or "")
        return {
            "available": rows_saved > 0,
            "database": {
                "table": "insurance_pipeline_upload",
                "rowsSaved": rows_saved,
                "sourceFilename": workbook.filename or "",
            },
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/forecast/upload")
async def upload_forecast(
    workbook: UploadFile = File(...),
    sheetName: str = Form("Data"),
) -> dict:
    try:
        file_bytes = await workbook.read()
        headers, rows, _col_map = parse_workbook(file_bytes, workbook.filename or "", sheetName)
        rows_saved = await asyncio.to_thread(replace_revenue_forecast, headers, rows, workbook.filename or "")
        slsm_rows_saved = await _store_slsm_forecast_sheet(file_bytes, workbook.filename or "")
        return {
            "available": rows_saved > 0,
            "database": {
                "table": "revenue_forecast",
                "rowsSaved": rows_saved,
                "sourceFilename": workbook.filename or "",
                "slsmTable": "slsm_revenue_forecast",
                "slsmRowsSaved": slsm_rows_saved,
            },
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/forecast/insurance/upload")
async def upload_insurance_forecast(
    workbook: UploadFile = File(...),
    sheetName: str = Form("Data"),
) -> dict:
    try:
        file_bytes = await workbook.read()
        headers, rows, _col_map = parse_workbook(file_bytes, workbook.filename or "", sheetName)
        rows_saved = await asyncio.to_thread(replace_insurance_revenue_forecast, headers, rows, workbook.filename or "")
        return {
            "available": rows_saved > 0,
            "database": {
                "table": "insurance_revenue_forecast",
                "rowsSaved": rows_saved,
                "sourceFilename": workbook.filename or "",
            },
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/slsm/forecast/upload")
async def upload_slsm_forecast(
    workbook: UploadFile = File(...),
    sheetName: str = Form(SLSM_FORECAST_SHEET),
) -> dict:
    try:
        file_bytes = await workbook.read()
        headers, rows, _col_map = parse_workbook(file_bytes, workbook.filename or "", sheetName)
        rows_saved = await asyncio.to_thread(replace_slsm_revenue_forecast, headers, rows, workbook.filename or "")
        return {
            "available": rows_saved > 0,
            "database": {
                "table": "slsm_revenue_forecast",
                "rowsSaved": rows_saved,
                "sourceFilename": workbook.filename or "",
            },
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/slsm/pipeline/upload")
async def upload_slsm_pipeline(
    workbook: UploadFile = File(...),
    sheetName: str = Form("Data"),
) -> dict:
    try:
        file_bytes = await workbook.read()
        headers, rows, _col_map = parse_workbook(file_bytes, workbook.filename or "", sheetName)
        rows_saved = await asyncio.to_thread(replace_slsm_pipeline_upload, headers, rows, workbook.filename or "")
        await asyncio.to_thread(replace_pipeline_upload, headers, rows, workbook.filename or "")
        wins_lost_saved = 0
        try:
            wins_headers, wins_rows, _wins_col_map = parse_workbook(file_bytes, workbook.filename or "", "Wins")
            wins_lost_saved = await asyncio.to_thread(replace_slsm_wins_lost, wins_headers, wins_rows, workbook.filename or "")
        except ValueError:
            wins_lost_saved = 0
        pending_validation_saved = 0
        try:
            pending_headers, pending_rows, _pending_col_map = parse_workbook(file_bytes, workbook.filename or "", "Pending Validation")
            pending_validation_saved = await asyncio.to_thread(replace_slsm_pending_validation, pending_headers, pending_rows, workbook.filename or "")
        except ValueError:
            pending_validation_saved = 0
        return {
            "available": rows_saved > 0,
            "database": {
                "table": "slsm_pipeline_upload",
                "rowsSaved": rows_saved,
                "sourceFilename": workbook.filename or "",
                "winsLostTable": "slsm_wins_lost",
                "winsLostRowsSaved": wins_lost_saved,
                "pendingValidationTable": "slsm_pending_validation",
                "pendingValidationRowsSaved": pending_validation_saved,
            },
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/targets/upload")
async def upload_targets(
    workbook: UploadFile = File(...),
    sheetName: str = Form(TARGETS_SHEET),
) -> dict:
    try:
        file_bytes = await workbook.read()
        parsed = parse_target_pivot(file_bytes, workbook.filename or "", sheetName)
        metadata = await asyncio.to_thread(
            replace_target_upload,
            workbook.filename or "",
            parsed["sheetName"],
            parsed["metrics"],
            parsed["slsRows"],
            parsed["accountRows"],
        )
        return {
            "available": metadata["available"],
            "database": metadata,
            "metrics": parsed["metrics"],
            "rows": parsed["slsRows"],
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/demand-creation/upload", tags=["Demand Creation"])
async def upload_demand_creation(workbook: UploadFile = File(...)) -> dict:
    try:
        parsed = await asyncio.to_thread(
            parse_demand_creation_workbook,
            await workbook.read(),
            workbook.filename or "",
        )
        source_filename = workbook.filename or ""
        metadata = await asyncio.to_thread(replace_demand_creation_upload, source_filename, parsed)
        return {
            "available": metadata["available"],
            "sourceFilename": source_filename,
            "database": metadata,
            **parsed,
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/demand-creation/current", tags=["Demand Creation"])
async def current_demand_creation() -> dict:
    return await asyncio.to_thread(load_demand_creation_upload)


@app.post("/api/reports/ra/upload", tags=["Reports"])
async def upload_ra_workbook(workbook: UploadFile = File(...)) -> dict:
    try:
        source_filename = workbook.filename or ""
        parsed = await asyncio.to_thread(parse_ra_workbook, await workbook.read(), source_filename)
        metadata = await asyncio.to_thread(replace_ra_upload, source_filename, parsed)
        return {"available": metadata["available"], "sourceFilename": source_filename, "database": metadata, **parsed}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/reports/ra/current", tags=["Reports"])
async def current_ra_workbook() -> dict:
    return await asyncio.to_thread(load_ra_upload)


@app.get("/api/bcmi-orig/ra-summary", tags=["Reports"])
async def bcmi_orig_ra_summary() -> dict:
    ra_upload = await asyncio.to_thread(load_ra_upload)
    if not ra_upload.get("available"):
        return {"available": False, "metrics": {}}

    sheets = {sheet.get("sheetName"): sheet for sheet in ra_upload.get("sheets", [])}
    q3_sheet = sheets.get("Q3 BU RA - Americas")
    q4_sheet = sheets.get("Q4 RA - Americas")
    if not q3_sheet or not q4_sheet:
        raise HTTPException(status_code=400, detail="The saved RA upload must contain the Q3 and Q4 Americas sheets.")

    def amount(sheet: dict, header_fragment: str) -> float:
        headers = sheet.get("headers", [])
        index = next((position for position, header in enumerate(headers) if header_fragment.lower() in str(header).lower()), None)
        if index is None:
            raise HTTPException(status_code=400, detail=f'Missing "{header_fragment}" column in {sheet.get("sheetName")}.')
        return sum(_to_number(row[index] if index < len(row) else 0) for row in sheet.get("rows", []))

    def month_amount(sheet: dict, month: str) -> float:
        indexes = [index for index, header in enumerate(sheet.get("headers", [])) if month in str(header)]
        return sum(_to_number(row[index] if index < len(row) else 0) for row in sheet.get("rows", []) for index in indexes)

    q3 = amount(q3_sheet, "Q3'26 Revenue")
    q4 = amount(q4_sheet, "Q4'26 Revenue")
    aug = month_amount(q3_sheet, "2026-08-01")
    return {
        "available": True,
        "metrics": {"aug": aug, "q3": q3, "q4": q4, "year": q3 + q4},
        "sourceFilename": ra_upload.get("sourceFilename"),
    }


@app.get("/api/bcmi-orig/biweekly-wins", tags=["Pipeline"])
async def bcmi_orig_biweekly_wins() -> dict:
    """Return individual top wins from the latest saved Bi-Weekly Wins period."""
    headers, rows, source_filename = await asyncio.to_thread(load_pipeline_upload)
    if not rows:
        return {"available": False, "rows": []}

    col_map = {header: index for index, header in enumerate(headers) if header}
    columns = {
        "stage": _get_column(col_map, "Grouped Sales Stage"),
        "week": _get_column(col_map, "Week Closed"),
        "year": _get_column(col_map, "Year Closed"),
        "account": _get_column(col_map, "Financial Ultimate Parent Account", "Account Name"),
        "description": _get_column(col_map, "Opportunity Name"),
        "netTcv": _get_column(col_map, "Net TCV Share", "Net TCV Share (converted)"),
        "cyRevenue": _get_column(col_map, "CY REVENUE $", "Current Year Revenue (converted)"),
    }
    if any(index is None for index in columns.values()):
        missing = [name for name, index in columns.items() if index is None]
        raise HTTPException(status_code=400, detail=f"Missing columns: {', '.join(missing)}")

    def week_number(value: object) -> int | None:
        match = re.search(r"\d+", str(value or ""))
        return int(match.group()) if match else None

    won_rows = []
    for row in rows:
        stage = str(row[columns["stage"]] if columns["stage"] is not None and columns["stage"] < len(row) else "").strip()
        year = str(row[columns["year"]] if columns["year"] is not None and columns["year"] < len(row) else "")
        week = week_number(row[columns["week"]] if columns["week"] is not None and columns["week"] < len(row) else None)
        if stage == "Won" and year.startswith("2026") and week is not None:
            won_rows.append((week, row))
    if not won_rows:
        return {"available": False, "rows": []}

    latest_week = max(week for week, _row in won_rows)
    latest_wins = [row for week, row in won_rows if week == latest_week]
    top_wins = sorted(latest_wins, key=lambda row: _to_number(row[columns["netTcv"]] if columns["netTcv"] is not None and columns["netTcv"] < len(row) else 0), reverse=True)[:5]
    return {
        "available": True,
        "latestWeek": latest_week,
        "rows": [
            {
                "account": str(row[columns["account"]] if columns["account"] is not None and columns["account"] < len(row) else "").strip(),
                "description": str(row[columns["description"]] if columns["description"] is not None and columns["description"] < len(row) else "").strip(),
                "netTcv": _to_number(row[columns["netTcv"]] if columns["netTcv"] is not None and columns["netTcv"] < len(row) else 0),
                "cyRevenue": _to_number(row[columns["cyRevenue"]] if columns["cyRevenue"] is not None and columns["cyRevenue"] < len(row) else 0),
            }
            for row in top_wins
        ],
        "sourceFilename": source_filename,
    }


@app.get("/api/reports/export", tags=["Reports"])
async def export_dashboard_report() -> FileResponse:
    demand = await asyncio.to_thread(load_demand_creation_upload)
    try:
        report_path = await asyncio.to_thread(_create_report_presentation, demand)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=f"PowerPoint generation failed: {exc}") from exc
    return FileResponse(
        report_path,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        filename="Sales_Dashboard_Report.pptx",
    )


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


@app.post("/api/slsm/pipeline/summary")
async def slsm_pipeline_summary(
    workbook: UploadFile = File(...),
    slsmName: str = Form(...),
    sheetName: str = Form("Data"),
    currentYear: int | None = Form(None),
) -> dict:
    try:
        file_bytes = await workbook.read()
        headers, rows, col_map = parse_workbook(file_bytes, workbook.filename or "", sheetName)
        result = await asyncio.to_thread(analyze_pipeline_rows, rows, col_map, slsmName, currentYear, "SLSM")
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
        await _store_slsm_forecast_sheet(file_bytes, workbook.filename or "")
        saved_rows, result = await _store_and_analyze(headers, rows, col_map, workbook.filename or "", slsName)
        result["available"] = True
        result["database"] = {"table": "revenue_forecast", "rowsSaved": saved_rows, "sourceFilename": workbook.filename or ""}
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/slsm/forecast/analyze")
async def analyze_slsm_forecast(
    workbook: UploadFile = File(...),
    slsmName: str = Form(...),
    sheetName: str = Form(SLSM_FORECAST_SHEET),
) -> dict:
    try:
        file_bytes = await workbook.read()
        headers, rows, col_map = parse_workbook(file_bytes, workbook.filename or "", sheetName)
        save_task = asyncio.to_thread(replace_slsm_revenue_forecast, headers, rows, workbook.filename or "")
        analyze_task = asyncio.to_thread(analyze_forecast_rows, rows, col_map, slsmName, "SLSM")
        saved_rows, result = await asyncio.gather(save_task, analyze_task)
        result["available"] = True
        result["database"] = {"table": "slsm_revenue_forecast", "rowsSaved": saved_rows, "sourceFilename": workbook.filename or ""}
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


async def _store_slsm_forecast_sheet(file_bytes: bytes, filename: str) -> int:
    try:
        headers, rows, _col_map = parse_workbook(file_bytes, filename, SLSM_FORECAST_SHEET)
    except ValueError:
        return 0

    return await asyncio.to_thread(replace_slsm_revenue_forecast, headers, rows, filename)


def build_slsl_summary(current_year: int | None = None) -> dict:
    pivot_headers, pivot_rows, pivot_source = load_slsm_revenue_forecast()
    pivot_headers, pivot_rows = normalize_slsm_forecast_rows(pivot_headers, pivot_rows)
    forecast_headers, forecast_rows, forecast_source = load_revenue_forecast()

    pipeline_headers, pipeline_rows, pipeline_source = load_slsm_pipeline_upload()
    pipeline_table = "slsm_pipeline_upload"
    if not pipeline_rows:
        pipeline_headers, pipeline_rows, pipeline_source = load_pipeline_upload()
        pipeline_table = "pipeline_upload"

    pipeline_col_map = {header: index for index, header in enumerate(pipeline_headers) if header}

    slsm_names = _unique_slsm_names(pivot_rows, pivot_headers)
    slsm_names.update(_unique_slsm_names(forecast_rows, forecast_headers))
    if pipeline_rows:
        try:
            slsm_names.update(unique_person_values(pipeline_rows, pipeline_col_map, "SLSM"))
        except ValueError:
            pass

    year = current_year
    summary_rows = []
    for slsm_name in sorted(slsm_names, key=lambda value: value.lower()):
        revenue_metrics = {
            "forecast": 0.0,
            "target": 0.0,
            "gap": 0.0,
            "accounts": 0,
            "rows": 0,
            "labels": _empty_money_labels("forecast", "target", "gap"),
            "status": "on-track",
        }
        pipeline_metrics = {
            "pipeline": 0.0,
            "qualified": 0.0,
            "unqualified": 0.0,
            "accounts": 0,
            "rows": 0,
            "labels": _empty_money_labels("pipeline", "qualified", "unqualified"),
        }
        won_metrics = {"won": 0.0, "rows": 0, "labels": _empty_money_labels("won")}
        pending_metrics = {"pendingValidation": 0.0, "rows": 0, "labels": _empty_money_labels("pendingValidation")}

        try:
            revenue_headers, revenue_rows, _revenue_table = _revenue_rows_for_slsm(
                slsm_name, pivot_headers, pivot_rows, forecast_headers, forecast_rows
            )
            revenue_col_map = {header: index for index, header in enumerate(revenue_headers) if header}
            if revenue_rows:
                revenue_metrics = analyze_forecast_rows(revenue_rows, revenue_col_map, slsm_name, "SLSM")["metrics"]
        except ValueError:
            pass

        if pipeline_rows:
            try:
                pipeline_result = analyze_pipeline_rows(pipeline_rows, pipeline_col_map, slsm_name, year, "SLSM")
                pipeline_metrics = pipeline_result["metrics"]
                year = pipeline_result["year"]
            except ValueError:
                pass

            try:
                won_result = analyze_won_lost_rows(pipeline_rows, pipeline_col_map, slsm_name, year, "SLSM")
                won_metrics = won_result["metrics"]
                year = won_result["year"]
            except ValueError:
                pass

            try:
                pending_result = analyze_pending_validation_rows(pipeline_rows, pipeline_col_map, slsm_name, year, "SLSM")
                pending_metrics = pending_result["metrics"]
                year = pending_result["year"]
            except ValueError:
                pass

        realized_tcv = (won_metrics.get("won") or 0.0) + (pending_metrics.get("pendingValidation") or 0.0)
        summary_rows.append(
            {
                "slsmName": slsm_name,
                "revenue": revenue_metrics,
                "pipeline": pipeline_metrics,
                "realizedTcv": {
                    "total": realized_tcv,
                    "won": won_metrics.get("won") or 0.0,
                    "pendingValidation": pending_metrics.get("pendingValidation") or 0.0,
                    "rows": (won_metrics.get("rows") or 0) + (pending_metrics.get("rows") or 0),
                    "labels": {
                        "total": _money_label(realized_tcv),
                        "won": won_metrics.get("labels", {}).get("won", "$0.0M"),
                        "pendingValidation": pending_metrics.get("labels", {}).get("pendingValidation", "$0.0M"),
                    },
                },
            }
        )

    return {
        "available": bool(summary_rows),
        "year": year or current_year,
        "rows": summary_rows,
        "database": {
            "revenue": {
                "table": "slsm_revenue_forecast",
                "rowsSaved": len(pivot_rows) or len(forecast_rows),
                "sourceFilename": pivot_source or forecast_source,
            },
            "pipeline": {
                "table": pipeline_table,
                "rowsSaved": len(pipeline_rows),
                "sourceFilename": pipeline_source,
            },
        },
    }


def build_slsm_sls_breakdown(slsm_name: str, current_year: int | None = None) -> dict:
    name = str(slsm_name or "").strip()
    if not name:
        raise ValueError("SLSM name is required.")

    pivot_headers, pivot_rows, pivot_source = load_slsm_revenue_forecast()
    pivot_headers, pivot_rows = normalize_slsm_forecast_rows(pivot_headers, pivot_rows)
    forecast_headers, forecast_rows, forecast_source = load_revenue_forecast()
    revenue_headers, revenue_rows, revenue_table = _revenue_rows_for_slsm(
        name, pivot_headers, pivot_rows, forecast_headers, forecast_rows
    )
    revenue_source = pivot_source if revenue_table == "slsm_revenue_forecast" else forecast_source

    pipeline_headers, pipeline_rows, pipeline_source = load_slsm_pipeline_upload()
    pipeline_table = "slsm_pipeline_upload"
    if not pipeline_rows:
        pipeline_headers, pipeline_rows, pipeline_source = load_pipeline_upload()
        pipeline_table = "pipeline_upload"

    slsm_revenue_rows = _filter_rows_by_person(revenue_rows, revenue_headers, name, "SLSM")
    slsm_pipeline_rows = _filter_rows_by_person(pipeline_rows, pipeline_headers, name, "SLSM")
    revenue_col_map = {header: index for index, header in enumerate(revenue_headers) if header}
    pipeline_col_map = {header: index for index, header in enumerate(pipeline_headers) if header}

    sls_names = _unique_child_people(slsm_revenue_rows, revenue_headers, "SLS")
    sls_names.update(_unique_child_people(slsm_pipeline_rows, pipeline_headers, "SLS"))

    year = current_year
    summary_rows = []
    for sls_name in sorted(sls_names, key=lambda value: value.lower()):
        revenue_metrics = {
            "forecast": 0.0,
            "target": 0.0,
            "gap": 0.0,
            "accounts": 0,
            "rows": 0,
            "labels": _empty_money_labels("forecast", "target", "gap"),
            "status": "on-track",
        }
        pipeline_metrics = {
            "pipeline": 0.0,
            "qualified": 0.0,
            "unqualified": 0.0,
            "accounts": 0,
            "rows": 0,
            "labels": _empty_money_labels("pipeline", "qualified", "unqualified"),
        }
        won_metrics = {"won": 0.0, "rows": 0, "labels": _empty_money_labels("won")}
        pending_metrics = {"pendingValidation": 0.0, "rows": 0, "labels": _empty_money_labels("pendingValidation")}

        sls_revenue_rows = _filter_rows_by_exact_person(slsm_revenue_rows, revenue_headers, sls_name, "SLS")
        sls_pipeline_rows = _filter_rows_by_exact_person(slsm_pipeline_rows, pipeline_headers, sls_name, "SLS")

        if sls_revenue_rows:
            try:
                revenue_metrics = analyze_forecast_rows(sls_revenue_rows, revenue_col_map, sls_name, "SLS")["metrics"]
            except ValueError:
                pass

        if sls_pipeline_rows:
            try:
                pipeline_result = analyze_pipeline_rows(sls_pipeline_rows, pipeline_col_map, sls_name, year, "SLS")
                pipeline_metrics = pipeline_result["metrics"]
                year = pipeline_result["year"]
            except ValueError:
                pass

            try:
                won_result = analyze_won_lost_rows(sls_pipeline_rows, pipeline_col_map, sls_name, year, "SLS")
                won_metrics = won_result["metrics"]
                year = won_result["year"]
            except ValueError:
                pass

            try:
                pending_result = analyze_pending_validation_rows(sls_pipeline_rows, pipeline_col_map, sls_name, year, "SLS")
                pending_metrics = pending_result["metrics"]
                year = pending_result["year"]
            except ValueError:
                pass

        realized_tcv = (won_metrics.get("won") or 0.0) + (pending_metrics.get("pendingValidation") or 0.0)
        metric_values = (
            revenue_metrics.get("forecast", 0.0),
            revenue_metrics.get("target", 0.0),
            revenue_metrics.get("gap", 0.0),
            pipeline_metrics.get("pipeline", 0.0),
            pipeline_metrics.get("qualified", 0.0),
            pipeline_metrics.get("unqualified", 0.0),
            won_metrics.get("won", 0.0),
            pending_metrics.get("pendingValidation", 0.0),
        )
        if not any(value != 0 for value in metric_values):
            continue
        summary_rows.append(
            {
                "slsName": sls_name,
                "revenue": revenue_metrics,
                "pipeline": pipeline_metrics,
                "realizedTcv": {
                    "total": realized_tcv,
                    "won": won_metrics.get("won") or 0.0,
                    "pendingValidation": pending_metrics.get("pendingValidation") or 0.0,
                    "rows": (won_metrics.get("rows") or 0) + (pending_metrics.get("rows") or 0),
                    "labels": {
                        "total": _money_label(realized_tcv),
                        "won": won_metrics.get("labels", {}).get("won", "$0.0M"),
                        "pendingValidation": pending_metrics.get("labels", {}).get("pendingValidation", "$0.0M"),
                    },
                },
            }
        )

    return {
        "available": bool(summary_rows),
        "query": name,
        "year": year or current_year,
        "rows": summary_rows,
        "database": {
            "revenue": {
                "table": revenue_table,
                "rowsSaved": len(revenue_rows),
                "sourceFilename": revenue_source,
            },
            "pipeline": {
                "table": pipeline_table,
                "rowsSaved": len(pipeline_rows),
                "sourceFilename": pipeline_source,
            },
        },
    }


def _tag_routes_for_swagger() -> None:
    tag_rules = [
        ("/health", "Health"),
        ("/api/slsl/", "SLSL Summary"),
        ("/api/slsm/sls-breakdown/", "SLSM Breakdown"),
        ("/api/slsm/forecast/", "SLSM Forecast"),
        ("/api/slsm/pipeline/", "SLSM Pipeline"),
        ("/api/slsm/wins-lost/", "SLSM Realized TCV"),
        ("/api/slsm/won-lost/", "SLSM Realized TCV"),
        ("/api/slsm/pending-validation/", "SLSM Realized TCV"),
        ("/api/targets/", "Targets"),
        ("/api/forecast/", "Forecast"),
        ("/api/pipeline/", "Pipeline"),
        ("/api/wins-lost/", "Realized TCV"),
        ("/api/won-lost/", "Realized TCV"),
        ("/api/pending-validation/", "Realized TCV"),
    ]

    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue

        for prefix, tag in tag_rules:
            if route.path.startswith(prefix):
                route.tags = [tag]
                break


_tag_routes_for_swagger()
