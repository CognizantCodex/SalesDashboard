from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import subprocess
import tempfile
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.routing import APIRoute
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse, Response

from .database import (
    load_demand_creation_upload,
    load_erosion_upload,
    load_frontier_security_defense_upload,
    load_frontier_models_upload,
    load_workable_demand_upload,
    load_workable_demand_so_detail_upload,
    load_quality_pipeline_upload,
    load_ra_upload,
    load_insurance_revenue_forecast_metadata,
    load_pending_validation_metadata,
    load_insurance_pipeline_upload_metadata,
    load_pipeline_upload,
    load_pipeline_upload_source,
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
    replace_erosion_upload,
    replace_frontier_security_defense_upload,
    replace_frontier_models_upload,
    replace_workable_demand_upload,
    replace_workable_demand_so_detail_upload,
    replace_ra_upload,
    replace_pipeline_upload,
    replace_insurance_pipeline_upload,
    replace_quality_pipeline_upload,
    replace_insurance_revenue_forecast,
    replace_revenue_forecast,
    replace_slsm_pending_validation,
    replace_slsm_pipeline_upload,
    replace_slsm_revenue_forecast,
    replace_slsm_wins_lost,
    replace_target_upload,
    replace_wins_lost,
)
from .forecast_agent import TARGETS_SHEET, SLSM_FORECAST_SHEET, _get_column, _matches_name_permutation, _to_number, analyze_forecast_rows, analyze_pending_validation_rows, analyze_pipeline_rows, analyze_won_lost_rows, normalize_slsm_forecast_rows, parse_demand_creation_workbook, parse_erosion_workbook, parse_frontier_models_workbook, parse_frontier_security_defense_workbook, parse_ra_workbook, parse_target_pivot, parse_workable_demand_workbook, parse_workbook, result_to_csv, unique_person_values


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


REPORT_EXPORT_DIR = Path(__file__).resolve().parent / ".report-exports"
RECENT_PIPELINE_MARKER = "opportunity created in two weeks"


def _workable_detail_date(value: object) -> date | None:
    if isinstance(value, (int, float)):
        return date(1899, 12, 30) + timedelta(days=int(value))
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return date(1899, 12, 30) + timedelta(days=int(float(text)))
    except ValueError:
        pass
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date()
    except ValueError:
        for pattern in ("%m/%d/%Y", "%Y-%m-%d"):
            try:
                return datetime.strptime(text, pattern).date()
            except ValueError:
                continue
    return None


def workable_demand_skill_location(headers: list[str], rows: list[list[object]]) -> dict:
    """Summarize the latest SO-submission week for BCM and Insurance 2."""
    col_map = {str(header).strip(): index for index, header in enumerate(headers)}
    submitted_index = _get_column(col_map, "SO Submission Date")
    country_index = _get_column(col_map, "Country")
    skills_index = _get_column(col_map, "Technical Skills Required")
    bu_index = _get_column(col_map, "BU")
    if None in (submitted_index, country_index, skills_index, bu_index):
        return {"available": False, "rows": [], "detail": "The saved workbook is missing required SO Detail columns."}

    dated_rows = [(row, _workable_detail_date(row[submitted_index] if submitted_index < len(row) else None)) for row in rows]
    dates = [item_date for _, item_date in dated_rows if item_date]
    if not dates:
        return {"available": False, "rows": [], "detail": "No SO Submission Date values are available in the saved workbook."}
    latest_date = max(dates)
    week_start = latest_date - timedelta(days=6)
    patterns = {
        "Java": re.compile(r"\bjava\b", re.IGNORECASE),
        ".Net": re.compile(r"(?<!\w)\.?\s*net\b|\bdot\s*net\b", re.IGNORECASE),
        "UI - React/Angular": re.compile(r"\b(?:react|angular)\b", re.IGNORECASE),
    }
    totals = {name: {"us": 0.0, "india": 0.0} for name in patterns}
    matched_rows = 0
    for row, submitted_date in dated_rows:
        if not submitted_date or not week_start <= submitted_date <= latest_date:
            continue
        bu = re.sub(r"[^a-z0-9]+", "", str(row[bu_index] if bu_index < len(row) else "").lower())
        if not (bu.startswith("bankingcapitalmarkets") or bu == "insurance2"):
            continue
        country = str(row[country_index] if country_index < len(row) else "").strip().lower()
        location = "us" if country in {"united states", "us", "usa"} else "india" if country == "india" else None
        if not location:
            continue
        matched_rows += 1
        skills = str(row[skills_index] if skills_index < len(row) else "")
        for name, pattern in patterns.items():
            if pattern.search(skills):
                totals[name][location] += 1
    return {
        "available": True,
        "weekStart": week_start.isoformat(),
        "weekEnding": latest_date.isoformat(),
        "rowsMatched": matched_rows,
        "rows": [
            {"skill": skill, "us": values["us"], "india": values["india"]}
            for skill, values in totals.items()
        ],
    }


