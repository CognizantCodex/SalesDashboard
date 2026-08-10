from __future__ import annotations

import json
import os
import sqlite3
from datetime import date, datetime
from pathlib import Path
from typing import Any


DATABASE_PATH = Path(
    os.environ.get("SALES_DASHBOARD_DB_PATH", Path(__file__).resolve().parent.parent / "sales_dashboard.db")
)
SYSTEM_COLUMNS = {"id", "source_filename", "row_number"}
PIPELINE_UPLOAD_TABLE = "pipeline_upload"
WINS_LOST_TABLE = "wins_lost"
PENDING_VALIDATION_TABLE = "pending_validation"
SLSM_REVENUE_FORECAST_TABLE = "slsm_revenue_forecast"
SLSM_PIPELINE_UPLOAD_TABLE = "slsm_pipeline_upload"
SLSM_WINS_LOST_TABLE = "slsm_wins_lost"
SLSM_PENDING_VALIDATION_TABLE = "slsm_pending_validation"
TARGET_UPLOAD_TABLE = "target_upload"
TARGET_SLS_TABLE = "target_sls"
TARGET_ACCOUNT_TABLE = "target_accounts"
DEMAND_CREATION_TABLE = "demand_creation_upload"


def replace_revenue_forecast(headers: list[str], rows: list[list[Any]], source_filename: str, table_name: str = "revenue_forecast") -> int:
    columns = _unique_column_names(headers)
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)

    with sqlite3.connect(DATABASE_PATH) as conn:
        conn.execute(f"DROP TABLE IF EXISTS {_quote_identifier(table_name)}")
        conn.execute(_create_table_sql(table_name, columns))

        if rows:
            placeholders = ", ".join("?" for _ in range(len(columns) + 2))
            quoted_columns = ", ".join(
                [
                    _quote_identifier("source_filename"),
                    _quote_identifier("row_number"),
                    *[_quote_identifier(column) for column in columns],
                ]
            )
            conn.executemany(
                f"INSERT INTO {_quote_identifier(table_name)} ({quoted_columns}) VALUES ({placeholders})",
                [
                    [source_filename, row_number, *[_db_value(_cell(row, index)) for index in range(len(columns))]]
                    for row_number, row in enumerate(rows, start=1)
                ],
            )

    return len(rows)


def replace_slsm_revenue_forecast(headers: list[str], rows: list[list[Any]], source_filename: str) -> int:
    return replace_revenue_forecast(headers, rows, source_filename, SLSM_REVENUE_FORECAST_TABLE)


