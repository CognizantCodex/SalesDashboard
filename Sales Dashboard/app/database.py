from __future__ import annotations

import json
import sqlite3
from datetime import date, datetime
from pathlib import Path
from typing import Any


DATABASE_PATH = Path(__file__).resolve().parent.parent / "sales_dashboard.db"
SYSTEM_COLUMNS = {"id", "source_filename", "row_number"}
PIPELINE_UPLOAD_TABLE = "pipeline_upload"
WINS_LOST_TABLE = "wins_lost"
PENDING_VALIDATION_TABLE = "pending_validation"


def replace_revenue_forecast(headers: list[str], rows: list[list[Any]], source_filename: str) -> int:
    columns = _unique_column_names(headers)
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)

    with sqlite3.connect(DATABASE_PATH) as conn:
        conn.execute("DROP TABLE IF EXISTS revenue_forecast")
        conn.execute(_create_table_sql(columns))

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
                f"INSERT INTO revenue_forecast ({quoted_columns}) VALUES ({placeholders})",
                [
                    [source_filename, row_number, *[_db_value(_cell(row, index)) for index in range(len(columns))]]
                    for row_number, row in enumerate(rows, start=1)
                ],
            )

        return len(rows)


def replace_pipeline_upload(headers: list[str], rows: list[list[Any]], source_filename: str) -> int:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload_headers = _unique_column_names(headers)
    payload_rows = [
        [_db_value(_cell(row, index)) for index in range(len(payload_headers))]
        for row in rows
    ]

    with sqlite3.connect(DATABASE_PATH) as conn:
        conn.execute(f"DROP TABLE IF EXISTS {_quote_identifier(PIPELINE_UPLOAD_TABLE)}")
        conn.execute(_create_pipeline_upload_table_sql())
        conn.execute(
            f"""
            INSERT INTO {_quote_identifier(PIPELINE_UPLOAD_TABLE)}
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


def load_pipeline_upload_metadata() -> dict[str, Any]:
    if not DATABASE_PATH.exists():
        return {"available": False, "table": PIPELINE_UPLOAD_TABLE, "rowsSaved": 0, "sourceFilename": None}

    with sqlite3.connect(DATABASE_PATH) as conn:
        if not _table_exists(conn, PIPELINE_UPLOAD_TABLE):
            return {"available": False, "table": PIPELINE_UPLOAD_TABLE, "rowsSaved": 0, "sourceFilename": None}

        row = conn.execute(
            f"SELECT source_filename, rows_saved FROM {_quote_identifier(PIPELINE_UPLOAD_TABLE)} WHERE id = 1"
        ).fetchone()

    return {
        "available": bool(row and row[1] > 0),
        "table": PIPELINE_UPLOAD_TABLE,
        "rowsSaved": row[1] if row else 0,
        "databaseRows": 1 if row else 0,
        "sourceFilename": row[0] if row else None,
    }


def load_pipeline_upload() -> tuple[list[str], list[list[Any]], str | None]:
    if not DATABASE_PATH.exists():
        return [], [], None

    with sqlite3.connect(DATABASE_PATH) as conn:
        if not _table_exists(conn, PIPELINE_UPLOAD_TABLE):
            return [], [], None

        row = conn.execute(
            f"""
            SELECT source_filename, headers_json, rows_json
            FROM {_quote_identifier(PIPELINE_UPLOAD_TABLE)}
            WHERE id = 1
            """
        ).fetchone()

    if not row:
        return [], [], None

    source_filename, headers_json, rows_json = row
    return json.loads(headers_json or "[]"), json.loads(rows_json or "[]"), source_filename


def replace_wins_lost(headers: list[str], rows: list[list[Any]], source_filename: str) -> int:
    return _replace_single_row_payload(WINS_LOST_TABLE, headers, rows, source_filename)


def load_wins_lost_metadata() -> dict[str, Any]:
    return _load_single_row_payload_metadata(WINS_LOST_TABLE)


def load_wins_lost() -> tuple[list[str], list[list[Any]], str | None]:
    return _load_single_row_payload(WINS_LOST_TABLE)


def replace_pending_validation(headers: list[str], rows: list[list[Any]], source_filename: str) -> int:
    return _replace_single_row_payload(PENDING_VALIDATION_TABLE, headers, rows, source_filename)


def load_pending_validation_metadata() -> dict[str, Any]:
    return _load_single_row_payload_metadata(PENDING_VALIDATION_TABLE)


def load_pending_validation() -> tuple[list[str], list[list[Any]], str | None]:
    return _load_single_row_payload(PENDING_VALIDATION_TABLE)


def load_revenue_forecast_metadata() -> dict[str, Any]:
    if not DATABASE_PATH.exists():
        return {"available": False, "table": "revenue_forecast", "rowsSaved": 0, "sourceFilename": None}

    with sqlite3.connect(DATABASE_PATH) as conn:
        if not _table_exists(conn, "revenue_forecast"):
            return {"available": False, "table": "revenue_forecast", "rowsSaved": 0, "sourceFilename": None}

        rows_saved = conn.execute("SELECT COUNT(*) FROM revenue_forecast").fetchone()[0]
        source_row = conn.execute(
            "SELECT source_filename FROM revenue_forecast ORDER BY row_number LIMIT 1"
        ).fetchone()

    return {
        "available": rows_saved > 0,
        "table": "revenue_forecast",
        "rowsSaved": rows_saved,
        "sourceFilename": source_row[0] if source_row else None,
    }


def load_revenue_forecast() -> tuple[list[str], list[list[Any]], str | None]:
    if not DATABASE_PATH.exists():
        return [], [], None

    with sqlite3.connect(DATABASE_PATH) as conn:
        if not _table_exists(conn, "revenue_forecast"):
            return [], [], None

        table_info = conn.execute("PRAGMA table_info(revenue_forecast)").fetchall()
        headers = [row[1] for row in table_info if row[1] not in SYSTEM_COLUMNS]
        if not headers:
            return [], [], None

        quoted_headers = ", ".join(_quote_identifier(header) for header in headers)
        records = conn.execute(
            f"SELECT source_filename, {quoted_headers} FROM revenue_forecast ORDER BY row_number"
        ).fetchall()

    source_filename = records[0][0] if records else None
    rows = [list(record[1:]) for record in records]
    return headers, rows, source_filename


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


def _create_pipeline_upload_table_sql() -> str:
    return f"""
            CREATE TABLE {_quote_identifier(PIPELINE_UPLOAD_TABLE)} (
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
