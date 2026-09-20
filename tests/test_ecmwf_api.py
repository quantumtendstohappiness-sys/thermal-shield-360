import json
from copy import deepcopy
from io import BytesIO
from types import SimpleNamespace
from urllib.parse import urlencode

import pytest

from api.ecmwf import handler


class DummyResponse:
    def __init__(self):
        self.status = 200
        self.headers = {}
        self.body = ""

    def json(self, payload, status=None):
        self.status = status if status is not None else self.status
        self.body = json.dumps(payload)
        return self.body


class DummyRequest:
    def __init__(self, method="GET", query=None, headers=None, url="https://example.com/api/ecmwf"):
        self.method = method
        self.query = query or {}
        self.headers = headers or {}
        self.url = url
        self.args = self.query
        self.query_params = self.query
        self.GET = self.query


class DummySocket:
    def __init__(self, request_bytes):
        self._request = BytesIO(request_bytes)
        self.response = BytesIO()

    def makefile(self, mode, buffering=None):
        return self._request if "r" in mode else self.response

    def sendall(self, data):
        self.response.write(data)

    def close(self):
        pass


def _invoke(request, response):
    path = request.url
    if request.query:
        path = f"{path}?{urlencode(request.query)}"
    request_lines = [
        f"{request.method} {path} HTTP/1.1",
        "Host: example.com",
        *(f"{key}: {value}" for key, value in request.headers.items()),
        "",
        "",
    ]
    socket = DummySocket("\r\n".join(request_lines).encode("ascii"))
    server = SimpleNamespace(server_name="example.com", server_port=443)
    handler(socket, ("127.0.0.1", 12345), server)

    raw_response = socket.response.getvalue()
    header_bytes, body_bytes = raw_response.split(b"\r\n\r\n", 1)
    header_lines = header_bytes.decode("iso-8859-1").split("\r\n")
    response.status = int(header_lines[0].split()[1])
    response.headers = dict(line.split(": ", 1) for line in header_lines[1:])
    response.body = body_bytes.decode("utf-8")
    return response.body


def _payload():
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [12.5, 45.0]},
        "properties": {
            "source": "ECMWF Open Data",
            "source_id": "ecmwf_opendata",
            "data_type": "forecast",
            "model": "ifs",
            "resolution": "0p25",
            "status": "raw/not normalized",
            "requested_coordinate": {"latitude": 45.0, "longitude": 12.5},
            "forecast_initialization_time_utc": "2026-09-19T00:00:00Z",
            "forecast_valid_time_utc": "2026-09-19T03:00:00Z",
            "forecast_step_requested": 3,
            "parameters": {
                "2t": {
                    "raw_value": 290.1,
                    "raw_units": "K",
                    "forecast_initialization_time_utc": "2026-09-19T00:00:00Z",
                    "valid_time_utc": "2026-09-19T03:00:00Z",
                    "forecast_step": 3,
                    "step_range": "3",
                    "nearest_grid_point": {"latitude": 45.0, "longitude": 12.5, "flat_index": 123},
                }
            },
        },
        "provenance": {
            "provider": "ECMWF Open Data",
            "source_id": "ecmwf_opendata",
            "model": "ifs",
            "resolution": "0p25",
            "retrieved_at": "2026-09-19T09:00:00Z",
        },
        "quality": {
            "quality_flag": "acceptable",
            "status": "raw/not normalized",
            "missing_fields": [],
            "notes": "nearest-grid metadata preserved",
        },
    }


@pytest.fixture
def valid_response_payload():
    return _payload()


def test_valid_coordinates(monkeypatch, valid_response_payload):
    monkeypatch.setattr("api.ecmwf.fetch_ecmwf", lambda latitude, longitude: valid_response_payload)
    monkeypatch.setattr("api.ecmwf.validate_document", lambda payload: None)

    request = DummyRequest(query={"latitude": "45.0", "longitude": "12.5"}, headers={"Origin": "https://quantumtendstohappiness-sys.github.io"})
    response = DummyResponse()

    body = _invoke(request, response)
    parsed = json.loads(body)

    assert response.status == 200
    assert response.headers["Access-Control-Allow-Origin"] == "https://quantumtendstohappiness-sys.github.io"
    assert parsed["properties"]["requested_coordinate"]["latitude"] == 45.0
    assert parsed["properties"]["status"] == "raw/not normalized"


def test_invalid_latitude():
    request = DummyRequest(query={"latitude": "91", "longitude": "12.5"})
    response = DummyResponse()

    body = _invoke(request, response)
    parsed = json.loads(body)

    assert response.status == 400
    assert parsed["error"]["code"] == "invalid_latitude"


def test_invalid_longitude():
    request = DummyRequest(query={"latitude": "45", "longitude": "nan"})
    response = DummyResponse()

    body = _invoke(request, response)
    parsed = json.loads(body)

    assert response.status == 400
    assert parsed["error"]["code"] == "invalid_longitude"


def test_non_numeric_coordinates():
    request = DummyRequest(query={"latitude": "abc", "longitude": "12.5"})
    response = DummyResponse()

    body = _invoke(request, response)
    parsed = json.loads(body)

    assert response.status == 400
    assert parsed["error"]["code"] == "invalid_latitude"