def replace_pipeline_upload(
    headers: list[str],
    rows: list[list[Any]],
    source_filename: str,
    table_name: str = PIPELINE_UPLOAD_TABLE,
) -> int:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload_headers = _unique_column_names(headers)
    payload_rows = [
        [_db_value(_cell(row, index)) for index in range(len(payload_headers))]
        for row in rows
    ]

    with sqlite3.connect(DATABASE_PATH) as conn:
        conn.execute(f"DROP TABLE IF EXISTS {_quote_identifier(table_name)}")
        conn.execute(_create_pipeline_upload_table_sql(table_name))
        conn.execute(
            f"""
            INSERT INTO {_quote_identifier(table_name)}
                (id, source_filename, rows_saved, headers_json, rows_json)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                1,
                source_filename,
                len(rows),
                json.dumps(payload_headers),
                json.dumps(payload_rows),
            ),
        )

    return len(rows)


def replace_slsm_pipeline_upload(headers: list[str], rows: list[list[Any]], source_filename: str) -> int:
    return replace_pipeline_upload(headers, rows, source_filename, SLSM_PIPELINE_UPLOAD_TABLE)


def load_pipeline_upload_metadata(table_name: str = PIPELINE_UPLOAD_TABLE) -> dict[str, Any]:
    if not DATABASE_PATH.exists():
        return {"available": False, "table": table_name, "rowsSaved": 0, "sourceFilename": None}

    with sqlite3.connect(DATABASE_PATH) as conn:
        if not _table_exists(conn, table_name):
            return {"available": False, "table": table_name, "rowsSaved": 0, "sourceFilename": None}

        row = conn.execute(
            f"SELECT source_filename, rows_saved FROM {_quote_identifier(table_name)} WHERE id = 1"
        ).fetchone()

    return {
        "available": bool(row and row[1] > 0),
        "table": table_name,
        "rowsSaved": row[1] if row else 0,
        "databaseRows": 1 if row else 0,
        "sourceFilename": row[0] if row else None,
    }


def load_slsm_pipeline_upload_metadata() -> dict[str, Any]:
    return load_pipeline_upload_metadata(SLSM_PIPELINE_UPLOAD_TABLE)


def load_pipeline_upload(table_name: str = PIPELINE_UPLOAD_TABLE) -> tuple[list[str], list[list[Any]], str | None]:
    if not DATABASE_PATH.exists():
        return [], [], None

    with sqlite3.connect(DATABASE_PATH) as conn:
        if not _table_exists(conn, table_name):
            return [], [], None

        row = conn.execute(
            f"""
            SELECT source_filename, headers_json, rows_json
            FROM {_quote_identifier(table_name)}
            WHERE id = 1
            """
        ).fetchone()

    if not row:
        return [], [], None

    source_filename, headers_json, rows_json = row
    return json.loads(headers_json or "[]"), json.loads(rows_json or "[]"), source_filename


def load_slsm_pipeline_upload() -> tuple[list[str], list[list[Any]], str | None]:
    return load_pipeline_upload(SLSM_PIPELINE_UPLOAD_TABLE)


def replace_wins_lost(headers: list[str], rows: list[list[Any]], source_filename: str) -> int:
    return _replace_single_row_payload(WINS_LOST_TABLE, headers, rows, source_filename)


def load_wins_lost_metadata() -> dict[str, Any]:
    return _load_single_row_payload_metadata(WINS_LOST_TABLE)


def load_wins_lost() -> tuple[list[str], list[list[Any]], str | None]:
    return _load_single_row_payload(WINS_LOST_TABLE)


def replace_slsm_wins_lost(headers: list[str], rows: list[list[Any]], source_filename: str) -> int:
    return _replace_single_row_payload(SLSM_WINS_LOST_TABLE, headers, rows, source_filename)


def load_slsm_wins_lost_metadata() -> dict[str, Any]:
    return _load_single_row_payload_metadata(SLSM_WINS_LOST_TABLE)


def load_slsm_wins_lost() -> tuple[list[str], list[list[Any]], str | None]:
    return _load_single_row_payload(SLSM_WINS_LOST_TABLE)


def replace_pending_validation(headers: list[str], rows: list[list[Any]], source_filename: str) -> int:
    return _replace_single_row_payload(PENDING_VALIDATION_TABLE, headers, rows, source_filename)


def load_pending_validation_metadata() -> dict[str, Any]:
    return _load_single_row_payload_metadata(PENDING_VALIDATION_TABLE)


def load_pending_validation() -> tuple[list[str], list[list[Any]], str | None]:
    return _load_single_row_payload(PENDING_VALIDATION_TABLE)


def replace_slsm_pending_validation(headers: list[str], rows: list[list[Any]], source_filename: str) -> int:
    return _replace_single_row_payload(SLSM_PENDING_VALIDATION_TABLE, headers, rows, source_filename)


def load_slsm_pending_validation_metadata() -> dict[str, Any]:
    return _load_single_row_payload_metadata(SLSM_PENDING_VALIDATION_TABLE)


def load_slsm_pending_validation() -> tuple[list[str], list[list[Any]], str | None]:
    return _load_single_row_payload(SLSM_PENDING_VALIDATION_TABLE)


def load_revenue_forecast_metadata(table_name: str = "revenue_forecast") -> dict[str, Any]:
    if not DATABASE_PATH.exists():
        return {"available": False, "table": table_name, "rowsSaved": 0, "sourceFilename": None}

    with sqlite3.connect(DATABASE_PATH) as conn:
        if not _table_exists(conn, table_name):
            return {"available": False, "table": table_name, "rowsSaved": 0, "sourceFilename": None}

        rows_saved = conn.execute(f"SELECT COUNT(*) FROM {_quote_identifier(table_name)}").fetchone()[0]
        source_row = conn.execute(
            f"SELECT source_filename FROM {_quote_identifier(table_name)} ORDER BY row_number LIMIT 1"
        ).fetchone()

    return {
        "available": rows_saved > 0,
        "table": table_name,
        "rowsSaved": rows_saved,
        "sourceFilename": source_row[0] if source_row else None,
    }


def load_slsm_revenue_forecast_metadata() -> dict[str, Any]:
    return load_revenue_forecast_metadata(SLSM_REVENUE_FORECAST_TABLE)


def load_revenue_forecast(table_name: str = "revenue_forecast") -> tuple[list[str], list[list[Any]], str | None]:
    if not DATABASE_PATH.exists():
        return [], [], None

    with sqlite3.connect(DATABASE_PATH) as conn:
        if not _table_exists(conn, table_name):
            return [], [], None

        table_info = conn.execute(f"PRAGMA table_info({_quote_identifier(table_name)})").fetchall()
        headers = [row[1] for row in table_info if row[1] not in SYSTEM_COLUMNS]
        if not headers:
            return [], [], None

        quoted_headers = ", ".join(_quote_identifier(header) for header in headers)
        records = conn.execute(
            f"SELECT source_filename, {quoted_headers} FROM {_quote_identifier(table_name)} ORDER BY row_number"
        ).fetchall()

    source_filename = records[0][0] if records else None
    rows = [list(record[1:]) for record in records]
    return headers, rows, source_filename


def load_slsm_revenue_forecast() -> tuple[list[str], list[list[Any]], str | None]:
    return load_revenue_forecast(SLSM_REVENUE_FORECAST_TABLE)


def replace_target_upload(
    source_filename: str,
    sheet_name: str,
    metrics: list[str],
    sls_rows: list[dict[str, Any]],
    account_rows: list[dict[str, Any]],
) -> dict[str, Any]:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)

    with sqlite3.connect(DATABASE_PATH) as conn:
        conn.execute(f"DROP TABLE IF EXISTS {_quote_identifier(TARGET_UPLOAD_TABLE)}")
        conn.execute(f"DROP TABLE IF EXISTS {_quote_identifier(TARGET_SLS_TABLE)}")
        conn.execute(f"DROP TABLE IF EXISTS {_quote_identifier(TARGET_ACCOUNT_TABLE)}")
        conn.execute(_create_target_upload_table_sql())
        conn.execute(_create_target_row_table_sql(TARGET_SLS_TABLE, "sls_name"))
        conn.execute(_create_target_row_table_sql(TARGET_ACCOUNT_TABLE, "account_name", include_sls=True))
        conn.execute(
            f"""
            INSERT INTO {_quote_identifier(TARGET_UPLOAD_TABLE)}
                (id, source_filename, sheet_name, sls_count, account_count, metrics_json, uploaded_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                1,
                source_filename,
                sheet_name,
                len(sls_rows),
                len(account_rows),
                json.dumps(metrics),
                datetime.utcnow().isoformat(timespec="seconds") + "Z",
            ),
        )
        conn.executemany(
            f"""
            INSERT INTO {_quote_identifier(TARGET_SLS_TABLE)}
                (source_filename, row_number, sls_name, metrics_json, labels_json)
            VALUES (?, ?, ?, ?, ?)
            """,
            [
                (
                    source_filename,
                    row.get("rowNumber"),
                    row.get("slsName"),
                    json.dumps(row.get("metrics", {})),
                    json.dumps(row.get("labels", {})),
                )
                for row in sls_rows
            ],
        )
        conn.executemany(
            f"""
            INSERT INTO {_quote_identifier(TARGET_ACCOUNT_TABLE)}
                (source_filename, row_number, sls_name, account_name, group_name, metrics_json, labels_json)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    source_filename,
                    row.get("rowNumber"),
                    row.get("slsName"),
                    row.get("accountName"),
                    row.get("groupName", ""),
                    json.dumps(row.get("metrics", {})),
                    json.dumps(row.get("labels", {})),
                )
                for row in account_rows
            ],
        )

    return load_target_upload_metadata()


def load_target_upload_metadata() -> dict[str, Any]:
    if not DATABASE_PATH.exists():
        return _empty_target_metadata()

    with sqlite3.connect(DATABASE_PATH) as conn:
        if not _table_exists(conn, TARGET_UPLOAD_TABLE):
            return _empty_target_metadata()

        row = conn.execute(
            f"""
            SELECT source_filename, sheet_name, sls_count, account_count, metrics_json, uploaded_at
            FROM {_quote_identifier(TARGET_UPLOAD_TABLE)}
            WHERE id = 1
            """
        ).fetchone()

    if not row:
        return _empty_target_metadata()

    source_filename, sheet_name, sls_count, account_count, metrics_json, uploaded_at = row
    return {
        "available": sls_count > 0,
        "table": TARGET_UPLOAD_TABLE,
        "sourceFilename": source_filename,
        "sheet": sheet_name,
        "slsCount": sls_count,
        "accountCount": account_count,
        "rowsSaved": account_count,
        "metrics": json.loads(metrics_json or "[]"),
        "uploadedAt": uploaded_at,
    }


def load_target_sls_summary() -> list[dict[str, Any]]:
    return _load_target_rows(TARGET_SLS_TABLE)


def load_target_accounts_for_sls(sls_name: str) -> list[dict[str, Any]]:
    return _load_target_rows(TARGET_ACCOUNT_TABLE, sls_name)


def load_target_accounts() -> list[dict[str, Any]]:
    return _load_target_account_rows()


def replace_demand_creation_upload(source_filename: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Persist the latest parsed Demand Creation workbook result."""
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    rows_saved = sum(int(value or 0) for value in payload.get("rowsProcessed", {}).values())

    with sqlite3.connect(DATABASE_PATH) as conn:
        conn.execute(f"DROP TABLE IF EXISTS {_quote_identifier(DEMAND_CREATION_TABLE)}")
        conn.execute(
            f"""
            CREATE TABLE {_quote_identifier(DEMAND_CREATION_TABLE)} (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                source_filename TEXT NOT NULL,
                rows_saved INTEGER NOT NULL,
                payload_json TEXT NOT NULL
            )
            """
        )
        conn.execute(
            f"INSERT INTO {_quote_identifier(DEMAND_CREATION_TABLE)} (id, source_filename, rows_saved, payload_json) VALUES (1, ?, ?, ?)",
            (source_filename, rows_saved, json.dumps(payload)),
        )

    return {"available": bool(payload.get("series")), "table": DEMAND_CREATION_TABLE, "rowsSaved": rows_saved, "sourceFilename": source_filename}


def load_demand_creation_upload() -> dict[str, Any]:
    if not DATABASE_PATH.exists():
        return {"available": False, "sourceFilename": None, "series": [], "totals": {}, "rowsProcessed": {}}

    with sqlite3.connect(DATABASE_PATH) as conn:
        if not _table_exists(conn, DEMAND_CREATION_TABLE):
            return {"available": False, "sourceFilename": None, "series": [], "totals": {}, "rowsProcessed": {}}
        row = conn.execute(
            f"SELECT source_filename, payload_json FROM {_quote_identifier(DEMAND_CREATION_TABLE)} WHERE id = 1"
        ).fetchone()

    if not row:
        return {"available": False, "sourceFilename": None, "series": [], "totals": {}, "rowsProcessed": {}}
    payload = json.loads(row[1] or "{}")
    return {"available": bool(payload.get("series")), "sourceFilename": row[0], **payload}


def _table_exists(conn: sqlite3.Connection, table_name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table_name,),
    ).fetchone()
    return row is not None


