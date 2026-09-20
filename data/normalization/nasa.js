"use strict";

const NASA_SOURCE_ID = "nasa_power";
const NASA_SOURCE_NAME =
  "NASA Prediction Of Worldwide Energy Resources (POWER)";

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function cloneValue(value) {
  if (value === null || typeof value !== "object") {
    return value;
  }

  return JSON.parse(JSON.stringify(value));
}

function coerceNullableNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }

  return isFiniteNumber(value) ? value : null;
}

function rawRecordRef(name, record) {
  const source = record && typeof record === "object" ? record : null;

  const locationName =
    source?.location?.name ||
    source?.name ||
    "nasa-power";

  const timestamp =
    source?.time?.timestamp ||
    source?.timestamp ||
    "unknown-timestamp";

  return `${NASA_SOURCE_ID}:${name}:${locationName}:${timestamp}`;
}

function buildVariableLineage({
  canonicalVariable,
  sourceVariable,
  nativeValue,
  nativeUnit,
  normalizedValue,
  normalizedUnit,
  status,
  transformation,
  inputVariables = [],
  rawRecordRefValue,
  sourceTimestamp = null,
  forecastInitializationTime = null,
  forecastValidTime = null,
  forecastStep = null,
  stepRange = null,
  accumulation = null
}) {
  return {
    canonical_variable: canonicalVariable,
    source_variable: sourceVariable,
    native_value: nativeValue,
    native_unit: nativeUnit,
    normalized_value: normalizedValue,
    normalized_unit: normalizedUnit,
    status,
    transformation,
    input_variables: inputVariables,
    raw_record_ref: rawRecordRefValue,
    source_timestamp: sourceTimestamp,
    forecast_initialization_time: forecastInitializationTime,
    forecast_valid_time: forecastValidTime,
    forecast_step: forecastStep,
    step_range: stepRange,
    accumulation
  };
}

function normalizeNASARecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new TypeError("NASA record must be an object.");
  }

  const location = record.location;
  const time = record.time;
  const environment = record.environment;
  const provenance = record.provenance;
  const quality = record.quality;

  if (!location || typeof location !== "object") {
    throw new Error("NASA record is missing location.");
  }

  if (!time || typeof time !== "object") {
    throw new Error("NASA record is missing time.");
  }

  if (!environment || typeof environment !== "object") {
    throw new Error("NASA record is missing environment.");
  }

  if (!provenance || typeof provenance !== "object") {
    throw new Error("NASA record is missing provenance.");
  }

  if (!quality || typeof quality !== "object") {
    throw new Error("NASA record is missing quality.");
  }

  if (
    typeof location.name !== "string" ||
    !Number.isFinite(location.latitude) ||
    !Number.isFinite(location.longitude)
  ) {
    throw new Error("NASA record location is malformed.");
  }

  if (
    typeof time.timestamp !== "string" ||
    !Date.parse(time.timestamp)
  ) {
    throw new Error("NASA record time.timestamp must be a valid ISO date-time string.");
  }

  const airTemperatureC = coerceNullableNumber(
    environment.air_temperature_c
  );
  const relativeHumidityPct = coerceNullableNumber(
    environment.relative_humidity_pct
  );
  const windSpeedMs = coerceNullableNumber(
    environment.wind_speed_ms
  );
  const solarRadiationWm2 = coerceNullableNumber(
    environment.solar_radiation_wm2
  );
  const dewPointC = coerceNullableNumber(
    environment.dew_point_c
  );
  const nasaWetBulbRelatedC = coerceNullableNumber(
    environment.nasa_wet_bulb_related_c
  );

  const missingFields = Array.isArray(quality.missing_fields)
    ? quality.missing_fields.slice()
    : [];

  const provenanceVariables = [
    buildVariableLineage({
      canonicalVariable: "air_temperature_c",
      sourceVariable: "T2M",
      nativeValue: airTemperatureC,
      nativeUnit: "degC",
      normalizedValue: airTemperatureC,
      normalizedUnit: "degC",
      status: airTemperatureC === null ? "missing" : "source",
      transformation:
        airTemperatureC === null
          ? null
          : "NASA POWER T2M is preserved as the normalized air temperature. No conversion is applied.",
      inputVariables: ["T2M"],
      rawRecordRefValue: rawRecordRef("T2M", record),
      sourceTimestamp: time.timestamp,
      forecastInitializationTime:
        time.forecast_initialization_time || null,
      forecastValidTime: time.forecast_valid_time || null,
      forecastStep: time.forecast_step ?? null,
      stepRange: time.step_range || null
    }),
    buildVariableLineage({
      canonicalVariable: "relative_humidity_pct",
      sourceVariable: "RH2M",
      nativeValue: relativeHumidityPct,
      nativeUnit: "%",
      normalizedValue: relativeHumidityPct,
      normalizedUnit: "%",
      status: relativeHumidityPct === null ? "missing" : "source",
      transformation:
        relativeHumidityPct === null
          ? null
          : "NASA POWER RH2M is preserved as the normalized relative humidity.",
      inputVariables: ["RH2M"],
      rawRecordRefValue: rawRecordRef("RH2M", record),
      sourceTimestamp: time.timestamp,
      forecastInitializationTime:
        time.forecast_initialization_time || null,
      forecastValidTime: time.forecast_valid_time || null,
      forecastStep: time.forecast_step ?? null,
      stepRange: time.step_range || null
    }),
    buildVariableLineage({
      canonicalVariable: "wind_speed_ms",
      sourceVariable: "WS10M",
      nativeValue: windSpeedMs,
      nativeUnit: "m/s",
      normalizedValue: windSpeedMs,
      normalizedUnit: "m/s",
      status: windSpeedMs === null ? "missing" : "source",
      transformation:
        windSpeedMs === null
          ? null
          : "NASA POWER WS10M is preserved as the normalized wind speed magnitude.",
      inputVariables: ["WS10M"],
      rawRecordRefValue: rawRecordRef("WS10M", record),
      sourceTimestamp: time.timestamp,
      forecastInitializationTime:
        time.forecast_initialization_time || null,
      forecastValidTime: time.forecast_valid_time || null,
      forecastStep: time.forecast_step ?? null,
      stepRange: time.step_range || null
    }),
    buildVariableLineage({
      canonicalVariable: "solar_radiation_wm2",
      sourceVariable: "ALLSKY_SFC_SW_DWN",
      nativeValue: solarRadiationWm2,
      nativeUnit: "W/m2",
      normalizedValue: solarRadiationWm2,
      normalizedUnit: solarRadiationWm2 === null ? null : "W/m2",
      status: solarRadiationWm2 === null ? "missing" : "source",
      transformation:
        solarRadiationWm2 === null
          ? "NASA POWER solar radiation is absent or null; no estimate is fabricated."
          : "NASA POWER ALLSKY_SFC_SW_DWN is preserved as the normalized solar radiation value.",
      inputVariables: ["ALLSKY_SFC_SW_DWN"],
      rawRecordRefValue: rawRecordRef("ALLSKY_SFC_SW_DWN", record),
      sourceTimestamp: time.timestamp,
      forecastInitializationTime:
        time.forecast_initialization_time || null,
      forecastValidTime: time.forecast_valid_time || null,
      forecastStep: time.forecast_step ?? null,
      stepRange: time.step_range || null
    }),
    buildVariableLineage({
      canonicalVariable: "dew_point_c",
      sourceVariable: "T2MDEW",
      nativeValue: dewPointC,
      nativeUnit: "degC",
      normalizedValue: dewPointC,
      normalizedUnit: dewPointC === null ? null : "degC",
      status: dewPointC === null ? "missing" : "source",
      transformation:
        dewPointC === null
          ? null
          : "NASA POWER T2MDEW is preserved as the normalized dew-point temperature.",
      inputVariables: ["T2MDEW"],
      rawRecordRefValue: rawRecordRef("T2MDEW", record),
      sourceTimestamp: time.timestamp,
      forecastInitializationTime:
        time.forecast_initialization_time || null,
      forecastValidTime: time.forecast_valid_time || null,
      forecastStep: time.forecast_step ?? null,
      stepRange: time.step_range || null
    }),
    buildVariableLineage({
      canonicalVariable: "nasa_wet_bulb_related_c",
      sourceVariable: "T2MWET",
      nativeValue: nasaWetBulbRelatedC,
      nativeUnit: nasaWetBulbRelatedC === null ? null : "degC",
      normalizedValue: nasaWetBulbRelatedC,
      normalizedUnit: nasaWetBulbRelatedC === null ? null : "degC",
      status: nasaWetBulbRelatedC === null ? "missing" : "source",
      transformation:
        "NASA POWER T2MWET is retained only as wet-bulb-related context. It is not treated as a measured natural wet-bulb temperature.",
      inputVariables: ["T2MWET"],
      rawRecordRefValue: rawRecordRef("T2MWET", record),
      sourceTimestamp: time.timestamp,
      forecastInitializationTime:
        time.forecast_initialization_time || null,
      forecastValidTime: time.forecast_valid_time || null,
      forecastStep: time.forecast_step ?? null,
      stepRange: time.step_range || null
    })
  ];

  const normalizedQuality = {
    quality_flag:
      typeof quality.quality_flag === "string"
        ? quality.quality_flag
        : missingFields.length > 0
          ? "missing"
          : "acceptable",
    missing_fields: missingFields,
    notes:
      typeof quality.notes === "string"
        ? quality.notes
        : "NASA POWER record preserved without derivation or estimation."
  };

  return {
    location: cloneValue(location),
    time: cloneValue(time),
    environment: {
      air_temperature_c: airTemperatureC,
      relative_humidity_pct: relativeHumidityPct,
      wind_speed_ms: windSpeedMs,
      solar_radiation_wm2: solarRadiationWm2,
      dew_point_c: dewPointC
    },
    provenance: {
      source_id: provenance.source_id || NASA_SOURCE_ID,
      source_name: provenance.source_name || NASA_SOURCE_NAME,
      data_type: provenance.data_type || "reanalysis",
      data_status: provenance.data_status || null,
      variable: provenance.variable || null,
      units: provenance.units || null,
      retrieved_at: provenance.retrieved_at || null,
      variables: provenanceVariables
    },
    quality: normalizedQuality
  };
}

if (typeof window !== "undefined") {
  window.normalizeNASARecord = normalizeNASARecord;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    NASA_SOURCE_ID,
    NASA_SOURCE_NAME,
    normalizeNASARecord
  };
}
