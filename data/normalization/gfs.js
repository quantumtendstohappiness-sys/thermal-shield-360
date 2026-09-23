/**
 * Thermal Shield 360
 * NOAA GFS source-specific normalizer.
 *
 * Accepts the raw location-aware GFS Feature returned by /api/gfs.
 * No RH, solar radiation, thermal index, wet-bulb, or globe-temperature
 * values are fabricated.
 */
"use strict";

const GFS_SOURCE_ID = "noaa_gfs_0p25";
const GFS_SOURCE_NAME = "NOAA GFS";

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function lineage(canonicalVariable, sourceVariable, nativeValue, nativeUnit,
                 normalizedValue, normalizedUnit, status, transformation,
                 sourceTimestamp, initialization, validTime, step,
                 sourceGrid, rawRef) {
  return {
    canonical_variable: canonicalVariable,
    source_variable: sourceVariable,
    native_value: nativeValue,
    native_unit: nativeUnit,
    normalized_value: normalizedValue,
    normalized_unit: normalizedUnit,
    status,
    input_variables: [],
    transformation: transformation || null,
    source_timestamp: sourceTimestamp || null,
    forecast_initialization_time: initialization || null,
    forecast_valid_time: validTime || null,
    forecast_step: step ?? null,
    step_range: null,
    raw_record_ref: rawRef || null,
    accumulation: null,
    source_grid: sourceGrid || null
  };
}

function normalizeGFSPayload(rawPayload) {
  if (!rawPayload || typeof rawPayload !== "object") {
    throw new TypeError("GFS payload must be an object.");
  }

  const properties = rawPayload.properties || (rawPayload.environment ? rawPayload : null);
  if (!properties || typeof properties !== "object") {
    throw new Error("GFS payload is missing properties.");
  }

  const environment = properties.environment;
  if (!environment || typeof environment !== "object") {
    throw new Error("GFS payload is missing environment.");
  }

  const requested =
    properties.requested_coordinates ||
    properties.requested_coordinate ||
    null;

  const grid =
    properties.grid_coordinates ||
    null;

  const validTime = properties.valid_time_utc || null;
  const initialization =
    properties.forecast_initialization_time_utc || null;
  const step = finite(properties.forecast_step_hours)
    ? properties.forecast_step_hours
    : null;

  const air = finite(environment.air_temperature_c)
    ? environment.air_temperature_c : null;
  const dew = finite(environment.dew_point_c)
    ? environment.dew_point_c : null;
  const u = finite(environment.wind_u_ms)
    ? environment.wind_u_ms : null;
  const v = finite(environment.wind_v_ms)
    ? environment.wind_v_ms : null;
  const wind = finite(environment.wind_speed_ms)
    ? environment.wind_speed_ms
    : (u !== null && v !== null ? Math.hypot(u, v) : null);

  const rh = finite(environment.relative_humidity_pct)
    ? environment.relative_humidity_pct : null;
  const solar = finite(environment.solar_radiation_wm2)
    ? environment.solar_radiation_wm2 : null;

  const missing = [];
  if (air === null) missing.push("environment.air_temperature_c");
  if (dew === null) missing.push("environment.dew_point_c");
  if (wind === null) missing.push("environment.wind_speed_ms");
  if (rh === null) missing.push("environment.relative_humidity_pct");
  if (solar === null) missing.push("environment.solar_radiation_wm2");

  const unavailable = [
    "environment.wind_direction_deg",
    "environment.pressure_hpa",
    "environment.rainfall_mm",
    "environment.surface_temperature_c"
  ];

  const rawRef = `${GFS_SOURCE_ID}:${initialization || "unknown"}:${validTime || "unknown"}`;

  const variables = [
    lineage(
      "air_temperature_c", "2t", air, "K", air, "degC",
      air === null ? "missing" : "normalized",
      air === null ? null : "GFS backend normalized 2t from K to degC",
      validTime, initialization, validTime, step, grid, rawRef
    ),
    lineage(
      "dew_point_c", "2d", dew, "K", dew, "degC",
      dew === null ? "missing" : "normalized",
      dew === null ? null : "GFS backend normalized 2d from K to degC",
      validTime, initialization, validTime, step, grid, rawRef
    ),
    lineage(
      "wind_u", "10u", u, "m/s", u, "m/s",
      u === null ? "missing" : "source",
      null, validTime, initialization, validTime, step, grid, rawRef
    ),
    lineage(
      "wind_v", "10v", v, "m/s", v, "m/s",
      v === null ? "missing" : "source",
      null, validTime, initialization, validTime, step, grid, rawRef
    ),
    lineage(
      "wind_speed_ms", "10u,10v", null, "m/s", wind, "m/s",
      wind === null ? "missing" : "derived",
      wind === null ? null : "wind_speed_ms = sqrt(10u^2 + 10v^2)",
      validTime, initialization, validTime, step, grid, rawRef
    ),
    lineage(
      "relative_humidity_pct", "2r", rh, "%",
      rh, "%",
      rh === null ? "missing" : "source",
      null,
      validTime, initialization, validTime, step, grid, rawRef
    ),
    lineage(
      "solar_radiation_wm2", "dswrf", solar, "W/m2",
      solar, "W/m2",
      solar === null ? "missing" : "source",
      null,
      validTime, initialization, validTime, step, grid, rawRef
    )
  ];

  return {
    location: {
      name: "NOAA GFS 0.25 degree grid point",
      latitude: grid?.latitude ?? null,
      longitude: grid?.longitude ?? null,
      requested_coordinate: requested,
      source_grid: grid
    },
    time: {
      timestamp: validTime,
      timezone: "UTC",
      forecast_lead_hours: step,
      forecast_initialization_time: initialization,
      forecast_valid_time: validTime,
      forecast_step: step,
      step_range: null,
      accumulation: null
    },
    environment: {
      air_temperature_c: air,
      relative_humidity_pct: rh,
      wind_speed_ms: wind,
      wind_direction_deg: null,
      dew_point_c: dew,
      pressure_hpa: null,
      solar_radiation_wm2: solar,
      surface_temperature_c: null,
      rainfall_mm: null
    },
    provenance: {
      source_id: GFS_SOURCE_ID,
      source_name: GFS_SOURCE_NAME,
      data_type: "forecast",
      data_status: "forecast",
      variable: "2t,2d,10u,10v",
      units: "K, K, m/s, m/s",
      retrieved_at: properties.provenance?.retrieved_at || null,
      variables
    },
    quality: {
      quality_flag: missing.length === 0 ? "acceptable" : "missing",
      missing_fields: missing,
      pending_fields: [],
      unavailable_fields: unavailable,
      notes: [
        "NOAA GFS remains forecast/model data.",
        "Requested coordinates and nearest returned grid coordinates remain traceable.",
        "Relative humidity and solar radiation are not fabricated.",
        "Raw source values remain traceable through provenance."
      ].join(" ")
    }
  };
}

if (typeof window !== "undefined") {
  window.normalizeGFSPayload = normalizeGFSPayload;
}