def workable_demand_creation_payload(headers: list[str], rows: list[list[object]]) -> dict:
    """Return the Demand Creation page payload from SO Detail by Parent Customer."""
    col_map = {str(header).strip(): index for index, header in enumerate(headers) if str(header).strip()}
    submitted_index = _get_column(col_map, "SO Submission Date")
    bu_index = _get_column(col_map, "BU")
    account_index = _get_column(col_map, "Parent Customer")
    project_index = _get_column(col_map, "Project Name")
    workable_index = _get_column(col_map, "Workable Demand")
    if None in (submitted_index, bu_index, account_index, workable_index):
        raise ValueError("The saved SO Detail report is missing required demand columns.")

    selected_bus = {"banking & capital markets - na": "BCM", "insurance 2": "INS2"}
    report_year = date.today().year
    q3_start, q3_end = date(report_year, 7, 1), date(report_year, 9, 30)
    q4_start, q4_end = date(report_year, 10, 1), date(report_year, 12, 31)
    period_specs = [
        {"key": "aug", "label": "Aug", "start": date(report_year, 8, 1), "end": date(report_year, 8, 31)},
        {"key": "sep", "label": "Sep", "start": date(report_year, 9, 1), "end": date(report_year, 9, 30)},
        {"key": "q3", "label": "Q3 Total", "start": q3_start, "end": q3_end},
        {"key": "oct", "label": "Oct", "start": date(report_year, 10, 1), "end": date(report_year, 10, 31)},
        {"key": "nov", "label": "Nov", "start": date(report_year, 11, 1), "end": date(report_year, 11, 30)},
        {"key": "dec", "label": "Dec", "start": date(report_year, 12, 1), "end": date(report_year, 12, 31)},
        {"key": "q4", "label": "Q4 Total", "start": q4_start, "end": q4_end},
    ]
    current_month_start = date(report_year, date.today().month, 1)
    previous_month_end = current_month_start - timedelta(days=1)
    previous_month_start = date(previous_month_end.year, previous_month_end.month, 1)
    current_month_end = date(report_year + (1 if date.today().month == 12 else 0), 1 if date.today().month == 12 else date.today().month + 1, 1) - timedelta(days=1)
    weekly: dict[date, dict[str, float]] = defaultdict(lambda: {"BCM": 0.0, "INS2": 0.0})
    profiles = {name: defaultdict(float) for name in ("BCM", "INS2")}
    accounts: dict[str, dict] = defaultdict(lambda: {"periods": defaultdict(float), "projects": set()})
    rows_processed = {"BCM": 0, "INS2": 0}

    for row in rows:
        bu = selected_bus.get(str(_cell(row, bu_index) or "").strip().casefold())
        workable = str(_cell(row, workable_index) or "").strip().casefold()
        submitted_date = _workable_detail_date(_cell(row, submitted_index))
        if not bu or workable != "yes" or submitted_date is None:
            continue
        if previous_month_start <= submitted_date <= current_month_end:
            week_start = previous_month_start + timedelta(days=((submitted_date - previous_month_start).days // 7) * 7)
            weekly[week_start][bu] += 1
        if not q3_start <= submitted_date <= q4_end:
            continue
        account_name = str(_cell(row, account_index) or "").strip() or "Unassigned"
        account = accounts[account_name]
        project = str(_cell(row, project_index) or "").strip() if project_index is not None else ""
        if project:
            account["projects"].add(project)
        for period in period_specs:
            if period["start"] <= submitted_date <= period["end"]:
                profiles[bu][period["key"]] += 1
                account["periods"][period["key"]] += 1
        rows_processed[bu] += 1

    first_week = previous_month_start
    final_week = previous_month_start + timedelta(days=((current_month_end - previous_month_start).days // 7) * 7)
    ordered_weeks = []
    week = first_week
    while week <= final_week:
        ordered_weeks.append(week)
        week += timedelta(days=7)
    top_accounts = []
    for account_name, account in sorted(accounts.items(), key=lambda item: (-(item[1]["periods"]["q3"] + item[1]["periods"]["q4"]), item[0].casefold()))[:10]:
        projects = sorted(account["projects"])
        top_accounts.append({
            "account": account_name,
            "description": projects[0] if len(projects) == 1 else (f"{len(projects)} projects" if projects else "—"),
            "periods": {period["key"]: account["periods"][period["key"]] for period in period_specs},
            "total": account["periods"]["q3"] + account["periods"]["q4"],
        })
    profile_columns = [{"key": period["key"], "label": period["label"]} for period in period_specs]
    account_columns = [{"key": period["key"], "label": period["label"].replace(" Total", "")} for period in period_specs]
    return {
        "available": bool(rows_processed["BCM"] or rows_processed["INS2"]),
        "series": [{"week": week.isoformat(), "weekLabel": f"{week.strftime('%b')} {week.day}", "BCM": weekly[week]["BCM"], "INS2": weekly[week]["INS2"]} for week in ordered_weeks],
        "totals": {name: profiles[name]["q3"] + profiles[name]["q4"] for name in ("BCM", "INS2")},
        "rowsProcessed": rows_processed,
        "topAccounts": {"columns": account_columns, "rows": top_accounts},
        "demandProfile": {
            "columns": profile_columns,
            "rows": [
                {
                    "name": "BCM" if name == "BCM" else "INS 2",
                    "total": profiles[name]["q3"] + profiles[name]["q4"],
                    "periods": {period["key"]: profiles[name][period["key"]] for period in period_specs},
                }
                for name in ("BCM", "INS2")
            ],
        },
    }


def _presentation_node() -> str:
    configured = os.environ.get("SALES_DASHBOARD_PRESENTATION_NODE")
    bundled = Path.home() / ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
    for candidate in (configured, str(bundled), shutil.which("node")):
        if candidate and Path(candidate).exists():
            return candidate
    raise RuntimeError("Node.js is required to create the PowerPoint report.")


def _recent_pipeline_rows(headers: list[str], rows: list[list]) -> list[list]:
    """Keep the two-week subset flagged by the source pipeline Data sheet."""
    marker_index = _get_column({header: index for index, header in enumerate(headers) if header}, "Opportunity Created in Two weeks or Old")
    if marker_index is None:
        return rows
    return [
        row
        for row in rows
        if str(row[marker_index] if marker_index < len(row) else "").strip().casefold() == RECENT_PIPELINE_MARKER
    ]


def _pipeline_date(value: object) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date(1899, 12, 30) + timedelta(days=float(value))
    except (TypeError, ValueError):
        try:
            return datetime.fromisoformat(str(value)).date()
        except ValueError:
            return None


def _latest_pipeline_week_rows(headers: list[str], rows: list[list]) -> list[list]:
    created_index = _get_column({header: index for index, header in enumerate(headers) if header}, "Created Date")
    if created_index is None:
        return rows
    dates = [_pipeline_date(row[created_index] if created_index < len(row) else None) for row in rows]
    latest_date = max((value for value in dates if value is not None), default=None)
    if latest_date is None:
        return rows
    cutoff = latest_date - timedelta(days=6)
    return [row for row, value in zip(rows, dates) if value is not None and value >= cutoff]


def _frontier_model_quality_data(frontier_upload: dict) -> tuple[list[dict], list[dict]]:
    """Build the Frontier Models chart and opportunity table from its Base sheet."""
    headers = frontier_upload.get("headers") or []
    rows = frontier_upload.get("rows") or []
    if not rows:
        return [], []

    col_map = {header: index for index, header in enumerate(headers) if header}
    bu_column = _get_column(col_map, "BU")
    model_column = _get_column(col_map, "Frontier Model")
    close_date_column = _get_column(col_map, "Deal Close Date", "Estimated Deal Close Date")
    tcv_column = _get_column(col_map, "Overall TCV", "SEG TCV")
    account_column = _get_column(col_map, "Parent Customer", "Financial Ultimate Parent Account", "Account Name")
    opportunity_column = _get_column(col_map, "Opportunity Name")
    opportunity_id_column = _get_column(col_map, "WinZone Opportunity ID")
    year_column = _get_column(col_map, "FY26 SEG Rev.", "CY $")
    if any(column is None for column in (bu_column, model_column, close_date_column, tcv_column)):
        return [], []

    selected_bus = {"banking & capital markets - na", "insurance 2"}
    filtered = [
        row for row in rows
        if str(_cell(row, bu_column) or "").strip().casefold() in selected_bus
        and str(_cell(row, model_column) or "").strip()
    ]
    dated_rows = [(row, _pipeline_date(_cell(row, close_date_column))) for row in filtered]
    # Use the current Monday–Sunday period rather than the latest date contained
    # in a workbook, which may include forecast dates years ahead.
    this_week_start = date.today() - timedelta(days=date.today().weekday())
    this_week_end = this_week_start + timedelta(days=6)
    last_week_rows = [
        row for row, value in dated_rows
        if value is not None and this_week_start <= value <= this_week_end
    ]

    model_totals: dict[str, float] = {}
    opportunities: dict[str, dict] = {}
    for row in last_week_rows:
        model = str(_cell(row, model_column) or "").strip()
        tcv = _to_number(_cell(row, tcv_column))
        model_totals[model] = model_totals.get(model, 0.0) + tcv
        identifier = str(_cell(row, opportunity_id_column) or "").strip()
        account = str(_cell(row, account_column) or "").strip()
        description = str(_cell(row, opportunity_column) or "").strip()
        key = identifier or f"{account}|{description}"
        item = opportunities.setdefault(key, {"account": account, "description": description, "frontierModel": model, "totalTcv": 0.0, "yearTcv": 0.0})
        item["totalTcv"] = max(item["totalTcv"], tcv)
        item["yearTcv"] = max(item["yearTcv"], _to_number(_cell(row, year_column)))

    top_models = sorted(model_totals.items(), key=lambda item: item[1], reverse=True)[:3]
    top_total = sum(total for _model, total in top_models)
    return (
        [{"name": model, "totalTcv": total, "percent": total / top_total * 100 if top_total else 0} for model, total in top_models],
        sorted(opportunities.values(), key=lambda item: item["totalTcv"], reverse=True)[:6],
    )


def _refresh_quality_pipeline_uploads() -> None:
    """Rebuild saved Quality Pipeline subsets without replacing full history."""
    for insurance in (False, True):
        headers, rows, source_filename = load_pipeline_upload_source(insurance)
        if rows:
            replace_quality_pipeline_upload(headers, _recent_pipeline_rows(headers, rows), source_filename or "", insurance)


def _quality_pipeline_payload(
    headers: list[str],
    rows: list[list],
    source_filename: str | None,
    total_rows: list[list] | None = None,
    frontier_upload: dict | None = None,
) -> dict:
    if not rows:
        return {"available": False, "rows": [], "offerings": [], "campaigns": [], "opportunities": [], "campaignOpportunities": [], "database": {"table": "quality_pipeline_bcm_upload + quality_pipeline_insurance_upload", "rowsSaved": 0}}

    col_map = {header: index for index, header in enumerate(headers) if header}
    stage_column = _get_column(col_map, "Grouped Sales Stage")
    sub_status_column = _get_column(col_map, "Sub-Status")
    offering_column = _get_column(col_map, "Offering/Solutions")
    account_column = _get_column(col_map, "Financial Ultimate Parent Account", "Account Name")
    opportunity_column = _get_column(col_map, "Opportunity Name")
    opportunity_id_column = _get_column(col_map, "WinZone Opportunity ID")
    campaign_column = _get_column(col_map, "Campaign Theme")

    def campaign_name(row: list) -> str:
        value = row[campaign_column] if campaign_column is not None and campaign_column < len(row) else None
        name = str(value).strip() if value is not None else ""
        return "" if name.casefold() in {"none", "n/a", "na", "-"} else name

    period_columns = {
        "q3": _get_column(col_map, "CY Q3 $"),
        "q4": _get_column(col_map, "CY Q4 $"),
        "year": _get_column(col_map, "CY $", "Current Year Revenue (converted)"),
        "yearPlus": _get_column(col_map, "NY $"),
        "total": _get_column(col_map, "Net TCV Share (converted)", "Net TCV Share"),
    }
    if stage_column is None or offering_column is None or any(index is None for index in period_columns.values()):
        missing = [name for name, index in period_columns.items() if index is None]
        if stage_column is None:
            missing.append("Grouped Sales Stage")
        if offering_column is None:
            missing.append("Offering/Solutions")
        raise ValueError(f"Missing columns: {', '.join(missing)}")

    # The headline Quality of Pipeline table always reflects the complete BCM
    # plus Insurance pipeline uploads. Charts and opportunity lists use `rows`,
    # the separately persisted recent subset.
    totals = {"Qualified": {period: 0.0 for period in period_columns}, "Unqualified": {period: 0.0 for period in period_columns}}
    display_rows = _latest_pipeline_week_rows(headers, rows)
    offering_totals: dict[str, float] = {}
    campaign_totals: dict[str, float] = {}
    candidates: list[list] = []
    for row in total_rows if total_rows is not None else rows:
        stage = str(row[stage_column] if stage_column < len(row) else "").strip()
        label = "Qualified" if stage == "Qualified" else "Unqualified" if stage == "Un-Qualified" else None
        if not label:
            continue
        sub_status = str(row[sub_status_column] if sub_status_column is not None and sub_status_column < len(row) else "").strip().casefold()
        if sub_status == "negotiation":
            continue
        for period, index in period_columns.items():
            totals[label][period] += _to_number(row[index] if index is not None and index < len(row) else 0)
    for row in display_rows:
        stage = str(row[stage_column] if stage_column < len(row) else "").strip()
        if stage not in {"Qualified", "Un-Qualified"}:
            continue
        sub_status = str(row[sub_status_column] if sub_status_column is not None and sub_status_column < len(row) else "").strip().casefold()
        if sub_status == "negotiation":
            continue
        total_tcv = _to_number(row[period_columns["total"]] if period_columns["total"] is not None and period_columns["total"] < len(row) else 0)
        offering = str(row[offering_column] if offering_column < len(row) else "").strip() or "Unspecified"
        offering_totals[offering] = offering_totals.get(offering, 0.0) + total_tcv
        campaign = campaign_name(row)
        if campaign:
            campaign_totals[campaign] = campaign_totals.get(campaign, 0.0) + total_tcv
        candidates.append(row)

    def top_categories(totals_by_category: dict[str, float]) -> list[dict]:
        categories = sorted(totals_by_category.items(), key=lambda item: item[1], reverse=True)[:3]
        category_total = sum(value for _name, value in categories)
        return [{"name": name, "totalTcv": value, "percent": value / category_total * 100 if category_total else 0} for name, value in categories]

    top_offerings = top_categories(offering_totals)
    top_campaigns = top_categories(campaign_totals)
    frontier_models, frontier_model_opportunities = _frontier_model_quality_data(frontier_upload or {})
    selected_offerings = {item["name"] for item in top_offerings}
    selected_campaigns = {item["name"] for item in top_campaigns}
    opportunities: dict[str, dict] = {}
    campaign_opportunities: dict[str, dict] = {}
    for row in candidates:
        offering = str(row[offering_column] if offering_column < len(row) else "").strip() or "Unspecified"
        identifier = str(row[opportunity_id_column] if opportunity_id_column is not None and opportunity_id_column < len(row) else "").strip()
        account = str(row[account_column] if account_column is not None and account_column < len(row) else "").strip()
        description = str(row[opportunity_column] if opportunity_column is not None and opportunity_column < len(row) else "").strip()
        key = identifier or f"{account}|{description}"
        total_tcv = _to_number(row[period_columns["total"]] if period_columns["total"] is not None and period_columns["total"] < len(row) else 0)
        year_tcv = _to_number(row[period_columns["year"]] if period_columns["year"] is not None and period_columns["year"] < len(row) else 0)
        if offering in selected_offerings:
            item = opportunities.setdefault(key, {"account": account, "description": description, "offering": offering, "totalTcv": 0.0, "yearTcv": 0.0})
            item["totalTcv"] += total_tcv
            item["yearTcv"] += year_tcv

        campaign = campaign_name(row)
        if campaign in selected_campaigns:
            campaign_item = campaign_opportunities.setdefault(key, {"account": account, "description": description, "campaign": campaign, "totalTcv": 0.0, "yearTcv": 0.0})
            campaign_item["totalTcv"] += total_tcv
            campaign_item["yearTcv"] += year_tcv

    return {
        "available": True,
        "rows": [{"label": label, **values} for label, values in totals.items()],
        "offerings": top_offerings,
        "campaigns": top_campaigns,
        "frontierModels": frontier_models,
        "opportunities": sorted(opportunities.values(), key=lambda item: item["totalTcv"], reverse=True)[:6],
        "campaignOpportunities": sorted(campaign_opportunities.values(), key=lambda item: item["totalTcv"], reverse=True)[:6],
        "frontierModelOpportunities": frontier_model_opportunities,
        "database": {"table": "quality_pipeline_bcm_upload + quality_pipeline_insurance_upload", "rowsSaved": len(rows), "summaryRowsSaved": len(total_rows) if total_rows is not None else len(rows), "displayRows": len(display_rows), "sourceFilename": source_filename},
    }


def _create_report_presentation(report: dict) -> bytes:
    demand = report.get("demand") or {}
    if not demand.get("available"):
        raise ValueError("Upload a Demand Creation workbook before generating a report.")

    REPORT_EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    report_id = uuid4().hex
    input_path = REPORT_EXPORT_DIR / f"{report_id}.json"
    output_path = REPORT_EXPORT_DIR / f"Sales_Dashboard_Report_{report_id}.pptx"
    input_path.write_text(json.dumps(report), encoding="utf-8")
    try:
        artifact_tool_root = Path.home() / ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool"
        command_env = os.environ.copy()
        command_env.setdefault("SALES_DASHBOARD_ARTIFACT_TOOL_ROOT", str(artifact_tool_root))
        completed = subprocess.run(
            [_presentation_node(), str(Path(__file__).with_name("report_presentation.mjs")), str(input_path), str(output_path)],
            capture_output=True,
            text=False,
            check=False,
            timeout=90,
            env=command_env,
        )
    finally:
        input_path.unlink(missing_ok=True)

    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or b"Unable to create PowerPoint report.").decode("utf-8", errors="replace").strip()
        raise RuntimeError(detail)
    return completed.stdout


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


@app.get("/api/bcmi-orig/revenue-summary", tags=["Reports"])
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


@app.get("/api/quality-pipeline/summary", tags=["Pipeline"])
async def quality_pipeline_summary() -> dict:
    """Return the saved two-week BCM and Insurance Quality Pipeline profile."""
    try:
        await asyncio.to_thread(_refresh_quality_pipeline_uploads)
        headers, rows, source_filename = await asyncio.to_thread(load_quality_pipeline_upload)
        _full_headers, full_rows, _full_source_filename = await asyncio.to_thread(load_pipeline_upload)
        frontier_upload = await asyncio.to_thread(load_frontier_models_upload)
        return await asyncio.to_thread(_quality_pipeline_payload, headers, rows, source_filename, full_rows, frontier_upload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


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
        quality_rows_saved = await asyncio.to_thread(replace_quality_pipeline_upload, headers, _recent_pipeline_rows(headers, rows), workbook.filename or "")
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
                "qualityPipelineRowsSaved": quality_rows_saved,
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
        quality_rows_saved = await asyncio.to_thread(replace_quality_pipeline_upload, headers, _recent_pipeline_rows(headers, rows), workbook.filename or "", True)
        return {
            "available": rows_saved > 0,
            "database": {
                "table": "insurance_pipeline_upload",
                "rowsSaved": rows_saved,
                "qualityPipelineRowsSaved": quality_rows_saved,
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
    workable_upload = await asyncio.to_thread(load_workable_demand_so_detail_upload)
    if workable_upload.get("available"):
        try:
            result = await asyncio.to_thread(workable_demand_creation_payload, workable_upload["headers"], workable_upload["rows"])
            return {**result, "sourceFilename": workable_upload.get("sourceFilename"), "database": {"table": workable_upload.get("table"), "rowsSaved": workable_upload.get("rowsSaved", 0)}}
        except ValueError:
            pass
    return await asyncio.to_thread(load_demand_creation_upload)


def _current_demand_creation_payload() -> dict:
    workable_upload = load_workable_demand_so_detail_upload()
    if workable_upload.get("available"):
        try:
            result = workable_demand_creation_payload(workable_upload["headers"], workable_upload["rows"])
            return {**result, "sourceFilename": workable_upload.get("sourceFilename"), "database": {"table": workable_upload.get("table"), "rowsSaved": workable_upload.get("rowsSaved", 0)}}
        except ValueError:
            pass
    return load_demand_creation_upload()


@app.get("/api/demand-creation/skill-location", tags=["Demand Creation"])
async def demand_creation_skill_location() -> dict:
    upload = await asyncio.to_thread(load_workable_demand_so_detail_upload)
    if not upload.get("available"):
        return {"available": False, "rows": [], "detail": "Upload a Workable Demand report to populate this table."}
    result = await asyncio.to_thread(workable_demand_skill_location, upload["headers"], upload["rows"])
    result["sourceFilename"] = upload.get("sourceFilename")
    result["database"] = {"table": upload.get("table"), "rowsSaved": upload.get("rowsSaved", 0)}
    return result


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


@app.post("/api/reports/frontier-security-defense/upload", tags=["Reports"])
async def upload_frontier_security_defense_workbook(workbook: UploadFile = File(...)) -> dict:
    try:
        source_filename = workbook.filename or ""
        parsed = await asyncio.to_thread(parse_frontier_security_defense_workbook, await workbook.read(), source_filename)
        metadata = await asyncio.to_thread(replace_frontier_security_defense_upload, source_filename, parsed)
        return {"available": metadata["available"], "sourceFilename": source_filename, "database": metadata, **parsed}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/reports/frontier-security-defense/current", tags=["Reports"])
async def current_frontier_security_defense_workbook() -> dict:
    return await asyncio.to_thread(load_frontier_security_defense_upload)


@app.post("/api/reports/frontier-models/upload", tags=["Reports"])
async def upload_frontier_models_workbook(workbook: UploadFile = File(...)) -> dict:
    try:
        source_filename = workbook.filename or ""
        parsed = await asyncio.to_thread(parse_frontier_models_workbook, await workbook.read(), source_filename)
        rows_saved = await asyncio.to_thread(replace_frontier_models_upload, parsed["headers"], parsed["rows"], source_filename)
        return {
            "available": rows_saved > 0,
            "sourceFilename": source_filename,
            "database": {"table": "frontier_models_upload", "rowsSaved": rows_saved, "sourceFilename": source_filename},
            **parsed,
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/reports/frontier-models/current", tags=["Reports"])
async def current_frontier_models_workbook() -> dict:
    return await asyncio.to_thread(load_frontier_models_upload)


@app.post("/api/reports/erosion/upload", tags=["Reports"])
async def upload_erosion_workbook(workbook: UploadFile = File(...)) -> dict:
    try:
        source_filename = workbook.filename or ""
        parsed = await asyncio.to_thread(parse_erosion_workbook, await workbook.read(), source_filename)
        rows_saved = await asyncio.to_thread(replace_erosion_upload, parsed["headers"], parsed["rows"], source_filename)
        return {
            "available": rows_saved > 0,
            "sourceFilename": source_filename,
            "database": {"table": "erosion_upload", "rowsSaved": rows_saved, "sourceFilename": source_filename},
            **parsed,
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/reports/erosion/current", tags=["Reports"])
async def current_erosion_workbook() -> dict:
    return await asyncio.to_thread(load_erosion_upload)


@app.post("/api/reports/workable-demand/upload", tags=["Reports"])
async def upload_workable_demand_workbook(workbook: UploadFile = File(...)) -> dict:
    try:
        source_filename = workbook.filename or ""
        parsed = await asyncio.to_thread(parse_workable_demand_workbook, await workbook.read(), source_filename)
        rows_saved = await asyncio.to_thread(replace_workable_demand_upload, parsed["headers"], parsed["rows"], source_filename)
        detail = parsed.get("detail")
        detail_rows_saved = 0
        if detail:
            detail_rows_saved = await asyncio.to_thread(
                replace_workable_demand_so_detail_upload,
                detail["headers"],
                detail["rows"],
                source_filename,
            )
        return {
            "available": rows_saved > 0,
            "sourceFilename": source_filename,
            "database": {"table": "workable_demand_upload", "rowsSaved": rows_saved, "sourceFilename": source_filename},
            "sheetName": parsed["sheetName"],
            "rowsSaved": rows_saved,
            "detailSheetName": detail["sheetName"] if detail else None,
            "detailRowsSaved": detail_rows_saved,
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/reports/workable-demand/current", tags=["Reports"])
async def current_workable_demand_workbook() -> dict:
    return await asyncio.to_thread(load_workable_demand_upload)


@app.get("/api/bcmi-orig/ra-summary", tags=["Reports"])
async def bcmi_orig_ra_summary() -> dict:
    """Use BCM and INS 2 SL_Forecast-2026 adjustment rows as RA values."""
    headers, rows, source_filename = await asyncio.to_thread(load_revenue_forecast)
    if not rows:
        return {"available": False, "metrics": {}}

    col_map = {header: index for index, header in enumerate(headers) if header}
    sls_column = _get_column(col_map, "SLS")
    slsm_column = _get_column(col_map, "SLSM")
    period_columns = {
        "aug": _get_column(col_map, "Serviceline_Aug 2026", "SL_Aug'26"),
        "q3": _get_column(col_map, "Q3'26 (SL)", "Q3 26 (SL)", "SL_Q3'26"),
        "q4": _get_column(col_map, "Q4'26 (SL)", "Q4 26 (SL)", "SL_Q4'26"),
        "year": _get_column(col_map, "FY 26 (SL)", "FY26 (SL)", "SL_FY'26"),
    }
    missing = [name for name, index in {"SLS": sls_column, "SLSM": slsm_column, **period_columns}.items() if index is None]
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing columns: {', '.join(missing)}")

    totals = {period: 0.0 for period in period_columns}
    for row in rows:
        sls = str(row[sls_column] if sls_column < len(row) else "").strip().casefold()
        slsm = str(row[slsm_column] if slsm_column < len(row) else "").strip().casefold()
        if sls != "adjustments" or slsm != "adjustments":
            continue
        for period, index in period_columns.items():
            totals[period] += _to_number(row[index] if index is not None and index < len(row) else 0)

    return {
        "available": True,
        "metrics": totals,
        "sourceFilename": source_filename,
        "filter": {"SLS": "Adjustments", "SLSM": "Adjustments"},
    }


@app.get("/api/bcmi-orig/ra-achieved", tags=["Reports"])
async def bcmi_orig_ra_achieved() -> dict:
    """Return converted RA achieved from the Q3 and Q4 Americas RA sheets."""
    upload = await asyncio.to_thread(load_ra_upload)
    if not upload.get("available"):
        return {"available": False, "metrics": {}}
    metrics = upload.get("convertedSoFar") or {}
    # Historic uploads do not retain the compact Converted so far summary,
    # but their detailed rows retain the conversion note.  Sum ADM, DE, and
    # QEA from those converted rows only when the workbook has no stored value
    # for that period.
    for sheet in upload.get("sheets") or []:
        period = "q3" if str(sheet.get("sheetName") or "").startswith("Q3") else "q4"
        if period in metrics:
            continue
        headers = sheet.get("headers") or []
        rows = sheet.get("rows") or []
        col_map = {str(header).strip(): index for index, header in enumerate(headers)}
        amount_columns = [_get_column(col_map, name) for name in ("ADM", "DE", "QEA")]
        if any(column is None for column in amount_columns):
            continue
        converted_rows = [
            row for row in rows
            if any("converted" in str(value or "").casefold() for value in row)
        ]
        if converted_rows:
            metrics[period] = sum(
                _to_number(_cell(row, column))
                for row in converted_rows
                for column in amount_columns
                if column is not None
            )
    return {
        "available": bool(metrics),
        "metrics": {period: _to_number(metrics.get(period)) for period in ("q3", "q4") if period in metrics},
        "sourceFilename": upload.get("sourceFilename"),
        "filter": "Converted so far: ADM + DE + QEA",
    }


@app.get("/api/bcmi-orig/erosion", tags=["Reports"])
async def bcmi_orig_erosion() -> dict:
    """Return the saved Erosion workbook as BCMI - Orig table rows."""
    upload = await asyncio.to_thread(load_erosion_upload)
    if not upload.get("available"):
        return {"available": False, "rows": [], "total": 0, "sourceFilename": None}

    headers = upload.get("headers", [])
    rows = upload.get("rows", [])
    # Workbooks uploaded before the header-row fix may have a title row stored
    # as generic columns followed by the actual Account/Q3/Q4 header row.
    if rows and not any(str(header).strip().casefold() == "account" for header in headers):
        candidate_headers = rows[0]
        if any(str(value or "").strip().casefold() == "account" for value in candidate_headers):
            headers = [str(value or "").strip() or f"Column {index + 1}" for index, value in enumerate(candidate_headers)]
            rows = rows[1:]
    col_map = {header: index for index, header in enumerate(headers) if header}
    account_column = _get_column(
        col_map,
        "Parent Account Name",
        "Financial Ultimate Parent Account",
        "Account Name",
        "Account",
    )
    description_column = _get_column(col_map, "Description", "Project Description", "Opportunity Name", "Erosion Description", "Details")
    amount_columns = [
        index
        for index, header in enumerate(headers)
        if "erosion" in str(header).casefold() or "amount" in str(header).casefold()
    ]
    if not amount_columns:
        amount_columns = [
            index
            for index, header in enumerate(headers)
            if str(header).strip().casefold() in {"q3", "q4", "q3'26", "q4'26"}
        ]
    if account_column is None or not amount_columns:
        raise HTTPException(status_code=400, detail="The Erosion workbook needs an Account column plus an Erosion, Amount, Q3, or Q4 column.")

    def amount(value: object) -> float:
        if isinstance(value, (int, float)):
            return float(value)
        text = str(value or "").replace("$", "").replace(",", "").strip().casefold()
        multiplier = 1.0
        if text.endswith("k"):
            multiplier = 1_000.0
            text = text[:-1]
        elif text.endswith("m"):
            multiplier = 1_000_000.0
            text = text[:-1]
        try:
            return float(text or 0) * multiplier
        except ValueError:
            return 0.0

    erosion_rows = [
        {
            "account": str(row[account_column] if account_column < len(row) else "").strip(),
            "description": str(row[description_column] if description_column is not None and description_column < len(row) else "").strip(),
            "amount": sum(amount(row[index] if index < len(row) else 0) for index in amount_columns),
        }
        for row in rows
        if str(row[account_column] if account_column < len(row) else "").strip()
    ]
    erosion_rows.sort(key=lambda row: abs(row["amount"]), reverse=True)
    return {
        "available": bool(erosion_rows),
        "rows": erosion_rows[:5],
        "total": sum(row["amount"] for row in erosion_rows),
        "sourceFilename": upload.get("sourceFilename"),
        "rowsSaved": upload.get("rowsSaved", 0),
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


def _bcmi_orig_top_opportunities_payload(headers: list[str], rows: list[list], source_filename: str | None) -> dict:
    """Build combined BCM + Insurance Top 10 lists for the BCMI - Orig periods."""
    if not rows:
        return {"available": False, "periods": {}, "database": {"table": "pipeline_upload + insurance_pipeline_upload", "rowsSaved": 0}}

    col_map = {header: index for index, header in enumerate(headers) if header}
    columns = {
        "estimatedClose": _get_column(col_map, "Estimated Deal Close Date"),
        "category": _get_column(col_map, "Opportunity Category"),
        "account": _get_column(col_map, "Financial Ultimate Parent Account", "Account Name"),
        "description": _get_column(col_map, "Opportunity Name"),
        "tcv": _get_column(col_map, "Net TCV Share (converted)", "Net TCV Share"),
    }
    missing = [name for name, index in columns.items() if index is None]
    if missing:
        raise ValueError(f"Missing columns: {', '.join(missing)}")

    period_months = {"aug": {8}, "q3": {7, 8, 9}, "q4": {10, 11, 12}}
    opportunities = {period: {} for period in period_months}
    for row in rows:
        category = str(row[columns["category"]] if columns["category"] is not None and columns["category"] < len(row) else "").strip().casefold()
        if category == "renewal at existing clients":
            continue
        close_date = _pipeline_date(row[columns["estimatedClose"]] if columns["estimatedClose"] is not None and columns["estimatedClose"] < len(row) else None)
        if close_date is None or close_date.year != 2026:
            continue
        account = str(row[columns["account"]] if columns["account"] is not None and columns["account"] < len(row) else "").strip()
        description = str(row[columns["description"]] if columns["description"] is not None and columns["description"] < len(row) else "").strip()
        # The same opportunity may appear in both uploaded pipeline sheets with
        # distinct internal IDs. Combine it for a single dashboard entry.
        key = f"{account}|{description}"
        tcv = _to_number(row[columns["tcv"]] if columns["tcv"] is not None and columns["tcv"] < len(row) else 0)
        for period, months in period_months.items():
            if close_date.month not in months:
                continue
            item = opportunities[period].setdefault(key, {"account": account, "description": description, "totalTcv": 0.0})
            item["totalTcv"] += tcv

    return {
        "available": True,
        "periods": {
            period: {
                "totalTcv": sum(item["totalTcv"] for item in items.values()),
                "rows": sorted(items.values(), key=lambda item: item["totalTcv"], reverse=True)[:10],
            }
            for period, items in opportunities.items()
        },
        "database": {"table": "pipeline_upload + insurance_pipeline_upload", "rowsSaved": len(rows), "sourceFilename": source_filename},
    }


@app.get("/api/bcmi-orig/top-opportunities", tags=["Pipeline"])
async def bcmi_orig_top_opportunities() -> dict:
    """Return combined BCM + Insurance pipeline Top 10 opportunities by TCV."""
    try:
        headers, rows, source_filename = await asyncio.to_thread(load_pipeline_upload)
        return await asyncio.to_thread(_bcmi_orig_top_opportunities_payload, headers, rows, source_filename)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/reports/export", tags=["Reports"])
async def export_dashboard_report() -> Response:
    demand = await asyncio.to_thread(_current_demand_creation_payload)
    try:
        revenue, ra, wins, opportunities, erosion = await asyncio.gather(
            bcmi_orig_revenue_summary(),
            bcmi_orig_ra_summary(),
            bcmi_orig_biweekly_wins(),
            bcmi_orig_top_opportunities(),
            bcmi_orig_erosion(),
        )
        await asyncio.to_thread(_refresh_quality_pipeline_uploads)
        quality_headers, quality_rows, quality_source = await asyncio.to_thread(load_quality_pipeline_upload)
        _all_headers, quality_all_rows, _all_source = await asyncio.to_thread(load_pipeline_upload)
        frontier_upload = await asyncio.to_thread(load_frontier_models_upload)
        quality = await asyncio.to_thread(_quality_pipeline_payload, quality_headers, quality_rows, quality_source, quality_all_rows, frontier_upload)
        report_bytes = await asyncio.to_thread(
            _create_report_presentation,
            {"demand": demand, "bcmi": {"revenue": revenue, "ra": ra, "wins": wins, "opportunities": opportunities, "erosion": erosion}, "quality": quality},
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=f"PowerPoint generation failed: {exc}") from exc
    return Response(
        content=report_bytes,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        headers={"Content-Disposition": 'attachment; filename="Sales_Dashboard_Report.pptx"'},
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
