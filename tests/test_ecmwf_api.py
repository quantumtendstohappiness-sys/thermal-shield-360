import json
from types import SimpleNamespace

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

    body = handler(request, response)
    parsed = json.loads(body)

    assert response.status == 200
    assert response.headers["Access-Control-Allow-Origin"] == "https://quantumtendstohappiness-sys.github.io"
    assert parsed["properties"]["requested_coordinate"]["latitude"] == 45.0
    assert parsed["properties"]["status"] == "raw/not normalized"


def test_invalid_latitude():
    request = DummyRequest(query={"latitude": "91", "longitude": "12.5"})
    response = DummyResponse()

    body = handler(request, response)
    parsed = json.loads(body)

    assert response.status == 400
    assert parsed["error"]["code"] == "invalid_latitude"


def test_invalid_longitude():
    request = DummyRequest(query={"latitude": "45", "longitude": "nan"})
    response = DummyResponse()

    body = handler(request, response)
    parsed = json.loads(body)

    assert response.status == 400
    assert parsed["error"]["code"] == "invalid_longitude"


def test_non_numeric_coordinates():
    request = DummyRequest(query={"latitude": "abc", "longitude": "12.5"})
    response = DummyResponse()

    body = handler(request, response)
    parsed = json.loads(body)

    assert response.status == 400
    assert parsed["error"]["code"] == "invalid_latitude"


def test_missing_coordinates():
    request = DummyRequest(query={})
    response = DummyResponse()

    body = handler(request, response)
    parsed = json.loads(body)

    assert response.status == 400
    assert parsed["error"]["code"] == "invalid_latitude"


def test_longitude_normalization(monkeypatch, valid_response_payload):
    monkeypatch.setattr("api.ecmwf.fetch_ecmwf", lambda latitude, longitude: (valid_response_payload, longitude)[0])
    monkeypatch.setattr("api.ecmwf.validate_document", lambda payload: None)

    request = DummyRequest(query={"latitude": "0", "longitude": "190"})
    response = DummyResponse()

    body = handler(request, response)
    parsed = json.loads(body)

    assert parsed["properties"]["requested_coordinate"]["longitude"] == 190.0
    assert parsed["geometry"]["coordinates"][0] == 190.0


def test_nearest_grid_metadata_preserved(monkeypatch, valid_response_payload):
    monkeypatch.setattr("api.ecmwf.fetch_ecmwf", lambda latitude, longitude: valid_response_payload)
    monkeypatch.setattr("api.ecmwf.validate_document", lambda payload: None)

    request = DummyRequest(query={"latitude": "45", "longitude": "12.5"})
    response = DummyResponse()

    body = handler(request, response)
    parsed = json.loads(body)

    nearest = parsed["properties"]["parameters"]["2t"]["nearest_grid_point"]
    assert nearest == {"latitude": 45.0, "longitude": 12.5, "flat_index": 123}


def test_timestamp_preservation(monkeypatch, valid_response_payload):
    monkeypatch.setattr("api.ecmwf.fetch_ecmwf", lambda latitude, longitude: valid_response_payload)
    monkeypatch.setattr("api.ecmwf.validate_document", lambda payload: None)

    request = DummyRequest(query={"latitude": "45", "longitude": "12.5"})
    response = DummyResponse()

    body = handler(request, response)
    parsed = json.loads(body)

    assert parsed["properties"]["forecast_initialization_time_utc"] == "2026-09-19T00:00:00Z"
    assert parsed["properties"]["forecast_valid_time_utc"] == "2026-09-19T03:00:00Z"
    assert parsed["properties"]["parameters"]["2t"]["valid_time_utc"] == "2026-09-19T03:00:00Z"


def test_step_range_preservation(monkeypatch, valid_response_payload):
    monkeypatch.setattr("api.ecmwf.fetch_ecmwf", lambda latitude, longitude: valid_response_payload)
    monkeypatch.setattr("api.ecmwf.validate_document", lambda payload: None)

    request = DummyRequest(query={"latitude": "45", "longitude": "12.5"})
    response = DummyResponse()

    body = handler(request, response)
    parsed = json.loads(body)

    assert parsed["properties"]["parameters"]["2t"]["step_range"] == "3"


def test_native_unit_preservation(monkeypatch, valid_response_payload):
    monkeypatch.setattr("api.ecmwf.fetch_ecmwf", lambda latitude, longitude: valid_response_payload)
    monkeypatch.setattr("api.ecmwf.validate_document", lambda payload: None)

    request = DummyRequest(query={"latitude": "45", "longitude": "12.5"})
    response = DummyResponse()

    body = handler(request, response)
    parsed = json.loads(body)

    assert parsed["properties"]["parameters"]["2t"]["raw_units"] == "K"
    assert parsed["properties"]["parameters"]["2t"]["raw_value"] == 290.1


def test_invalid_ecmwf_response_handling(monkeypatch):
    def raise_value(_latitude, _longitude):
        raise ValueError("Missing ECMWF parameters")

    monkeypatch.setattr("api.ecmwf.fetch_ecmwf", raise_value)

    request = DummyRequest(query={"latitude": "45", "longitude": "12.5"})
    response = DummyResponse()

    body = handler(request, response)
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

    handler(request, response)

    if expected_allow is None:
        assert "Access-Control-Allow-Origin" not in response.headers
    else:
        assert response.headers["Access-Control-Allow-Origin"] == expected_allow
