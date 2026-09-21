#!/usr/bin/env python3
"""Raw ECMWF Open Data adapter.

This adapter deliberately preserves ECMWF GRIB values and native units.
It does not normalize radiation fields and does not calculate WBGT or HTSI.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import eccodes
from ecmwf.opendata import Client


MODEL = "ifs"
RESOLUTION = "0p25"
PARAMETERS = ("2t", "2d", "10u", "10v", "ssrd", "strd", "skt")
FORECAST_STEP = 3
SUBSET_RADIUS_DEGREES = 1.0
RAW_STATUS = "raw/not normalized"
ECMWF_MAX_RETRIES = 2
ECMWF_RETRY_AFTER = (1, 4, 2)


def _iso_utc(date_value: Any, time_value: Any) -> str | None:
    """Convert GRIB date/time keys to an ISO-8601 UTC timestamp."""
    if date_value is None or time_value is None:
        return None

    date_text = str(int(date_value)).zfill(8)
    time_text = str(int(time_value)).zfill(4)

    try:
        timestamp = datetime.strptime(
            f"{date_text}{time_text}",
            "%Y%m%d%H%M",
        ).replace(tzinfo=timezone.utc)
    except ValueError:
        return None

    return timestamp.isoformat().replace("+00:00", "Z")


def _wrapped_longitude(longitude: float) -> float:
    """Return longitude in the GRIB-compatible [-180, 180] range."""
    return ((float(longitude) + 180.0) % 360.0) - 180.0


def _longitude_distance(first: float, second: float) -> float:
    """Return the shortest absolute angular longitude distance."""
    return abs((_wrapped_longitude(first) - _wrapped_longitude(second) + 180.0) % 360.0 - 180.0)


def _validate_coordinates(latitude: float, longitude: float) -> None:
    if not math.isfinite(latitude) or not -90.0 <= latitude <= 90.0:
        raise ValueError("Latitude must be between -90 and 90 degrees.")
    if not math.isfinite(longitude):
        raise ValueError("Longitude must be finite.")


def _subset_area(latitude: float, longitude: float) -> list[float]:
    """Create a small ECMWF area around the requested point.

    ECMWF area order is north, west, south, east. The requested coordinate
    used by the workflow is 0.0, 0.0; no synthetic/global fallback is used.
    """
    north = min(90.0, latitude + SUBSET_RADIUS_DEGREES)
    south = max(-90.0, latitude - SUBSET_RADIUS_DEGREES)
    west = _wrapped_longitude(longitude - SUBSET_RADIUS_DEGREES)
    east = _wrapped_longitude(longitude + SUBSET_RADIUS_DEGREES)
    return [north, west, south, east]


def _paired_nearest_index(
    latitudes: list[float],
    longitudes: list[float],
    target_latitude: float,
    target_longitude: float,
) -> tuple[int, float, float]:
    """Select one nearest paired latitude/longitude grid point.

    Latitude and longitude values are iterated as pairs. They are never
    selected independently, because reduced or subset GRIB grids may not be
    represented by a rectangular latitude-index/longitude-index product.
    """
    if len(latitudes) != len(longitudes):
        raise ValueError(
            "GRIB latitude and longitude arrays do not contain paired values."
        )
    if not latitudes:
        raise ValueError("GRIB latitude/longitude arrays are empty.")

    best_index = -1
    best_distance = math.inf

    for index, (grid_latitude, grid_longitude) in enumerate(
        zip(latitudes, longitudes)
    ):
        latitude_delta = grid_latitude - target_latitude
        longitude_delta = _longitude_distance(grid_longitude, target_longitude)
        distance = math.hypot(latitude_delta, longitude_delta)

        if distance < best_distance:
            best_index = index
            best_distance = distance

    if best_index < 0:
        raise ValueError("Unable to select a nearest GRIB grid point.")

    return (
        best_index,
        float(latitudes[best_index]),
        float(longitudes[best_index]),
    )


def _json_value(value: Any) -> Any:
    """Convert scalar GRIB values to JSON-compatible values without replacing them."""
    if value is None:
        return None
    if hasattr(value, "item"):
        return value.item()
    return value


def _read_message(
    handle: Any,
    target_latitude: float,
    target_longitude: float,
) -> dict[str, Any]:
    short_name = str(eccodes.codes_get(handle, "shortName"))
    units = eccodes.codes_get(handle, "units")

    latitudes = [
        float(value)
        for value in eccodes.codes_get_array(handle, "latitudes")
    ]
    longitudes = [
        float(value)
        for value in eccodes.codes_get_array(handle, "longitudes")
    ]
    values = list(eccodes.codes_get_array(handle, "values"))

    point_index, selected_latitude, selected_longitude = _paired_nearest_index(
        latitudes,
        longitudes,
        target_latitude,
        target_longitude,
    )

    if point_index >= len(values):
        raise ValueError(
            f"GRIB value array for {short_name} does not contain "
            f"nearest point index {point_index}."
        )

    raw_value = _json_value(values[point_index])
    if isinstance(raw_value, float) and not math.isfinite(raw_value):
        raise ValueError(
            f"GRIB value for {short_name} at the requested point is missing."
        )

    data_date = eccodes.codes_get(handle, "dataDate")
    data_time = eccodes.codes_get(handle, "dataTime")
    validity_date = eccodes.codes_get(handle, "validityDate")
    validity_time = eccodes.codes_get(handle, "validityTime")

    step = eccodes.codes_get(handle, "step")
    step_range = str(eccodes.codes_get(handle, "stepRange"))

    accumulation_start_step = None
    accumulation_end_step = None
    if "-" in step_range:
        start_text, end_text = step_range.split("-", 1)
        try:
            accumulation_start_step = int(start_text)
            accumulation_end_step = int(end_text)
        except ValueError:
            accumulation_start_step = None
            accumulation_end_step = None

    return {
        "raw_value": raw_value,
        "raw_units": units,
        "forecast_initialization_time_utc": _iso_utc(
            data_date,
            data_time,
        ),
        "valid_time_utc": _iso_utc(
            validity_date,
            validity_time,
        ),
        "forecast_step": _json_value(step),
        "step_range": step_range,
        "accumulation_start_step": accumulation_start_step,
        "accumulation_end_step": accumulation_end_step,
        "accumulation_period_steps": (
            accumulation_end_step - accumulation_start_step
            if accumulation_start_step is not None
            and accumulation_end_step is not None
            else None
        ),
        "nearest_grid_point": {
            "latitude": selected_latitude,
            "longitude": selected_longitude,
            "flat_index": point_index,
        },
    }


def _read_grib(
    path: str,
    target_latitude: float,
    target_longitude: float,
) -> dict[str, dict[str, Any]]:
    fields: dict[str, dict[str, Any]] = {}

    with open(path, "rb") as grib_file:
        while True:
            handle = eccodes.codes_grib_new_from_file(grib_file)
            if handle is None:
                break

            try:
                short_name = str(eccodes.codes_get(handle, "shortName"))
                if short_name not in PARAMETERS:
                    continue

                if short_name in fields:
                    raise ValueError(
                        f"More than one GRIB message was returned for {short_name}."
                    )

                fields[short_name] = _read_message(
                    handle,
                    target_latitude,
                    target_longitude,
                )
            finally:
                eccodes.codes_release(handle)

    missing_parameters = [
        parameter for parameter in PARAMETERS if parameter not in fields
    ]
    if missing_parameters:
        raise ValueError(
            "ECMWF retrieval did not contain required parameters: "
            + ", ".join(missing_parameters)
        )

    return fields


def validate_document(payload: dict[str, Any]) -> None:
    """Validate the final raw ECMWF document before it is written."""
    properties = payload.get("properties")
    if not isinstance(properties, dict):
        raise ValueError("Payload properties are missing.")

    if properties.get("model") != MODEL:
        raise ValueError(f"Payload model must be {MODEL!r}.")

    if properties.get("resolution") != RESOLUTION:
        raise ValueError(f"Payload resolution must be {RESOLUTION!r}.")

    if properties.get("status") != RAW_STATUS:
        raise ValueError(f"Payload status must remain {RAW_STATUS!r}.")

    parameters = properties.get("parameters")
    if not isinstance(parameters, dict):
        raise ValueError("Payload parameters are missing.")

    missing_parameters = [
        parameter for parameter in PARAMETERS if parameter not in parameters
    ]
    if missing_parameters:
        raise ValueError(
            "Payload is missing required parameters: "
            + ", ".join(missing_parameters)
        )

    for parameter in PARAMETERS:
        field = parameters[parameter]
        if not isinstance(field, dict):
            raise ValueError(f"Parameter {parameter} must be an object.")

        raw_value = field.get("raw_value")
        if not isinstance(raw_value, (int, float)) or not math.isfinite(
            float(raw_value)
        ):
            raise ValueError(
                f"Parameter {parameter} must have a finite raw_value."
            )

        raw_units = field.get("raw_units")
        if not isinstance(raw_units, str) or not raw_units.strip():
            raise ValueError(
                f"Parameter {parameter} must preserve non-empty raw_units."
            )

        if not field.get("forecast_initialization_time_utc"):
            raise ValueError(
                f"Parameter {parameter} is missing forecast initialization time."
            )

        if not field.get("valid_time_utc"):
            raise ValueError(
                f"Parameter {parameter} is missing valid time."
            )

        if "forecast_step" not in field or field["forecast_step"] is None:
            raise ValueError(
                f"Parameter {parameter} is missing forecast step."
            )

        nearest_grid_point = field.get("nearest_grid_point")
        if not isinstance(nearest_grid_point, dict):
            raise ValueError(
                f"Parameter {parameter} is missing nearest-grid metadata."
            )

        for coordinate_name in ("latitude", "longitude"):
            coordinate = nearest_grid_point.get(coordinate_name)
            if not isinstance(coordinate, (int, float)) or not math.isfinite(
                float(coordinate)
            ):
                raise ValueError(
                    f"Parameter {parameter} has an invalid nearest-grid "
                    f"{coordinate_name}."
                )

    for parameter in ("ssrd", "strd"):
        field = parameters[parameter]
        step_range = field.get("step_range")
        if not isinstance(step_range, str) or not step_range.strip():
            raise ValueError(
                f"{parameter} must preserve a non-empty actual GRIB stepRange."
            )

        start_step = field.get("accumulation_start_step")
        end_step = field.get("accumulation_end_step")
        accumulation_period = field.get("accumulation_period_steps")

        if not isinstance(start_step, int) or not isinstance(end_step, int):
            raise ValueError(
                f"{parameter} must preserve valid accumulation start/end steps."
            )

        if accumulation_period != end_step - start_step:
            raise ValueError(
                f"{parameter} accumulation period must equal "
                "end_step - start_step."
            )

        normalized_units = field["raw_units"].strip().lower().replace("²", "2")
        if normalized_units in {"w/m2", "w m-2", "w m^-2", "watt per square metre"}:
            raise ValueError(
                f"{parameter} appears to have been converted to W/m²."
            )


def fetch_ecmwf(
    latitude: float,
    longitude: float,
    output: str | os.PathLike[str] | None = None,
) -> dict[str, Any]:
    _validate_coordinates(latitude, longitude)

    area = _subset_area(latitude, longitude)

    # Deliberately omit date and time. ECMWF Open Data selects the latest
    # available matching forecast. Initialization and valid times are read
    # from the returned GRIB metadata instead of being synthesized locally.
    client = Client(
        source="ecmwf",
        model=MODEL,
        resol=RESOLUTION,
        maximum_retries=ECMWF_MAX_RETRIES,
        retry_after=ECMWF_RETRY_AFTER,
        use_server_retry_after=True,
    )

    temporary_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            prefix="ecmwf-",
            suffix=".grib",
            delete=False,
        ) as temporary_file:
            temporary_path = temporary_file.name

        client.retrieve(
            type="fc",
            levtype="sfc",
            param=list(PARAMETERS),
            step=FORECAST_STEP,
            area=area,
            target=temporary_path,
        )

        fields = _read_grib(
            temporary_path,
            latitude,
            longitude,
        )
    finally:
        if temporary_path is not None:
            Path(temporary_path).unlink(missing_ok=True)

    initialization_times = {
        field["forecast_initialization_time_utc"]
        for field in fields.values()
    }
    valid_times = {
        field["valid_time_utc"]
        for field in fields.values()
    }

    if len(initialization_times) != 1:
        raise ValueError(
            "Retrieved GRIB messages do not share one forecast "
            "initialization time."
        )
    if len(valid_times) != 1:
        raise ValueError(
            "Retrieved GRIB messages do not share one forecast valid time."
        )

    retrieved_at = datetime.now(timezone.utc).isoformat().replace(
        "+00:00",
        "Z",
    )

    payload = {
        "type": "Feature",
        "geometry": {
            "type": "Point",
            "coordinates": [
                _wrapped_longitude(longitude),
                float(latitude),
            ],
        },
        "properties": {
            "source": "ECMWF Open Data",
            "source_id": "ecmwf_opendata",
            "data_type": "forecast",
            "model": MODEL,
            "resolution": RESOLUTION,
            "requested_coordinate": {
                "latitude": float(latitude),
                "longitude": float(longitude),
            },
            "forecast_initialization_time_utc": next(
                iter(initialization_times)
            ),
            "forecast_valid_time_utc": next(iter(valid_times)),
            "forecast_step_requested": FORECAST_STEP,
            "parameters": fields,
            "status": RAW_STATUS,
        },
        "provenance": {
            "provider": "ECMWF Open Data",
            "source_id": "ecmwf_opendata",
            "client_source": "ecmwf",
            "model": MODEL,
            "resolution": RESOLUTION,
            "parameters": list(PARAMETERS),
            "subset_area": area,
            "retrieved_at": retrieved_at,
            "note": (
                "Raw GRIB values and native GRIB units are preserved. "
                "The payload is raw/not normalized."
            ),
        },
        "quality": {
            "quality_flag": "acceptable",
            "missing_fields": [],
            "status": RAW_STATUS,
            "notes": (
                "Nearest selection used paired GRIB latitude/longitude "
                "arrays. ssrd and strd retain their actual GRIB stepRange "
                "metadata; no accumulation period was inferred from the "
                "forecast step."
            ),
        },
    }

    if output is not None:
        validate_document(payload)
        output_path = Path(output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(
            json.dumps(payload, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )

    return payload


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Retrieve raw ECMWF Open Data at a coordinate."
    )
    parser.add_argument("--latitude", type=float, required=True)
    parser.add_argument("--longitude", type=float, required=True)
    parser.add_argument("--output", required=True)
    arguments = parser.parse_args()

    fetch_ecmwf(
        latitude=arguments.latitude,
        longitude=arguments.longitude,
        output=arguments.output,
    )


if __name__ == "__main__":
    main()
