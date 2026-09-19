import json
import math
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from typing import Any
from urllib.parse import parse_qs, urlsplit

from data.adapters.ecmwf_adapter import fetch_ecmwf, validate_document

ALLOWED_ORIGINS = {
    "https://quantumtendstohappiness-sys.github.io",
}
REQUEST_TIMEOUT_SECONDS = 25
RAW_STATUS = "raw/not normalized"


def _set_cors(response: Any, origin: str | None) -> None:
    headers = getattr(response, "headers", None)
    if headers is None:
        return

    if origin in ALLOWED_ORIGINS:
        headers["Access-Control-Allow-Origin"] = origin
        headers["Vary"] = "Origin"
    headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
    headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"


def _read_header(request: Any, key: str) -> str | None:
    headers = getattr(request, "headers", None)
    if headers is None:
        return None
    if hasattr(headers, "get"):
        return headers.get(key) or headers.get(key.lower())
    if isinstance(headers, dict):
        return headers.get(key) or headers.get(key.lower())
    return None


def _read_query_value(request: Any, key: str) -> str | None:
    args = getattr(request, "args", None)
    if args is not None and hasattr(args, "get"):
        value = args.get(key)
        if value is not None:
            return value

    if hasattr(request, "query_params") and hasattr(request.query_params, "get"):
        value = request.query_params.get(key)
        if value is not None:
            return value

    if hasattr(request, "GET") and hasattr(request.GET, "get"):
        value = request.GET.get(key)
        if value is not None:
            return value

    if hasattr(request, "query"):
        query = request.query
        if isinstance(query, dict):
            value = query.get(key)
            if value is not None:
                return value
        if isinstance(query, str):
            parsed = parse_qs(urlsplit(f"?{query}").query)
            values = parsed.get(key)
            if values:
                return values[0]

    if hasattr(request, "url"):
        parsed = urlsplit(str(request.url))
        values = parse_qs(parsed.query).get(key)
        if values:
            return values[0]

    return None


def _error_response(response: Any, status_code: int, code: str, message: str, origin: str | None) -> str:
    payload = {
        "error": {
            "code": code,
            "message": message,
        }
    }
    _set_cors(response, origin)
    if hasattr(response, "status"):
        response.status = status_code
    if hasattr(response, "headers"):
        response.headers.setdefault("Content-Type", "application/json")
    if hasattr(response, "json"):
        return response.json(payload, status=status_code)
    if hasattr(response, "body"):
        response.body = json.dumps(payload)
        return response.body
    return json.dumps(payload)


def _validate_latitude(value: str | None) -> float:
    if value is None or value == "":
        raise ValueError("Latitude is required.")
    try:
        latitude = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("Latitude must be a finite numeric value.") from exc
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
        raise ValueError("Longitude must be a finite numeric value.") from exc
    if not math.isfinite(longitude):
        raise ValueError("Longitude must be a finite numeric value.")
    return ((longitude + 180.0) % 360.0) - 180.0


def _json_response(response: Any, payload: dict[str, Any], status_code: int, origin: str | None) -> str:
    _set_cors(response, origin)
    if hasattr(response, "status"):
        response.status = status_code
    if hasattr(response, "headers"):
        response.headers.setdefault("Content-Type", "application/json")
    if hasattr(response, "json"):
        return response.json(payload, status=status_code)
    if hasattr(response, "body"):
        response.body = json.dumps(payload)
        return response.body
    return json.dumps(payload)


def handler(request: Any, response: Any) -> str:
    origin = _read_header(request, "Origin")
    method = getattr(request, "method", "GET").upper()

    if method == "OPTIONS":
        _set_cors(response, origin if origin in ALLOWED_ORIGINS else None)
        if hasattr(response, "status"):
            response.status = 204
        if hasattr(response, "headers"):
            response.headers.setdefault("Content-Type", "application/json")
        if hasattr(response, "end"):
            response.end()
        return ""

    if method != "GET":
        return _error_response(
            response,
            405,
            "method_not_allowed",
            "Only GET requests are supported.",
            origin,
        )

    try:
        latitude = _validate_latitude(_read_query_value(request, "latitude"))
        longitude = _validate_longitude(_read_query_value(request, "longitude"))
    except ValueError as exc:
        message = str(exc)
        if "Latitude" in message:
            code = "invalid_latitude"
        elif "Longitude" in message:
            code = "invalid_longitude"
        else:
            code = "invalid_coordinates"
        return _error_response(response, 400, code, message, origin)

    try:
        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(fetch_ecmwf, latitude=latitude, longitude=longitude)
            payload = future.result(timeout=REQUEST_TIMEOUT_SECONDS)
    except FutureTimeoutError as exc:
        return _error_response(
            response,
            504,
            "ecmwf_timeout",
            "ECMWF retrieval timed out.",
            origin,
        ) from exc
    except ValueError as exc:
        return _error_response(
            response,
            502,
            "ecmwf_invalid_response",
            f"ECMWF response was invalid or incomplete: {exc}",
            origin,
        ) from exc
    except Exception as exc:
        return _error_response(
            response,
            502,
            "ecmwf_fetch_failed",
            f"ECMWF fetch failed: {exc}",
            origin,
        ) from exc

    try:
        validate_document(payload)
    except ValueError as exc:
        return _error_response(
            response,
            502,
            "ecmwf_invalid_response",
            f"ECMWF payload validation failed: {exc}",
            origin,
        ) from exc

    if payload.get("properties", {}).get("status") != RAW_STATUS:
        return _error_response(
            response,
            502,
            "ecmwf_invalid_response",
            "ECMWF payload status must remain raw/not normalized.",
            origin,
        )

    return _json_response(response, payload, 200, origin)


__all__ = ["handler"]