def _replace_single_row_payload(table_name: str, headers: list[str], rows: list[list[Any]], source_filename: str) -> int:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload_headers = _unique_column_names(headers)
    payload_rows = [
        [_db_value(_cell(row, index)) for index in range(len(payload_headers))]
        for row in rows
    ]

    with sqlite3.connect(DATABASE_PATH) as conn:
        conn.execute(f"DROP TABLE IF EXISTS {_quote_identifier(table_name)}")
        conn.execute(_create_single_row_payload_table_sql(table_name))
        conn.execute(
            f"""
            INSERT INTO {_quote_identifier(table_name)}
                (id, source_filename, rows_saved, headers_json, rows_json)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                1,
                source_filename,
                len(rows),
                json.dumps(payload_headers),
                json.dumps(payload_rows),
            ),
        )

    return len(rows)


def _load_single_row_payload_metadata(table_name: str) -> dict[str, Any]:
    if not DATABASE_PATH.exists():
        return {"available": False, "table": table_name, "rowsSaved": 0, "sourceFilename": None}

    with sqlite3.connect(DATABASE_PATH) as conn:
        if not _table_exists(conn, table_name):
            return {"available": False, "table": table_name, "rowsSaved": 0, "sourceFilename": None}

        row = conn.execute(
            f"SELECT source_filename, rows_saved FROM {_quote_identifier(table_name)} WHERE id = 1"
        ).fetchone()

    return {
        "available": bool(row and row[1] > 0),
        "table": table_name,
        "rowsSaved": row[1] if row else 0,
        "databaseRows": 1 if row else 0,
        "sourceFilename": row[0] if row else None,
    }


def _load_single_row_payload(table_name: str) -> tuple[list[str], list[list[Any]], str | None]:
    if not DATABASE_PATH.exists():
        return [], [], None

    with sqlite3.connect(DATABASE_PATH) as conn:
        if not _table_exists(conn, table_name):
            return [], [], None

        row = conn.execute(
            f"""
            SELECT source_filename, headers_json, rows_json
            FROM {_quote_identifier(table_name)}
            WHERE id = 1
            """
        ).fetchone()

    if not row:
        return [], [], None

    source_filename, headers_json, rows_json = row
    return json.loads(headers_json or "[]"), json.loads(rows_json or "[]"), source_filename


def _create_single_row_payload_table_sql(table_name: str) -> str:
    return f"""
            CREATE TABLE {_quote_identifier(table_name)} (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                source_filename TEXT,
                rows_saved INTEGER NOT NULL,
                headers_json TEXT NOT NULL,
                rows_json TEXT NOT NULL
            )
            """


def _create_pipeline_upload_table_sql(table_name: str = PIPELINE_UPLOAD_TABLE) -> str:
    return f"""
            CREATE TABLE {_quote_identifier(table_name)} (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                source_filename TEXT,
                rows_saved INTEGER NOT NULL,
                headers_json TEXT NOT NULL,
                rows_json TEXT NOT NULL
            )
            """


def _create_table_sql(table_name_or_columns, columns: list[str] | None = None) -> str:
    table_name = "revenue_forecast" if columns is None else table_name_or_columns
    columns = table_name_or_columns if columns is None else columns
    excel_columns = ",\n".join(f"                {_quote_identifier(column)} TEXT" for column in columns)
    comma = "," if excel_columns else ""
    return f"""
            CREATE TABLE {_quote_identifier(table_name)} (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_filename TEXT,
                row_number INTEGER NOT NULL{comma}
{excel_columns}
            )
            """


def _create_target_upload_table_sql() -> str:
    return f"""
            CREATE TABLE {_quote_identifier(TARGET_UPLOAD_TABLE)} (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                source_filename TEXT,
                sheet_name TEXT NOT NULL,
                sls_count INTEGER NOT NULL,
                account_count INTEGER NOT NULL,
                metrics_json TEXT NOT NULL,
                uploaded_at TEXT NOT NULL
            )
            """


def _create_target_row_table_sql(table_name: str, name_column: str, include_sls: bool = False) -> str:
    sls_column = "sls_name TEXT NOT NULL," if include_sls else ""
    group_column = "group_name TEXT," if table_name == TARGET_ACCOUNT_TABLE else ""
    return f"""
            CREATE TABLE {_quote_identifier(table_name)} (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_filename TEXT,
                row_number INTEGER NOT NULL,
                {sls_column}
                {_quote_identifier(name_column)} TEXT NOT NULL,
                {group_column}
                metrics_json TEXT NOT NULL,
                labels_json TEXT NOT NULL
            )
            """


def _empty_target_metadata() -> dict[str, Any]:
    return {
        "available": False,
        "table": TARGET_UPLOAD_TABLE,
        "rowsSaved": 0,
        "sourceFilename": None,
        "sheet": None,
        "slsCount": 0,
        "accountCount": 0,
        "metrics": [],
    }


def _load_target_rows(table_name: str, sls_name: str | None = None) -> list[dict[str, Any]]:
    if not DATABASE_PATH.exists():
        return []

    with sqlite3.connect(DATABASE_PATH) as conn:
        if not _table_exists(conn, table_name):
            return []

        if sls_name is None:
            records = conn.execute(
                f"""
                SELECT row_number, sls_name, metrics_json, labels_json
                FROM {_quote_identifier(table_name)}
                ORDER BY row_number
                """
            ).fetchall()
            return [
                {
                    "rowNumber": row_number,
                    "slsName": name,
                    "metrics": json.loads(metrics_json or "{}"),
                    "labels": json.loads(labels_json or "{}"),
                }
                for row_number, name, metrics_json, labels_json in records
            ]

        records = conn.execute(
            f"""
            SELECT row_number, sls_name, account_name, group_name, metrics_json, labels_json
            FROM {_quote_identifier(table_name)}
            WHERE sls_name = ?
            ORDER BY row_number
            """,
            (sls_name,),
        ).fetchall()
    return [
        {
            "rowNumber": row_number,
            "slsName": sls,
            "accountName": account,
            "groupName": group_name or "",
            "metrics": json.loads(metrics_json or "{}"),
            "labels": json.loads(labels_json or "{}"),
        }
        for row_number, sls, account, group_name, metrics_json, labels_json in records
    ]


def _load_target_account_rows() -> list[dict[str, Any]]:
    if not DATABASE_PATH.exists():
        return []

    with sqlite3.connect(DATABASE_PATH) as conn:
        if not _table_exists(conn, TARGET_ACCOUNT_TABLE):
            return []

        records = conn.execute(
            f"""
            SELECT row_number, sls_name, account_name, group_name, metrics_json, labels_json
            FROM {_quote_identifier(TARGET_ACCOUNT_TABLE)}
            ORDER BY row_number
            """
        ).fetchall()

    return [
        {
            "rowNumber": row_number,
            "slsName": sls,
            "accountName": account,
            "groupName": group_name or "",
            "metrics": json.loads(metrics_json or "{}"),
            "labels": json.loads(labels_json or "{}"),
        }
        for row_number, sls, account, group_name, metrics_json, labels_json in records
    ]


def _unique_column_names(headers: list[str]) -> list[str]:
    seen: dict[str, int] = {}
    columns: list[str] = []

    for index, header in enumerate(headers, start=1):
        base = str(header or "").strip() or f"Column {index}"
        count = seen.get(base, 0)
        seen[base] = count + 1
        columns.append(base if count == 0 else f"{base}_{count + 1}")

    return columns


def _quote_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def _db_value(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return str(value)


def _cell(row: list[Any], index: int) -> Any:
    return row[index] if index < len(row) else None
