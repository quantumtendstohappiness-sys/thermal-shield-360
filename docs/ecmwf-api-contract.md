# ECMWF Location-Aware API Contract

**Status:** Phase 1 contract only

This document defines the future contract for a location-aware ECMWF forecast endpoint. It does not implement an endpoint, backend, serverless function, deployment configuration, workflow, frontend integration, or data transformation.

## Endpoint

```http
GET /api/ecmwf?latitude=<lat>&longitude=<lon>
```

The endpoint is expected to accept one requested location and return raw ECMWF forecast data sampled at the nearest available ECMWF grid point.

## Request contract

### Query parameters

| Parameter | Required | Type | Requirements |
|---|---:|---|---|
| `latitude` | Yes | Decimal number | Finite value in the inclusive range `-90` to `90`. |
| `longitude` | Yes | Decimal number | Finite geographic longitude. Implementations may normalize it to the ECMWF-compatible `[-180, 180]` range, but must document that behavior. |

The request coordinate is the coordinate supplied by the user or by the existing location picker. It is not necessarily an ECMWF model-grid coordinate.

Invalid, missing, non-finite, or out-of-range coordinates must produce a 4xx response. The error response format is implementation-defined for now, but must not return a successful forecast document for invalid input.

## Response contract

A successful response must be JSON and must contain a GeoJSON-like forecast document with the following required information:

```json
{
  "type": "Feature",
  "geometry": {
    "type": "Point",
    "coordinates": [
      "<requested-longitude>",
      "<requested-latitude>"
    ]
  },
  "properties": {
    "source": "ECMWF Open Data",
    "source_id": "ecmwf_opendata",
    "data_type": "forecast",
    "model": "ifs",
    "resolution": "0p25",
    "status": "raw/not normalized",
    "requested_coordinate": {
      "latitude": "<requested-latitude>",
      "longitude": "<requested-longitude>"
    },
    "forecast_initialization_time_utc": "<ISO-8601 UTC timestamp>",
    "forecast_valid_time_utc": "<ISO-8601 UTC timestamp>",
    "forecast_step_requested": "<forecast step>",
    "parameters": {
      "<ecmwf-short-name>": {
        "raw_value": "<native ECMWF value>",
        "raw_units": "<native ECMWF units>",
        "forecast_initialization_time_utc": "<ISO-8601 UTC timestamp>",
        "valid_time_utc": "<ISO-8601 UTC timestamp>",
        "forecast_step": "<forecast step>",
        "step_range": "<actual GRIB stepRange>",
        "nearest_grid_point": {
          "latitude": "<nearest-grid latitude>",
          "longitude": "<nearest-grid longitude>",
          "flat_index": "<optional GRIB flat index>"
        }
      }
    }
  },
  "provenance": {
    "provider": "ECMWF Open Data",
    "source_id": "ecmwf_opendata",
    "model": "ifs",
    "resolution": "0p25",
    "retrieved_at": "<ISO-8601 UTC timestamp>"
  },
  "quality": {
    "quality_flag": "<quality status>",
    "status": "raw/not normalized",
    "missing_fields": [],
    "notes": "<quality and sampling notes>"
  }
}
```

The example is a shape contract. Values must come from the ECMWF response and its GRIB metadata; they must not be fabricated or hard-coded as weather data.

## Required response semantics

### Requested coordinate and nearest grid coordinate

The response must preserve both coordinate concepts:

```text
requested coordinate != nearest ECMWF grid coordinate
```

- `properties.requested_coordinate` identifies the exact latitude/longitude requested by the user.
- Each parameter's `nearest_grid_point` identifies the ECMWF grid point from which that parameter value was selected.
- The nearest grid point must not be presented as though it were the user's exact location.
- The top-level geometry represents the requested coordinate. Nearest-grid metadata remains in the parameter/provenance data.

If all returned parameters use the same grid point, that fact may be documented in `quality.notes`, but the per-parameter metadata must remain available because GRIB messages are the authoritative source for field-level sampling metadata.

### Forecast timestamps

The contract distinguishes:

- `forecast_initialization_time_utc`: the ECMWF model run initialization time;
- `forecast_valid_time_utc`: the time represented by the forecast field;
- `forecast_step` or `forecast_step_requested`: the forecast lead step;
- `valid_time_utc` and `forecast_initialization_time_utc` inside each parameter: the field-level GRIB metadata;
- `provenance.retrieved_at`: when the payload was retrieved, not a forecast time.

Timestamps must be UTC ISO-8601 timestamps, preferably ending in `Z`. The endpoint must preserve ECMWF/GRIB-derived values and must not synthesize forecast timestamps from the browser clock.

### Step and stepRange

Each returned parameter must preserve the actual GRIB `stepRange` as `step_range`.

For example, an accumulated field may have:

```json
{
  "step_range": "0-3"
}
```

A scalar forecast field may have:

```json
{
  "step_range": "3"
}
```

The endpoint must not replace `stepRange` with the requested forecast step, infer an accumulation period from the step, or discard the original metadata. If parsed accumulation start/end fields are added later, the original `step_range` remains mandatory.

## Raw values and native units

The response is a raw ECMWF data contract. Parameter objects must preserve the ECMWF value and the native unit reported by the GRIB message:

```json
{
  "raw_value": "<unchanged ECMWF scalar>",
  "raw_units": "<unchanged ECMWF unit string>"
}
```

This Phase 1 contract prohibits the following conversions or substitutions:

- Kelvin to Celsius;
- accumulated `J m**-2` or `J m^-2` to `W m^-2`;
- wind-component or wind-speed unit conversion;
- radiation normalization;
- interpolation or unlabelled replacement of the nearest-grid value;
- conversion of any ECMWF field into existing NASA POWER inputs;
- conversion of any ECMWF field into HTSI, WBGT, UTCI, Heat Index, or another thermal calculation input.

The response must explicitly contain:

```json
"status": "raw/not normalized"
```

This status is required both in `properties.status` and `quality.status`. The frontend must not treat a response with another status as conforming to this contract.

## Provenance requirements

`provenance` must identify at least:

- provider/source: ECMWF Open Data;
- source identifier;
- model;
- resolution;
- `retrieved_at` timestamp.

`retrieved_at` must be an actual UTC retrieval timestamp. It must not be confused with forecast initialization or valid time.

Additional provenance may include the requested subset area, parameter list, adapter version, cache information, and upstream request details, provided that adding them does not remove the required fields.

## Quality and status requirements

`quality` must identify the quality/status state of the raw response. It must include:

- `quality_flag`;
- `status: "raw/not normalized"`;
- `missing_fields`, which must explicitly list missing required fields or be an empty array;
- notes describing nearest-grid selection, raw-data limitations, or other relevant caveats.

A successful response must not silently omit a required field. If a required ECMWF parameter or required metadata is unavailable, the implementation must return an explicit quality/error result rather than fabricate a value or silently substitute NASA POWER data.

## Explicit non-goals for Phase 1

This contract does not authorize or define:

- a backend or serverless implementation;
- GitHub Actions changes;
- deployment or hosting configuration;
- frontend changes;
- changes to the existing location picker;
- changes to NASA POWER retrieval or display;
- changes to `data/live/ecmwf-current.json`;
- changes to the current 0°,0° scheduled pipeline test;
- unit normalization;
- forecast-to-observation substitution;
- HTSI, WBGT, UTCI, Heat Index, or any other thermal calculation;
- authentication, tokens, secrets, or credentials in frontend JavaScript.

The existing ECMWF scheduled artifact remains a pipeline test artifact and must not be presented as the selected user's weather.
