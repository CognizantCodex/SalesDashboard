from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import main
from app import forecast_agent
from app.forecast_agent import analyze_forecast_rows, analyze_pipeline_rows, parse_target_pivot


client = TestClient(main.app)


FORECAST_HEADERS = [
    "SLSM",
    "SLS",
    "Practice Area",
    "Parent Account Name",
    "P&L Source",
    "P&L Header",
    "FY 26 (SL)",
    "Target 2026",
]
FORECAST_ROWS = [
    ["Alpha Manager", "Seller A", "Cloud", "Account 1", "IC/Forecasted", "Net Revenue", 1000, 0],
    ["Alpha Manager", "Seller A", "Cloud", "Account 1", "Budget", "Net Revenue", 0, 1500],
    ["Alpha Manager", "Seller B", "Data", "Account 2", "IC/Forecasted", "Net Revenue", 2000, 0],
    ["Alpha Manager", "Seller B", "Data", "Account 2", "Budget", "Net Revenue", 0, 2500],
    ["Beta Manager", "Seller C", "Cloud", "Account 3", "IC/Forecasted", "Net Revenue", 3000, 0],
]
PIPELINE_HEADERS = [
    "SLSM",
    "SLS",
    "Grouped Sales Stage",
    "EDC Year",
    "Net TCV Share",
    "Financial Ultimate Parent Account",
    "Practice Area",
    "Grouped Deal Type",
    "Sub-Status",
    "Is Active?",
    "Master Contract Opportunity",
    "Year Closed",
]
PIPELINE_ROWS = [
    ["Alpha Manager", "Seller A", "Qualified", 2026, 1_000_000, "Account 1", "Cloud", "New", "", "yes", "", 2026],
    ["Alpha Manager", "Seller B", "Un-Qualified", 2026, 2_000_000, "Account 2", "Data", "Renewal", "", "yes", "", 2026],
    ["Alpha Manager", "Seller B", "Won", 2026, 3_000_000, "Account 2", "Data", "Renewal", "", "yes", "", 2026],
    ["Alpha Manager", "Seller B", "Qualified", 2026, 4_000_000, "Account 2", "Data", "Renewal", "Pending Validation", "yes", "", 2026],
    ["Beta Manager", "Seller C", "Qualified", 2026, 5_000_000, "Account 3", "Cloud", "New", "", "yes", "", 2026],
]


def meta(available: bool = True, table: str = "table", rows: int = 3) -> dict:
    return {"available": available, "table": table, "rowsSaved": rows, "sourceFilename": "source.xlsx"}


def forecast_payload(name: str = "Seller A") -> dict:
    return {
        "available": True,
        "query": name,
        "matchedSlsNames": [name],
        "metrics": {
            "forecast": 1000,
            "target": 1500,
            "gap": 500,
            "accounts": 1,
            "rows": 1,
            "labels": {"forecast": "$1.0M", "target": "$1.5M", "gap": "$0.5M"},
            "status": "behind",
        },
        "accounts": [],
        "rows": [],
    }


def pipeline_payload(name: str = "Seller A", year: int = 2026) -> dict:
    return {
        "available": True,
        "query": name,
        "year": year,
        "matchedSlsNames": [name],
        "metrics": {
            "pipeline": 1_000_000,
            "qualified": 700_000,
            "unqualified": 300_000,
            "accounts": 1,
            "rows": 2,
            "labels": {"pipeline": "$1.0M", "qualified": "$0.7M", "unqualified": "$0.3M"},
        },
        "accounts": [],
        "rows": [],
    }


def won_payload(name: str = "Seller A", year: int = 2026) -> dict:
    return {
        "available": True,
        "query": name,
        "year": year,
        "matchedSlsNames": [name],
        "metrics": {
            "won": 2_000_000,
            "lost": 0,
            "total": 2_000_000,
            "rows": 1,
            "labels": {"total": "$2.0M", "won": "$2.0M", "lost": "$0.0M"},
        },
        "accounts": [],
        "rows": [],
    }


def pending_payload(name: str = "Seller A", year: int = 2026) -> dict:
    return {
        "available": True,
        "query": name,
        "year": year,
        "matchedSlsNames": [name],
        "metrics": {
            "pendingValidation": 500_000,
            "rows": 1,
            "labels": {"pendingValidation": "$0.5M"},
        },
        "accounts": [],
        "rows": [],
    }