def test_missing_coordinates():
    request = DummyRequest(query={})
    response = DummyResponse()

    body = _invoke(request, response)
    parsed = json.loads(body)

    assert response.status == 400
    assert parsed["error"]["code"] == "invalid_latitude"


def test_longitude_normalization(monkeypatch, valid_response_payload):
    payload = deepcopy(valid_response_payload)
    payload["properties"]["requested_coordinate"]["longitude"] = 190.0
    payload["geometry"]["coordinates"][0] = 190.0
    monkeypatch.setattr("api.ecmwf.fetch_ecmwf", lambda latitude, longitude: payload)
    monkeypatch.setattr("api.ecmwf.validate_document", lambda payload: None)

    request = DummyRequest(query={"latitude": "0", "longitude": "190"})
    response = DummyResponse()

    body = _invoke(request, response)
    parsed = json.loads(body)

    assert parsed["properties"]["requested_coordinate"]["longitude"] == 190.0
    assert parsed["geometry"]["coordinates"][0] == 190.0


def test_nearest_grid_metadata_preserved(monkeypatch, valid_response_payload):
    monkeypatch.setattr("api.ecmwf.fetch_ecmwf", lambda latitude, longitude: valid_response_payload)
    monkeypatch.setattr("api.ecmwf.validate_document", lambda payload: None)

    request = DummyRequest(query={"latitude": "45", "longitude": "12.5"})
    response = DummyResponse()

    body = _invoke(request, response)
    parsed = json.loads(body)

    nearest = parsed["properties"]["parameters"]["2t"]["nearest_grid_point"]
    assert nearest == {"latitude": 45.0, "longitude": 12.5, "flat_index": 123}


def test_timestamp_preservation(monkeypatch, valid_response_payload):
    monkeypatch.setattr("api.ecmwf.fetch_ecmwf", lambda latitude, longitude: valid_response_payload)
    monkeypatch.setattr("api.ecmwf.validate_document", lambda payload: None)

    request = DummyRequest(query={"latitude": "45", "longitude": "12.5"})
    response = DummyResponse()

    body = _invoke(request, response)
    parsed = json.loads(body)

    assert parsed["properties"]["forecast_initialization_time_utc"] == "2026-09-19T00:00:00Z"
    assert parsed["properties"]["forecast_valid_time_utc"] == "2026-09-19T03:00:00Z"
    assert parsed["properties"]["parameters"]["2t"]["valid_time_utc"] == "2026-09-19T03:00:00Z"


def test_step_range_preservation(monkeypatch, valid_response_payload):
    monkeypatch.setattr("api.ecmwf.fetch_ecmwf", lambda latitude, longitude: valid_response_payload)
    monkeypatch.setattr("api.ecmwf.validate_document", lambda payload: None)

    request = DummyRequest(query={"latitude": "45", "longitude": "12.5"})
    response = DummyResponse()

    body = _invoke(request, response)
    parsed = json.loads(body)

    assert parsed["properties"]["parameters"]["2t"]["step_range"] == "3"


def test_native_unit_preservation(monkeypatch, valid_response_payload):
    monkeypatch.setattr("api.ecmwf.fetch_ecmwf", lambda latitude, longitude: valid_response_payload)
    monkeypatch.setattr("api.ecmwf.validate_document", lambda payload: None)

    request = DummyRequest(query={"latitude": "45", "longitude": "12.5"})
    response = DummyResponse()

    body = _invoke(request, response)
    parsed = json.loads(body)

    assert parsed["properties"]["parameters"]["2t"]["raw_units"] == "K"
    assert parsed["properties"]["parameters"]["2t"]["raw_value"] == 290.1


def test_invalid_ecmwf_response_handling(monkeypatch):
    def raise_value(*, latitude, longitude):
        raise ValueError("Missing ECMWF parameters")

    monkeypatch.setattr("api.ecmwf.fetch_ecmwf", raise_value)

    request = DummyRequest(query={"latitude": "45", "longitude": "12.5"})
    response = DummyResponse()

    body = _invoke(request, response)
    parsed = json.loads(body)

    assert response.status == 502
    assert parsed["error"]["code"] == "ecmwf_invalid_response"


@pytest.mark.parametrize(
    "origin, expected_allow",
    [
        ("https://quantumtendstohappiness-sys.github.io", "https://quantumtendstohappiness-sys.github.io"),
        ("https://evil.example", None),
    ],
)
def test_cors_is_narrow(monkeypatch, valid_response_payload, origin, expected_allow):
    monkeypatch.setattr("api.ecmwf.fetch_ecmwf", lambda latitude, longitude: valid_response_payload)
    monkeypatch.setattr("api.ecmwf.validate_document", lambda payload: None)

    request = DummyRequest(
        query={"latitude": "45", "longitude": "12.5"},
        headers={"Origin": origin},
    )
    response = DummyResponse()

    _invoke(request, response)

    if expected_allow is None:
        assert "Access-Control-Allow-Origin" not in response.headers
    else:
        assert response.headers["Access-Control-Allow-Origin"] == expected_allow
