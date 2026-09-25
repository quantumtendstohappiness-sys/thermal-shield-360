const OPEN_METEO_SOURCE_ID = "open_meteo";
const OPEN_METEO_SOURCE_NAME = "Open-Meteo";

function finite(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function lineage(canonicalVariable, sourceVariable, value, unit) {
  return {
    canonicalVariable,
    sourceVariable,
    native_value: value,
    native_unit: value === null ? null : unit,
    normalized_value: value,
    normalized_unit: value === null ? null : unit,
    status: value === null ? "missing" : "source",
    transformation: value === null
      ? null
      : `Open-Meteo ${sourceVariable} is preserved in its native unit.`,
    input_variables: [sourceVariable],
    source_timestamp: null,
    forecast_initialization_time: null,
    forecast_valid_time: null,
    forecast_step: null,
    step_range: null
  };
}

function normalizeOpenMeteoRecord(record) {
  const current = record?.current || {};
  const location = record?.requested_coordinates || {};
  const environment = {
    air_temperature_c: finite(current.air_temperature_c),
    relative_humidity_pct: finite(current.relative_humidity_pct),
    wind_speed_ms: finite(current.wind_speed_ms),
    solar_radiation_wm2: finite(current.shortwave_radiation_wm2),
    dew_point_c: finite(current.dew_point_c)
  };

  const variables = [
    lineage("air_temperature_c", "temperature_2m", environment.air_temperature_c, "degC"),
    lineage("relative_humidity_pct", "relative_humidity_2m", environment.relative_humidity_pct, "%"),
    lineage("wind_speed_ms", "wind_speed_10m", environment.wind_speed_ms, "m/s"),
    lineage("solar_radiation_wm2", "shortwave_radiation", environment.solar_radiation_wm2, "W/m2"),
    lineage("dew_point_c", "dew_point_2m", environment.dew_point_c, "degC")
  ];

  const missingFields = Object.entries(environment)
    .filter(([, value]) => value === null)
    .map(([key]) => `environment.${key}`);

  return {
    location: {
      latitude: finite(location.latitude),
      longitude: finite(location.longitude)
    },
    time: {
      timestamp: current.timestamp || null,
      forecast_initialization_time: null,
      forecast_valid_time: current.timestamp || null,
      forecast_step: null,
      step_range: null
    },
    environment,
    provenance: {
      source_id: OPEN_METEO_SOURCE_ID,
      source_name: OPEN_METEO_SOURCE_NAME,
      data_type: "forecast",
      data_status: "current",
      variable: null,
      units: null,
      retrieved_at: record?.retrieved_at || null,
      variables
    },
    quality: {
      quality_flag: missingFields.length > 0 ? "missing" : "acceptable",
      missing_fields: missingFields,
      notes: "Open-Meteo values are preserved without fabricated filling or source substitution."
    }
  };
}

if (typeof window !== "undefined") {
  window.normalizeOpenMeteoRecord = normalizeOpenMeteoRecord;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    OPEN_METEO_SOURCE_ID,
    OPEN_METEO_SOURCE_NAME,
    normalizeOpenMeteoRecord
  };
}