def upload_file() -> dict:
    return {"workbook": ("book.xlsx", b"workbook-bytes", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}


@pytest.fixture
def patched_storage(monkeypatch):
    monkeypatch.setattr(main, "load_revenue_forecast", lambda: (FORECAST_HEADERS, FORECAST_ROWS, "revenue.xlsx"))
    monkeypatch.setattr(main, "load_slsm_revenue_forecast", lambda: (FORECAST_HEADERS, FORECAST_ROWS, "slsm-revenue.xlsx"))
    monkeypatch.setattr(main, "load_pipeline_upload", lambda: (PIPELINE_HEADERS, PIPELINE_ROWS, "pipeline.xlsx"))
    monkeypatch.setattr(main, "load_slsm_pipeline_upload", lambda: (PIPELINE_HEADERS, PIPELINE_ROWS, "slsm-pipeline.xlsx"))
    return monkeypatch


@pytest.fixture
def patched_analyzers(monkeypatch):
    monkeypatch.setattr(main, "analyze_forecast_rows", lambda rows, col_map, name, person_column="SLS": forecast_payload(name))
    monkeypatch.setattr(main, "analyze_pipeline_rows", lambda rows, col_map, name, year=None, person_column="SLS": pipeline_payload(name, year or 2026))
    monkeypatch.setattr(main, "analyze_won_lost_rows", lambda rows, col_map, name, year=None, person_column="SLS": won_payload(name, year or 2026))
    monkeypatch.setattr(main, "analyze_pending_validation_rows", lambda rows, col_map, name, year=None, person_column="SLS": pending_payload(name, year or 2026))
    return monkeypatch


def test_health_and_swagger_include_all_api_routes():
    assert client.get("/health").json()["ok"] is True

    docs_response = client.get("/docs")
    assert docs_response.status_code == 200
    assert "swagger-ui" in docs_response.text.lower()

    spec = client.get("/openapi.json").json()
    documented_paths = set(spec["paths"])
    expected_paths = {
        route.path
        for route in main.app.routes
        if route.path.startswith("/api/") or route.path == "/health"
    }
    assert expected_paths <= documented_paths
    assert spec["info"]["title"] == "SLS Forecast Agent"
    documented_tags = {tag["name"] for tag in spec["tags"]}
    assert {"Forecast", "SLSM Forecast", "SLSL Summary", "SLSM Breakdown", "Pipeline", "Targets"} <= documented_tags
    for path in expected_paths:
        for operation in spec["paths"][path].values():
            assert operation["tags"]


def test_metadata_endpoints_and_slsm_fallbacks(monkeypatch):
    monkeypatch.setattr(main, "load_revenue_forecast_metadata", lambda: meta(True, "revenue_forecast", 10))
    monkeypatch.setattr(main, "load_pipeline_upload_metadata", lambda: meta(True, "pipeline_upload", 9))
    monkeypatch.setattr(main, "load_wins_lost_metadata", lambda: meta(True, "wins_lost", 8))
    monkeypatch.setattr(main, "load_pending_validation_metadata", lambda: meta(True, "pending_validation", 7))
    monkeypatch.setattr(main, "load_slsm_revenue_forecast_metadata", lambda: meta(False, "slsm_revenue_forecast", 0))
    monkeypatch.setattr(main, "load_slsm_pipeline_upload_metadata", lambda: meta(False, "slsm_pipeline_upload", 0))
    monkeypatch.setattr(main, "load_slsm_wins_lost_metadata", lambda: meta(False, "slsm_wins_lost", 0))
    monkeypatch.setattr(main, "load_slsm_pending_validation_metadata", lambda: meta(False, "slsm_pending_validation", 0))

    assert client.get("/api/forecast/current/metadata").json()["database"]["table"] == "revenue_forecast"
    assert client.get("/api/pipeline/upload/metadata").json()["database"]["rowsSaved"] == 9
    assert client.get("/api/wins-lost/upload/metadata").json()["database"]["table"] == "wins_lost"
    assert client.get("/api/pending-validation/upload/metadata").json()["database"]["table"] == "pending_validation"

    slsm_forecast = client.get("/api/slsm/forecast/current/metadata").json()["database"]
    assert slsm_forecast["sharedFrom"] == "sls"
    assert client.get("/api/slsm/pipeline/upload/metadata").json()["database"]["sharedFrom"] == "sls"
    assert client.get("/api/slsm/wins-lost/upload/metadata").json()["database"]["sharedFrom"] == "sls"
    assert client.get("/api/slsm/pending-validation/upload/metadata").json()["database"]["sharedFrom"] == "sls"


def test_target_parser_extracts_sls_and_account_rows(monkeypatch):
    monkeypatch.setattr(
        forecast_agent,
        "_read_sheet",
        lambda *_args: [
            ["SLSM", "(All)"],
            [],
            ["Row Labels", " Rev-ADM", " OM %-ADM", " TCV-ADM"],
            ["Seller A", 10_500_000, 0.25, 20_000_000],
            ["S1.917-US Bank", 10_500_000, 0.25, 20_000_000],
            ["2002577 - U.S.BANCORP", 7_000_000, 0.3, 15_000_000],
            ["2003000 - Account Detail", 3_500_000, 0.2, 5_000_000],
            ["Seller B", 2_000_000, 0.1, 8_000_000],
            ["Grand Total", 12_500_000, 0.2, 28_000_000],
        ],
    )

    payload = parse_target_pivot(b"bytes", "targets.xlsb")

    assert payload["metrics"] == ["Rev-ADM", "OM %-ADM", "TCV-ADM"]
    assert [row["slsName"] for row in payload["slsRows"]] == ["Seller A", "Seller B"]
    assert [row["accountName"] for row in payload["accountRows"]] == [
        "U.S.BANCORP",
        "Account Detail",
        "Total",
    ]
    assert payload["accountRows"][0]["groupName"] == "S1.917-US Bank"
    assert payload["accountRows"][0]["labels"]["Rev-ADM"] == "$7.0M"
    assert payload["accountRows"][0]["labels"]["OM %-ADM"] == "30.0%"


def test_target_parser_uses_data_sheet_for_account_level_rows(monkeypatch):
    def read_sheet(_bytes, _filename, sheet_name):
        if sheet_name == "Data":
            return [
                [None, "BU", "SBU1", "Parent ID", "Parent Name", "SLSM", "SLS", "Rev-ADM", "Rev-SPE", "OM-ADM", "OM-SPE", "OM%-ADM", "OM%-SPE", "TCV-ADM", "TCV-SPE", "ACV-ADM", "ACV-SPE"],
                [None, "BU", "S1.902-Banks 1", 2000361, "2000361 - BLOOMBERG", "Manager", "Seller A", 2_000_000, 5_000_000, 400_000, 1_000_000, 0.2, 0.2, 3_000_000, 7_000_000, 1_500_000, 4_000_000],
                [None, "BU", "S1.902-Banks 1", 2000417, "2000417 - BROADRIDGE FINANCIAL", "Manager", "Seller A", 1_000_000, 2_000_000, 100_000, 300_000, 0.1, 0.15, 2_000_000, 4_000_000, 900_000, 2_500_000],
            ]
        return [
            ["Row Labels", " Rev-ADM", " Rev-SPE", " OM %-ADM", " OM %-SPE", " TCV-ADM", " TCV-SPE", " ACV-ADM", " ACV-SPE"],
            ["Seller A", 3_000_000, 7_000_000, 0.1667, 0.1857, 5_000_000, 11_000_000, 2_400_000, 6_500_000],
            ["Grand Total", 3_000_000, 7_000_000, 0.1667, 0.1857, 5_000_000, 11_000_000, 2_400_000, 6_500_000],
        ]

    monkeypatch.setattr(forecast_agent, "_read_sheet", read_sheet)

    payload = parse_target_pivot(b"bytes", "targets.xlsb")

    assert [row["accountName"] for row in payload["accountRows"]] == [
        "BLOOMBERG",
        "BROADRIDGE FINANCIAL",
    ]
    assert payload["accountRows"][0]["groupName"] == "S1.902-Banks 1"
    assert payload["accountRows"][0]["labels"]["TCV-SPE"] == "$7.0M"
    assert payload["accountRows"][0]["labels"]["OM %-ADM"] == "20.0%"


def test_target_current_upload_and_account_endpoints(monkeypatch):
    target_metadata = {
        "available": True,
        "table": "target_upload",
        "rowsSaved": 2,
        "sourceFilename": "targets.xlsb",
        "sheet": "SLM-SLS-Pivot",
        "slsCount": 1,
        "accountCount": 2,
        "metrics": ["Rev-ADM"],
    }
    target_rows = [{"slsName": "Seller A", "metrics": {"Rev-ADM": 10}, "labels": {"Rev-ADM": "$10.0M"}}]
    account_rows = [
        {"slsName": "Seller A", "accountName": "Account A", "metrics": {"Rev-ADM": 10}, "labels": {"Rev-ADM": "$10.0M"}},
        {"slsName": "Seller A + Seller B", "accountName": "Combination Account", "metrics": {"Rev-ADM": 4}, "labels": {"Rev-ADM": "$4.0M"}},
        {"slsName": "Other Seller", "accountName": "Other Account", "metrics": {"Rev-ADM": 1}, "labels": {"Rev-ADM": "$1.0M"}},
    ]
    monkeypatch.setattr(main, "load_target_upload_metadata", lambda: target_metadata)
    monkeypatch.setattr(main, "load_target_sls_summary", lambda: target_rows)
    monkeypatch.setattr(main, "load_target_accounts", lambda: account_rows)
    monkeypatch.setattr(
        main,
        "parse_target_pivot",
        lambda *_args: {
            "sheetName": "SLM-SLS-Pivot",
            "metrics": ["Rev-ADM"],
            "slsRows": target_rows,
            "accountRows": account_rows,
        },
    )
    monkeypatch.setattr(main, "replace_target_upload", lambda *_args: target_metadata)

    assert client.get("/api/targets/upload/metadata").json()["database"]["table"] == "target_upload"
    current = client.get("/api/targets/current").json()
    assert current["metrics"] == ["Rev-ADM"]
    assert current["rows"][0]["slsName"] == "Seller A"
    accounts = client.get("/api/targets/accounts/current", params={"slsName": "Seller A"}).json()
    assert accounts["rows"][0]["accountName"] == "Account A"
    assert [row["accountName"] for row in accounts["rows"]] == ["Account A", "Combination Account"]
    assert accounts["matchedSlsNames"] == ["Seller A", "Seller A + Seller B"]
    upload = client.post("/api/targets/upload", files=upload_file()).json()
    assert upload["database"]["sourceFilename"] == "targets.xlsb"


def test_target_endpoints_handle_missing_data_and_parse_errors(monkeypatch):
    monkeypatch.setattr(main, "load_target_upload_metadata", lambda: {"available": False, "table": "target_upload", "rowsSaved": 0})

    assert client.get("/api/targets/current").json()["available"] is False
    assert client.get("/api/targets/accounts/current", params={"slsName": ""}).status_code == 400

    monkeypatch.setattr(main, "parse_target_pivot", lambda *args: (_ for _ in ()).throw(ValueError("target parse failed")))
    assert client.post("/api/targets/upload", files=upload_file()).status_code == 400


def test_current_forecast_and_options_endpoints(patched_storage, patched_analyzers, monkeypatch):
    response = client.get("/api/forecast/current", params={"slsName": "Seller A"})
    assert response.status_code == 200
    assert response.json()["database"]["rowsSaved"] == len(FORECAST_ROWS)

    response = client.get("/api/slsm/forecast/current", params={"slsmName": "Alpha Manager"})
    assert response.status_code == 200
    assert response.json()["database"]["table"] == "revenue_forecast"

    response = client.get("/api/slsm/forecast/options/current")
    assert response.status_code == 200
    assert response.json()["options"] == ["Alpha Manager", "Beta Manager"]

    monkeypatch.setattr(main, "load_slsm_revenue_forecast", lambda: ([], [], None))
    response = client.get("/api/slsm/forecast/options/current")
    assert response.status_code == 200
    assert response.json()["database"]["table"] == "revenue_forecast"


def test_current_endpoints_return_unavailable_when_storage_empty(monkeypatch):
    monkeypatch.setattr(main, "load_revenue_forecast", lambda: ([], [], None))
    monkeypatch.setattr(main, "load_slsm_revenue_forecast", lambda: ([], [], None))
    monkeypatch.setattr(main, "load_pipeline_upload", lambda: ([], [], None))
    monkeypatch.setattr(main, "load_slsm_pipeline_upload", lambda: ([], [], None))

    assert client.get("/api/forecast/current").json()["available"] is False
    assert client.get("/api/slsm/forecast/current", params={"slsmName": "Alpha Manager"}).json()["available"] is False
    assert client.get("/api/slsm/forecast/options/current").json()["available"] is False
    assert client.get("/api/pipeline/summary/current", params={"slsName": "Seller A"}).json()["available"] is False
    assert client.get("/api/slsm/pipeline/summary/current", params={"slsmName": "Alpha Manager"}).json()["available"] is False
    assert client.get("/api/won-lost/summary/current", params={"slsName": "Seller A"}).json()["available"] is False
    assert client.get("/api/slsm/won-lost/summary/current", params={"slsmName": "Alpha Manager"}).json()["available"] is False
    assert client.get("/api/pending-validation/summary/current", params={"slsName": "Seller A"}).json()["available"] is False
    assert client.get("/api/slsm/pending-validation/summary/current", params={"slsmName": "Alpha Manager"}).json()["available"] is False


def test_current_pipeline_tcv_endpoints(patched_storage, patched_analyzers):
    endpoints = [
        ("/api/pipeline/summary/current", {"slsName": "Seller A"}, "pipeline_upload"),
        ("/api/slsm/pipeline/summary/current", {"slsmName": "Alpha Manager"}, "slsm_pipeline_upload"),
        ("/api/won-lost/summary/current", {"slsName": "Seller A"}, "pipeline_upload"),
        ("/api/slsm/won-lost/summary/current", {"slsmName": "Alpha Manager"}, "slsm_pipeline_upload"),
        ("/api/pending-validation/summary/current", {"slsName": "Seller A"}, "pipeline_upload"),
        ("/api/slsm/pending-validation/summary/current", {"slsmName": "Alpha Manager"}, "slsm_pipeline_upload"),
    ]
    for path, params, table in endpoints:
        response = client.get(path, params={**params, "currentYear": 2026})
        assert response.status_code == 200
        assert response.json()["database"]["table"] == table


def test_pipeline_accepts_group_deal_type_header_variant():
    headers = [
        "SLS",
        "Grouped Sales Stage",
        "EDC Year",
        "Net TCV Share",
        "Financial Ultimate Parent Account",
        "Practice Area",
        "Group Deal Type",
    ]
    rows = [["Seller A", "Qualified", 2026, 1_000_000, "Account 1", "Cloud", "New"]]
    col_map = {header: index for index, header in enumerate(headers)}

    result = analyze_pipeline_rows(rows, col_map, "Seller A", 2026)

    assert result["metrics"]["pipeline"] == 1_000_000
    assert result["rows"][0]["dealType"] == "New"


def test_forecast_accepts_report_style_revenue_columns_without_target():
    headers = [
        "SLS",
        "Practice",
        "Financial Ultimate Parent Account",
        "CY $",
    ]
    rows = [["Seller A", "QEA", "Account 1", 400_000]]
    col_map = {header: index for index, header in enumerate(headers)}

    result = analyze_forecast_rows(rows, col_map, "Seller A")

    assert result["metrics"]["forecast"] == 400
    assert result["metrics"]["target"] == 0
    assert result["accounts"][0]["account"] == "Account 1"
    assert result["accounts"][0]["practices"][0]["practice"] == "QEA"


def test_forecast_accepts_wrapped_excel_revenue_headers():
    headers = [
        "SLS",
        "Practice Area",
        "Parent\nAccount Name",
        "P&L Source",
        "P&L Header",
        "FY 26\n(SL)",
        "Target\u00a02026",
    ]
    rows = [
        ["Seller A", "Cloud", "Account 1", "IC/Forecasted", "Net Revenue", 1000, 0],
        ["Seller A", "Cloud", "Account 1", "Budget", "Net Revenue", 0, 1500],
    ]
    col_map = {header: index for index, header in enumerate(headers)}

    result = analyze_forecast_rows(rows, col_map, "Seller A")

    assert result["metrics"]["forecast"] == 1000
    assert result["metrics"]["target"] == 1500
    assert result["accounts"][0]["account"] == "Account 1"


def test_forecast_includes_individual_revenue_for_combined_sls_assignment():
    headers = [
        "SLS",
        "Practice Area",
        "Parent Account Name",
        "P&L Source",
        "P&L Header",
        "FY 26 (SL)",
        "Target 2026",
    ]
    rows = [
        ["Ali, Afzal", "Cloud", "U.S.BANCORP", "IC/Forecasted", "Net Revenue", 98_650, 0],
        ["Ali, Afzal - Das,Somnath", "Cloud", "U.S.BANCORP", "Budget", "Net Revenue", 0, 100_640],
    ]
    col_map = {header: index for index, header in enumerate(headers)}

    result = analyze_forecast_rows(rows, col_map, "Ali, Afzal - Das,Somnath")

    assert result["matchedSlsNames"] == ["Ali, Afzal", "Ali, Afzal - Das,Somnath"]
    assert result["metrics"]["forecast"] == 98_650
    assert result["metrics"]["target"] == 100_640
    assert result["accounts"][0]["account"] == "U.S.BANCORP"


def test_forecast_partial_sls_search_includes_same_account_combined_assignment():
    headers = [
        "SLS",
        "Practice Area",
        "Parent Account Name",
        "P&L Source",
        "P&L Header",
        "FY 26 (SL)",
        "Target 2026",
    ]
    rows = [
        ["Ali, Afzal", "Cloud", "U.S.BANCORP", "IC/Forecasted", "Net Revenue", 98_650, 0],
        ["Ali, Afzal - Das,Somnath", "Cloud", "U.S.BANCORP", "Budget", "Net Revenue", 0, 100_640],
        ["Ali, Afzal", "Cloud", "Unrelated Account", "IC/Forecasted", "Net Revenue", 12_000, 0],
    ]
    col_map = {header: index for index, header in enumerate(headers)}

    result = analyze_forecast_rows(rows, col_map, "som")

    assert result["metrics"]["forecast"] == 98_650
    assert result["metrics"]["target"] == 100_640
    assert [account["account"] for account in result["accounts"]] == ["U.S.BANCORP"]


def test_pipeline_allows_missing_deal_type_column():
    headers = [
        "SLS",
        "Grouped Sales Stage",
        "EDC Year",
        "Net TCV Share",
        "Financial Ultimate Parent Account",
        "Practice Area",
    ]
    rows = [["Seller A", "Qualified", 2026, 1_000_000, "Account 1", "Cloud"]]
    col_map = {header: index for index, header in enumerate(headers)}

    result = analyze_pipeline_rows(rows, col_map, "Seller A", 2026)

    assert result["metrics"]["pipeline"] == 1_000_000
    assert result["rows"][0]["dealType"] == "Unspecified"


def test_value_errors_are_returned_as_400(patched_storage, monkeypatch):
    def fail(*args, **kwargs):
        raise ValueError("bad workbook")

    monkeypatch.setattr(main, "analyze_forecast_rows", fail)
    assert client.get("/api/forecast/current", params={"slsName": "Seller A"}).status_code == 400

    monkeypatch.setattr(main, "analyze_pipeline_rows", fail)
    assert client.get("/api/pipeline/summary/current", params={"slsName": "Seller A"}).status_code == 400

    monkeypatch.setattr(main, "analyze_won_lost_rows", fail)
    assert client.get("/api/won-lost/summary/current", params={"slsName": "Seller A"}).status_code == 400

    monkeypatch.setattr(main, "analyze_pending_validation_rows", fail)
    assert client.get("/api/pending-validation/summary/current", params={"slsName": "Seller A"}).status_code == 400


def test_parse_based_post_endpoints(monkeypatch, patched_analyzers):
    def parse(file_bytes, filename, sheet_name):
        if sheet_name == "Wins":
            return PIPELINE_HEADERS, PIPELINE_ROWS[:1], {header: index for index, header in enumerate(PIPELINE_HEADERS)}
        if sheet_name == "Pending Validation":
            return PIPELINE_HEADERS, PIPELINE_ROWS[3:4], {header: index for index, header in enumerate(PIPELINE_HEADERS)}
        if sheet_name == main.SLSM_FORECAST_SHEET:
            return FORECAST_HEADERS, FORECAST_ROWS, {header: index for index, header in enumerate(FORECAST_HEADERS)}
        return PIPELINE_HEADERS, PIPELINE_ROWS, {header: index for index, header in enumerate(PIPELINE_HEADERS)}

    monkeypatch.setattr(main, "parse_workbook", parse)
    monkeypatch.setattr(main, "replace_pipeline_upload", lambda headers, rows, filename: len(rows))
    monkeypatch.setattr(main, "replace_slsm_pipeline_upload", lambda headers, rows, filename: len(rows))
    monkeypatch.setattr(main, "replace_wins_lost", lambda headers, rows, filename: len(rows))
    monkeypatch.setattr(main, "replace_slsm_wins_lost", lambda headers, rows, filename: len(rows))
    monkeypatch.setattr(main, "replace_pending_validation", lambda headers, rows, filename: len(rows))
    monkeypatch.setattr(main, "replace_slsm_pending_validation", lambda headers, rows, filename: len(rows))
    monkeypatch.setattr(main, "replace_revenue_forecast", lambda headers, rows, filename: len(rows))
    monkeypatch.setattr(main, "replace_slsm_revenue_forecast", lambda headers, rows, filename: len(rows))
    monkeypatch.setattr(main, "result_to_csv", lambda result: "account,forecast\nA,1\n")

    assert client.post("/api/slsm/forecast/options", files=upload_file()).json()["options"] == ["Alpha Manager", "Beta Manager"]
    forecast_upload = client.post("/api/forecast/upload", files=upload_file()).json()
    assert forecast_upload["database"]["rowsSaved"] == len(PIPELINE_ROWS)
    assert forecast_upload["database"]["slsmRowsSaved"] == len(FORECAST_ROWS)
    slsm_forecast_upload = client.post("/api/slsm/forecast/upload", files=upload_file()).json()
    assert slsm_forecast_upload["database"]["table"] == "slsm_revenue_forecast"
    assert client.post("/api/pipeline/upload", files=upload_file()).json()["database"]["rowsSaved"] == len(PIPELINE_ROWS)
    assert client.post("/api/slsm/pipeline/upload", files=upload_file()).json()["database"]["table"] == "slsm_pipeline_upload"
    assert client.post("/api/pipeline/summary", data={"slsName": "Seller A"}, files=upload_file()).json()["metrics"]["pipeline"] == 1_000_000
    assert client.post("/api/slsm/pipeline/summary", data={"slsmName": "Alpha Manager"}, files=upload_file()).json()["metrics"]["pipeline"] == 1_000_000

    forecast = client.post("/api/forecast/analyze", data={"slsName": "Seller A"}, files=upload_file()).json()
    assert forecast["database"]["table"] == "revenue_forecast"
    slsm_forecast = client.post("/api/slsm/forecast/analyze", data={"slsmName": "Alpha Manager"}, files=upload_file()).json()
    assert slsm_forecast["database"]["table"] == "slsm_revenue_forecast"

    export_response = client.post("/api/forecast/export.csv", data={"slsName": "Seller A"}, files=upload_file())
    assert export_response.status_code == 200
    assert export_response.headers["content-disposition"].endswith('Seller_A_Forecast_2026.csv"')
    assert "account,forecast" in export_response.text


def test_parse_errors_on_post_endpoints(monkeypatch):
    monkeypatch.setattr(main, "parse_workbook", lambda *args, **kwargs: (_ for _ in ()).throw(ValueError("parse failed")))

    post_cases = [
        ("/api/slsm/forecast/options", {}),
        ("/api/forecast/upload", {}),
        ("/api/slsm/forecast/upload", {}),
        ("/api/pipeline/upload", {}),
        ("/api/slsm/pipeline/upload", {}),
        ("/api/pipeline/summary", {"slsName": "Seller A"}),
        ("/api/slsm/pipeline/summary", {"slsmName": "Alpha Manager"}),
        ("/api/forecast/analyze", {"slsName": "Seller A"}),
        ("/api/slsm/forecast/analyze", {"slsmName": "Alpha Manager"}),
        ("/api/forecast/export.csv", {"slsName": "Seller A"}),
    ]
    for path, data in post_cases:
        assert client.post(path, data=data, files=upload_file()).status_code == 400


def test_upload_side_sheets_are_optional(monkeypatch):
    def parse(file_bytes, filename, sheet_name):
        if sheet_name in {"Wins", "Pending Validation"}:
            raise ValueError("missing optional sheet")
        return PIPELINE_HEADERS, PIPELINE_ROWS, {header: index for index, header in enumerate(PIPELINE_HEADERS)}

    monkeypatch.setattr(main, "parse_workbook", parse)
    monkeypatch.setattr(main, "replace_pipeline_upload", lambda headers, rows, filename: len(rows))
    monkeypatch.setattr(main, "replace_slsm_pipeline_upload", lambda headers, rows, filename: len(rows))

    payload = client.post("/api/pipeline/upload", files=upload_file()).json()
    assert payload["database"]["winsLostRowsSaved"] == 0
    assert payload["database"]["pendingValidationRowsSaved"] == 0

    payload = client.post("/api/slsm/pipeline/upload", files=upload_file()).json()
    assert payload["database"]["winsLostRowsSaved"] == 0
    assert payload["database"]["pendingValidationRowsSaved"] == 0


def test_build_slsl_and_slsm_breakdown_use_real_aggregators(patched_storage):
    slsl = client.get("/api/slsl/summary/current", params={"currentYear": 2026}).json()
    assert slsl["available"] is True
    assert [row["slsmName"] for row in slsl["rows"]] == ["Alpha Manager", "Beta Manager"]
    assert slsl["rows"][0]["pipeline"]["pipeline"] == 7_000_000

    breakdown = client.get(
        "/api/slsm/sls-breakdown/current",
        params={"slsmName": "Alpha Manager", "currentYear": 2026},
    ).json()
    assert breakdown["available"] is True
    assert [row["slsName"] for row in breakdown["rows"]] == ["Seller A", "Seller B"]
    assert breakdown["rows"][1]["realizedTcv"]["pendingValidation"] == 4_000_000


def test_slsm_pivot_rows_are_normalized_for_options_and_slsl_revenue(patched_storage, monkeypatch):
    headers = [f"Column {index}" for index in range(1, 8)]
    rows = [
        [None] * 7,
        ["SLSM", "SLS", "Parent Account Name", "Practice Area", "SL_FY'26", "Target-2026", "FY'26-Gap SL"],
        ["Alpha Manager", "Seller A", "Account A", None, 1_200, 1_500, 300],
        [None, "Seller B", "Account B", None, 800, 1_000, 200],
        ["Alpha Manager Total", None, None, None, 2_000, 2_500, 500],
        ["Grand Total", None, None, None, 2_000, 2_500, 500],
    ]
    monkeypatch.setattr(main, "load_slsm_revenue_forecast", lambda: (headers, rows, "pivot.xlsx"))
    monkeypatch.setattr(main, "load_slsm_pipeline_upload", lambda: ([], [], None))
    monkeypatch.setattr(main, "load_pipeline_upload", lambda: ([], [], None))

    options = client.get("/api/slsm/forecast/options/current").json()
    assert options["available"] is True
    assert options["options"] == ["Alpha Manager", "Beta Manager"]

    summary = client.get("/api/slsl/summary/current", params={"currentYear": 2026}).json()
    assert summary["rows"][0]["revenue"]["forecast"] == 3_000
    assert summary["rows"][0]["revenue"]["target"] == 4_000

    forecast = client.get("/api/slsm/forecast/current", params={"slsmName": "Alpha Manager"}).json()
    assert forecast["database"]["table"] == "revenue_forecast"
    assert forecast["metrics"]["forecast"] == 3_000


def test_slsm_uses_saved_revenue_when_the_pivot_omits_a_manager(patched_storage, monkeypatch):
    pivot_headers = ["SLSM", "SLS", "Parent Account Name", "SL_FY'26", "Target-2026"]
    pivot_rows = [["Alpha Manager", "Seller A", "Account A", 1_000, 1_500]]
    monkeypatch.setattr(main, "load_slsm_revenue_forecast", lambda: (pivot_headers, pivot_rows, "pivot.xlsx"))
    monkeypatch.setattr(main, "load_slsm_pipeline_upload", lambda: ([], [], None))
    monkeypatch.setattr(main, "load_pipeline_upload", lambda: ([], [], None))

    options = client.get("/api/slsm/forecast/options/current").json()
    assert options["options"] == ["Alpha Manager", "Beta Manager"]

    summary = client.get("/api/slsl/summary/current", params={"currentYear": 2026}).json()
    beta = next(row for row in summary["rows"] if row["slsmName"] == "Beta Manager")
    assert beta["revenue"]["forecast"] == 3_000

    forecast = client.get("/api/slsm/forecast/current", params={"slsmName": "Beta Manager"}).json()
    assert forecast["database"]["table"] == "revenue_forecast"
    assert forecast["metrics"]["forecast"] == 3_000


def test_slsm_breakdown_requires_name_and_handles_missing_child_columns(patched_storage, monkeypatch):
    assert client.get("/api/slsm/sls-breakdown/current", params={"slsmName": ""}).status_code == 400

    headers = [header for header in FORECAST_HEADERS if header != "SLS"]
    rows = [[cell for index, cell in enumerate(row) if FORECAST_HEADERS[index] != "SLS"] for row in FORECAST_ROWS]
    monkeypatch.setattr(main, "load_slsm_revenue_forecast", lambda: (headers, rows, "no-sls.xlsx"))
    monkeypatch.setattr(main, "load_revenue_forecast", lambda: (headers, rows, "no-sls.xlsx"))
    monkeypatch.setattr(main, "load_slsm_pipeline_upload", lambda: ([], [], None))
    monkeypatch.setattr(main, "load_pipeline_upload", lambda: ([], [], None))
    response = client.get("/api/slsm/sls-breakdown/current", params={"slsmName": "Alpha Manager"})
    assert response.status_code == 200
    assert response.json()["rows"] == []


def test_slsm_breakdown_does_not_duplicate_combined_sls_assignments(monkeypatch):
    revenue_headers = ["SLSM", "SLS", "Practice Area", "Parent Account Name", "FY 26 (SL)", "Target 2026"]
    revenue_rows = [
        ["Alpha Manager", "Seller A", "Cloud", "Account A", 1_000, 1_200],
        ["Alpha Manager", "Seller A + Seller B", "Cloud", "Account B", 2_000, 2_100],
        ["Alpha Manager", "Seller B", "Cloud", "Account C", 3_000, 3_100],
    ]
    pipeline_rows = [
        ["Alpha Manager", "Seller A", "Won", 2026, 1_000_000, "Account A", "Cloud", "New", "", "yes", "", 2026],
        ["Alpha Manager", "Seller A + Seller B", "Won", 2026, 2_000_000, "Account B", "Cloud", "New", "", "yes", "", 2026],
        ["Alpha Manager", "Seller B", "Won", 2026, 3_000_000, "Account C", "Cloud", "New", "", "yes", "", 2026],
    ]
    monkeypatch.setattr(main, "load_slsm_revenue_forecast", lambda: (revenue_headers, revenue_rows, "revenue.xlsx"))
    monkeypatch.setattr(main, "load_revenue_forecast", lambda: (revenue_headers, revenue_rows, "revenue.xlsx"))
    monkeypatch.setattr(main, "load_slsm_pipeline_upload", lambda: (PIPELINE_HEADERS, pipeline_rows, "pipeline.xlsx"))
    monkeypatch.setattr(main, "load_pipeline_upload", lambda: (PIPELINE_HEADERS, pipeline_rows, "pipeline.xlsx"))

    summary = client.get("/api/slsl/summary/current", params={"currentYear": 2026}).json()["rows"][0]
    breakdown = client.get(
        "/api/slsm/sls-breakdown/current",
        params={"slsmName": "Alpha Manager", "currentYear": 2026},
    ).json()

    assert sum(row["revenue"]["target"] for row in breakdown["rows"]) == summary["revenue"]["target"]
    assert sum(row["realizedTcv"]["total"] for row in breakdown["rows"]) == summary["realizedTcv"]["total"]
    assert sum(row["realizedTcv"]["won"] for row in breakdown["rows"]) == summary["realizedTcv"]["won"]


def test_private_helpers():
    assert main._money_label(1_500_000) == "$1.5M"
    assert main._empty_money_labels("a", "b") == {"a": "$0.0M", "b": "$0.0M"}
    assert main._column_index(["A", "B"], "C", "B") == 1
    assert main._cell(["x"], 4) is None
    assert main._person_index(["SLSM Name"], "SLSM") == 0
    rows = [["Alpha Manager", "Seller A"], ["Beta Manager", "Seller B"]]
    assert main._filter_rows_by_person(rows, ["SLSM", "SLS"], "alpha manager", "SLSM") == [["Alpha Manager", "Seller A"]]
    assert main._unique_child_people(rows, ["SLSM", "SLS"], "SLS") == {"Seller A", "Seller B"}
