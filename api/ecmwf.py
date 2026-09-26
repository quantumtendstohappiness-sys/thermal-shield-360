import json
import math
from concurrent.futures import (
    ThreadPoolExecutor,
    TimeoutError as FutureTimeoutError,
)
from http.server import BaseHTTPRequestHandler
from typing import Any
from urllib.parse import parse_qs, urlsplit

from data.adapters.ecmwf_adapter import fetch_ecmwf, validate_document


ALLOWED_ORIGINS = {
    "https://quantumtendstohappiness-sys.github.io",
}
REQUEST_TIMEOUT_SECONDS = 60
RAW_STATUS = "raw/not normalized"


def _origin(headers: Any) -> str | None:
    origin = headers.get("Origin")
    if origin in ALLOWED_ORIGINS:
        return origin
    return None


def _write_json(
    handler: BaseHTTPRequestHandler,
    status_code: int,
    payload: dict[str, Any],
    origin: str | None,
) -> None:
    body = json.dumps(payload).encode("utf-8")

    handler.send_response(status_code)
    if origin is not None:
        handler.send_header("Access-Control-Allow-Origin", origin)
        handler.send_header("Vary", "Origin")
    handler.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
    handler.send_header(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization",
    )
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _error_payload(code: str, message: str) -> dict[str, Any]:
    return {
        "error": {
            "code": code,
            "message": message,
        }
    }


def _error_response(
    handler: BaseHTTPRequestHandler,
    status_code: int,
    code: str,
    message: str,
    origin: str | None,
) -> None:
    _write_json(
        handler,
        status_code,
        _error_payload(code, message),
        origin,
    )


def _query_value(path: str, key: str) -> str | None:
    values = parse_qs(urlsplit(path).query).get(key)
    if values:
        return values[0]
    return None


def _validate_latitude(value: str | None) -> float:
    if value is None or value == "":
        raise ValueError("Latitude is required.")

    try:
        latitude = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(
            "Latitude must be a finite numeric value."
        ) from exc

    if not math.isfinite(latitude):
        raise ValueError("Latitude must be a finite numeric value.")

    if not -90.0 <= latitude <= 90.0:
        raise ValueError("Latitude must be between -90 and 90 degrees.")

    return latitude


def _validate_longitude(value: str | None) -> float:
    if value is None or value == "":
        raise ValueError("Longitude is required.")

    try:
        longitude = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(
            "Longitude must be a finite numeric value."
        ) from exc

    if not math.isfinite(longitude):
        raise ValueError("Longitude must be a finite numeric value.")

    return longitude


def _fetch_with_timeout(
    latitude: float,
    longitude: float,
    forecast_step: int | None = None,
) -> dict[str, Any]:
    executor = ThreadPoolExecutor(max_workers=1)
    if forecast_step is None:
        future = executor.submit(
            fetch_ecmwf,
            latitude=latitude,
            longitude=longitude,
        )
    else:
        future = executor.submit(
            fetch_ecmwf,
            latitude=latitude,
            longitude=longitude,
            forecast_step=forecast_step,
        )

    try:
        return future.result(timeout=REQUEST_TIMEOUT_SECONDS)
    finally:
        executor.shutdown(wait=False, cancel_futures=True)


def _handle_request(handler: BaseHTTPRequestHandler) -> None:
    origin = _origin(handler.headers)

    try:
        latitude = _validate_latitude(
            _query_value(handler.path, "latitude")
        )
        longitude = _validate_longitude(
            _query_value(handler.path, "longitude")
        )
    except ValueError as exc:
        message = str(exc)
        if "Latitude" in message:
            code = "invalid_latitude"
        elif "Longitude" in message:
            code = "invalid_longitude"
        else:
            code = "invalid_coordinates"

        _error_response(
            handler,
            400,
            code,
            message,
            origin,
        )
        return

    try:
        forecast_step_value = _query_value(handler.path, "forecast_step")
        forecast_step = int(forecast_step_value) if forecast_step_value else None
        payload = _fetch_with_timeout(latitude, longitude, forecast_step)
    except FutureTimeoutError:
        _error_response(
            handler,
            504,
            "ecmwf_timeout",
            "ECMWF retrieval timed out.",
            origin,
        )
        return
    except ValueError as exc:
        _error_response(
            handler,
            502,
            "ecmwf_invalid_response",
            f"ECMWF response was invalid or incomplete: {exc}",
            origin,
        )
        return
    except Exception as exc:
        _error_response(
            handler,
            502,
            "ecmwf_fetch_failed",
            f"ECMWF fetch failed: {exc}",
            origin,
        )
        return

    try:
        validate_document(payload)
    except ValueError as exc:
        _error_response(
            handler,
            502,
            "ecmwf_invalid_response",
            f"ECMWF payload validation failed: {exc}",
            origin,
        )
        return

    if payload.get("properties", {}).get("status") != RAW_STATUS:
        _error_response(
            handler,
            502,
            "ecmwf_invalid_response",
            "ECMWF payload status must remain raw/not normalized.",
            origin,
        )
        return

    _write_json(handler, 200, payload, origin)


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self) -> None:
        origin = _origin(self.headers)

        self.send_response(204)
        if origin is not None:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header(
            "Access-Control-Allow-Headers",
            "Content-Type, Authorization",
        )
        self.end_headers()

    def do_GET(self) -> None:
        _handle_request(self)

    def do_POST(self) -> None:
        origin = _origin(self.headers)
        _error_response(
            self,
            405,
            "method_not_allowed",
            "Only GET requests are supported.",
            origin,
        )

    def do_PUT(self) -> None:
        origin = _origin(self.headers)
        _error_response(
            self,
            405,
            "method_not_allowed",
            "Only GET requests are supported.",
            origin,
        )

    def do_PATCH(self) -> None:
        origin = _origin(self.headers)
        _error_response(
            self,
            405,
            "method_not_allowed",
            "Only GET requests are supported.",
            origin,
        )

    def do_DELETE(self) -> None:
        origin = _origin(self.headers)
        _error_response(
            self,
            405,
            "method_not_allowed",
            "Only GET requests are supported.",
            origin,
        )
