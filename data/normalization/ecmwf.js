/**
 * Thermal Shield 360
 * ECMWF source-specific normalizer.
 *
 * This module accepts the raw ECMWF payload produced by
 * data/adapters/ecmwf_adapter.py.
 *
 * It does not fetch data, modify raw data, derive relative humidity,
 * calculate wind direction, or calculate thermal indices.
 */

"use strict";

const ECMWF_SOURCE_ID = "ecmwf_opendata";
const ECMWF_SOURCE_NAME = "ECMWF Open Data";

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function requireFinite(value, label) {
  if (!isFiniteNumber(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }

  return value;
}

function kelvinToCelsius(value, label) {
  return requireFinite(value, label) - 273.15;
}

const STEP_UNIT_SECONDS = {
  second: 1,
  seconds: 1,
  s: 1,
  minute: 60,
  minutes: 60,
  min: 60,
  hour: 3600,
  hours: 3600,
  h: 3600,
  day: 86400,
  days: 86400,
  d: 86400
};

function stepUnitSeconds(value) {
  if (typeof value !== "string") {
    return null;
  }

  return STEP_UNIT_SECONDS[value.trim().toLowerCase()] || null;
}

function optionalRawValue(field) {
  if (!field || !isFiniteNumber(field.raw_value)) {
    return null;
  }

  return field.raw_value;
}

function energyPerAreaUnit(value) {
  if (typeof value !== "string") {
    return false;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/²/g, "2")
    .replace(/−/g, "-");

  return [
    "j m**-2",
    "j m^-2",
    "j m-2",
    "j/m2",
    "j m2-1"
  ].includes(normalized);
}

function accumulationMetadata(field, initializationTime, validTime, forecastStep) {
  if (!field || !isFiniteNumber(forecastStep) || forecastStep <= 0) {
    return null;
  }

  const startStep = field.accumulation_start_step;
  const endStep = field.accumulation_end_step;
  const periodSteps = field.accumulation_period_steps;

  if (
    !isFiniteNumber(startStep) ||
    !isFiniteNumber(endStep) ||
    endStep <= startStep ||
    (periodSteps !== null &&
      periodSteps !== undefined &&
      (!isFiniteNumber(periodSteps) || periodSteps !== endStep - startStep))
  ) {
    return null;
  }

  const stepRangeMatch =
    typeof field.step_range === "string"
      ? field.step_range.trim().match(/^(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)$/)
      : null;

  if (
    !stepRangeMatch ||
    Number(stepRangeMatch[1]) !== startStep ||
    Number(stepRangeMatch[2]) !== endStep
  ) {
    return null;
  }

  const explicitStepUnit =
    field.step_unit ||
    field.step_units ||
    field.forecast_step_unit ||
    null;
  let secondsPerStep = stepUnitSeconds(explicitStepUnit);
  let stepUnit = explicitStepUnit;

  if (explicitStepUnit && secondsPerStep === null) {
    return null;
  }

  if (secondsPerStep === null) {
    const initializationMilliseconds = Date.parse(initializationTime);
    const validMilliseconds = Date.parse(validTime);
    const elapsedSeconds =
      (validMilliseconds - initializationMilliseconds) / 1000;

    if (
      !Number.isFinite(initializationMilliseconds) ||
      !Number.isFinite(validMilliseconds) ||
      !Number.isFinite(elapsedSeconds) ||
      elapsedSeconds <= 0
    ) {
      return null;
    }

    secondsPerStep = elapsedSeconds / forecastStep;
    const recognizedUnit = Object.entries(STEP_UNIT_SECONDS).find(
      ([, seconds]) => Math.abs(secondsPerStep - seconds) < 1e-9
    );

    if (!recognizedUnit) {
      return null;
    }

    stepUnit = recognizedUnit[0];
    secondsPerStep = recognizedUnit[1];
  }

  const durationSeconds = (endStep - startStep) * secondsPerStep;

  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return null;
  }

  return {
    start_step: startStep,
    end_step: endStep,
    period_steps: endStep - startStep,
    step_unit: stepUnit,
    seconds_per_step: secondsPerStep,
    duration_seconds: durationSeconds
  };
}

function normalizeSSRD(field, rawValue, initializationTime, validTime, forecastStep) {
  const accumulation = accumulationMetadata(
    field,
    initializationTime,
    validTime,
    forecastStep
  );

  if (
    rawValue === null ||
    !energyPerAreaUnit(field?.raw_units) ||
    !accumulation
  ) {
    return {
      value: null,
      accumulation,
      transformation: null,
      status: "missing"
    };
  }

  return {
    value: rawValue / accumulation.duration_seconds,
    accumulation,
    transformation:
      "solar_radiation_wm2 = ssrd_J_m2 / " +
      "accumulation_duration_seconds; accumulation-period average, " +
      "not instantaneous irradiance",
    status: "derived"
  };
}

function rawParameter(payload, parameterName) {
  const field = payload?.properties?.parameters?.[parameterName];

  if (!field || typeof field !== "object") {
    return null;
  }

  return field;
}

function rawValue(field, label) {
  if (
    !field ||
    field.raw_value === null ||
    field.raw_value === undefined
  ) {
    return null;
  }

  return requireFinite(field.raw_value, label);
}

function rawReference(parameterName, field) {
  const initialization =
    field?.forecast_initialization_time_utc ||
    "unknown-initialization";

  const valid =
    field?.valid_time_utc ||
    "unknown-valid-time";

  return `${ECMWF_SOURCE_ID}:${parameterName}:${initialization}:${valid}`;
}

function variableLineage({
  canonicalVariable,
  sourceVariable,
  nativeValue,
  nativeUnit,
  normalizedValue,
  normalizedUnit,
  status,
  transformation = null,
  sourceTimestamp = null,
  forecastInitializationTime = null,
  forecastValidTime = null,
  forecastStep = null,
  stepRange = null,
  rawRecordRef = null,
  inputVariables = [],
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
    input_variables: inputVariables,
    transformation,
    source_timestamp: sourceTimestamp,
    forecast_initialization_time: forecastInitializationTime,
    forecast_valid_time: forecastValidTime,
    forecast_step: forecastStep,
    step_range: stepRange,
    raw_record_ref: rawRecordRef,
    accumulation
  };
}

function normalizeECMWFPayload(rawPayload) {
  if (!rawPayload || typeof rawPayload !== "object") {
    throw new TypeError("ECMWF payload must be an object.");
  }

  const properties = rawPayload.properties;

  if (!properties || typeof properties !== "object") {
    throw new Error("ECMWF payload is missing properties.");
  }

  if (properties.status !== "raw/not normalized") {
    throw new Error(
      "ECMWF payload must have status 'raw/not normalized'."
    );
  }

  const parameters = properties.parameters;

  if (!parameters || typeof parameters !== "object") {
    throw new Error("ECMWF payload is missing parameters.");
  }

  const airField = rawParameter(rawPayload, "2t");
  const dewPointField = rawParameter(rawPayload, "2d");
  const uField = rawParameter(rawPayload, "10u");
  const vField = rawParameter(rawPayload, "10v");
  const radiationField = rawParameter(rawPayload, "ssrd");
  const skinField = rawParameter(rawPayload, "skt");

  const airRaw = rawValue(
    airField,
    "ECMWF 2t raw_value"
  );

  const dewPointRaw = rawValue(
    dewPointField,
    "ECMWF 2d raw_value"
  );

  const uRaw = rawValue(
    uField,
    "ECMWF 10u raw_value"
  );

  const vRaw = rawValue(
    vField,
    "ECMWF 10v raw_value"
  );

  const radiationRaw = optionalRawValue(radiationField);

  const skinRaw = rawValue(
    skinField,
    "ECMWF skt raw_value"
  );

  const airTemperatureC =
    airRaw === null
      ? null
      : kelvinToCelsius(
          airRaw,
          "ECMWF 2t raw_value"
        );

  const dewPointC =
    dewPointRaw === null
      ? null
      : kelvinToCelsius(
          dewPointRaw,
          "ECMWF 2d raw_value"
        );

  const windSpeedMs =
    uRaw === null || vRaw === null
      ? null
      : Math.sqrt((uRaw * uRaw) + (vRaw * vRaw));

  const surfaceTemperatureC =
    skinRaw === null
      ? null
      : kelvinToCelsius(
          skinRaw,
          "ECMWF skt raw_value"
        );

  const validTime =
    properties.forecast_valid_time_utc ||
    airField?.valid_time_utc ||
    dewPointField?.valid_time_utc ||
    null;

  const initializationTime =
    properties.forecast_initialization_time_utc ||
    airField?.forecast_initialization_time_utc ||
    dewPointField?.forecast_initialization_time_utc ||
    null;

  const forecastStep =
    properties.forecast_step_requested ??
    airField?.forecast_step ??
    dewPointField?.forecast_step ??
    null;

  const radiationNormalization = normalizeSSRD(
    radiationField,
    radiationRaw,
    radiationField?.forecast_initialization_time_utc ||
      initializationTime,
    radiationField?.valid_time_utc || validTime,
    radiationField?.forecast_step ?? forecastStep
  );

  const requestedCoordinate =
    properties.requested_coordinate || null;

  const sourceGrid =
    airField?.nearest_grid_point ||
    dewPointField?.nearest_grid_point ||
    uField?.nearest_grid_point ||
    vField?.nearest_grid_point ||
    skinField?.nearest_grid_point ||
    radiationField?.nearest_grid_point ||
    null;

  /*
   * Only required/core normalized fields belong in missingFields.
   */
  const missingFields = [];

  if (airTemperatureC === null) {
    missingFields.push("environment.air_temperature_c");
  }

  if (dewPointC === null) {
    missingFields.push("environment.dew_point_c");
  }

  if (windSpeedMs === null) {
    missingFields.push("environment.wind_speed_ms");
  }

  /*
   * These fields are intentionally deferred rather than core-missing.
   */
  const pendingFields = [
    "environment.relative_humidity_pct",
    "environment.solar_radiation_wm2"
  ];

  /*
   * These fields are not supplied by the current ECMWF mapping,
   * or are optional for the current normalized record profile.
   */
  const unavailableFields = [
    "environment.wind_direction_deg",
    "environment.pressure_hpa",
    "environment.rainfall_mm"
  ];

  if (surfaceTemperatureC === null) {
    unavailableFields.push(
      "environment.surface_temperature_c"
    );
  }

  const provenanceVariables = [
    variableLineage({
      canonicalVariable: "air_temperature_c",
      sourceVariable: "2t",
      nativeValue: airRaw,
      nativeUnit: airField?.raw_units || null,
      normalizedValue: airTemperatureC,
      normalizedUnit: "degC",
      status: airRaw === null ? "missing" : "normalized",
      transformation:
        airRaw === null
          ? null
          : "value_C = value_K - 273.15",
      sourceTimestamp: validTime,
      forecastInitializationTime:
        airField?.forecast_initialization_time_utc ||
        initializationTime,
      forecastValidTime:
        airField?.valid_time_utc ||
        validTime,
      forecastStep:
        airField?.forecast_step ??
        forecastStep,
      stepRange: airField?.step_range || null,
      rawRecordRef: rawReference("2t", airField)
    }),

    variableLineage({
      canonicalVariable: "dew_point_c",
      sourceVariable: "2d",
      nativeValue: dewPointRaw,
      nativeUnit: dewPointField?.raw_units || null,
      normalizedValue: dewPointC,
      normalizedUnit: "degC",
      status:
        dewPointRaw === null
          ? "missing"
          : "normalized",
      transformation:
        dewPointRaw === null
          ? null
          : "value_C = value_K - 273.15",
      sourceTimestamp: validTime,
      forecastInitializationTime:
        dewPointField?.forecast_initialization_time_utc ||
        initializationTime,
      forecastValidTime:
        dewPointField?.valid_time_utc ||
        validTime,
      forecastStep:
        dewPointField?.forecast_step ??
        forecastStep,
      stepRange: dewPointField?.step_range || null,
      rawRecordRef: rawReference("2d", dewPointField)
    }),

    variableLineage({
      canonicalVariable: "wind_u",
      sourceVariable: "10u",
      nativeValue: uRaw,
      nativeUnit: uField?.raw_units || null,
      normalizedValue: null,
      normalizedUnit: "m/s",
      status: uRaw === null ? "missing" : "source",
      sourceTimestamp: validTime,
      forecastInitializationTime:
        uField?.forecast_initialization_time_utc ||
        initializationTime,
      forecastValidTime:
        uField?.valid_time_utc ||
        validTime,
      forecastStep:
        uField?.forecast_step ??
        forecastStep,
      stepRange: uField?.step_range || null,
      rawRecordRef: rawReference("10u", uField)
    }),

    variableLineage({
      canonicalVariable: "wind_v",
      sourceVariable: "10v",
      nativeValue: vRaw,
      nativeUnit: vField?.raw_units || null,
      normalizedValue: null,
      normalizedUnit: "m/s",
      status: vRaw === null ? "missing" : "source",
      sourceTimestamp: validTime,
      forecastInitializationTime:
        vField?.forecast_initialization_time_utc ||
        initializationTime,
      forecastValidTime:
        vField?.valid_time_utc ||
        validTime,
      forecastStep:
        vField?.forecast_step ??
        forecastStep,
      stepRange: vField?.step_range || null,
      rawRecordRef: rawReference("10v", vField)
    }),

    variableLineage({
      canonicalVariable: "wind_speed_ms",
      sourceVariable: "10u,10v",
      nativeValue: null,
      nativeUnit: "m/s",
      normalizedValue: windSpeedMs,
      normalizedUnit: "m/s",
      status:
        windSpeedMs === null
          ? "missing"
          : "derived",
      transformation:
        windSpeedMs === null
          ? null
          : "wind_speed_ms = sqrt(10u^2 + 10v^2)",
      sourceTimestamp: validTime,
      forecastInitializationTime:
        uField?.forecast_initialization_time_utc ||
        initializationTime,
      forecastValidTime:
        uField?.valid_time_utc ||
        validTime,
      forecastStep:
        uField?.forecast_step ??
        forecastStep,
      stepRange: uField?.step_range || null,
      inputVariables: ["10u", "10v"],
      rawRecordRef: [
        rawReference("10u", uField),
        rawReference("10v", vField)
      ].join("|")
    }),

    variableLineage({
      canonicalVariable: "surface_temperature_c",
      sourceVariable: "skt",
      nativeValue: skinRaw,
      nativeUnit: skinField?.raw_units || null,
      normalizedValue: surfaceTemperatureC,
      normalizedUnit: "degC",
      status:
        skinRaw === null
          ? "missing"
          : "normalized",
      transformation:
        skinRaw === null
          ? null
          : "value_C = value_K - 273.15; " +
            "source field remains skin temperature",
      sourceTimestamp: validTime,
      forecastInitializationTime:
        skinField?.forecast_initialization_time_utc ||
        initializationTime,
      forecastValidTime:
        skinField?.valid_time_utc ||
        validTime,
      forecastStep:
        skinField?.forecast_step ??
        forecastStep,
      stepRange: skinField?.step_range || null,
      rawRecordRef: rawReference("skt", skinField)
    }),

    /*
     * No ECMWF raw RH field is created. The normalized RH value
     * remains null. "missing" means no normalized RH value exists;
     * the source inputs are preserved and derivation is pending.
     */
    variableLineage({
      canonicalVariable: "relative_humidity_pct",
      sourceVariable: "2t,2d",
      nativeValue: null,
      nativeUnit: null,
      normalizedValue: null,
      normalizedUnit: "%",
      status: "missing",
      transformation:
        "RH derivation intentionally pending. A documented " +
        "saturation-vapour-pressure relationship must be approved " +
        "before calculation. No ECMWF raw RH field is created.",
      sourceTimestamp: validTime,
      forecastInitializationTime: initializationTime,
      forecastValidTime: validTime,
      forecastStep,
      inputVariables: ["2t", "2d"],
      rawRecordRef: [
        rawReference("2t", airField),
        rawReference("2d", dewPointField)
      ].join("|")
    }),

    /*
    * Raw ssrd remains preserved as source data while the normalized
    * value represents the verified accumulation-period average.
     */
    variableLineage({
      canonicalVariable: "solar_radiation_wm2",
      sourceVariable: "ssrd",
      nativeValue: radiationRaw,
      nativeUnit: radiationField?.raw_units || null,
      normalizedValue: radiationNormalization.value,
      normalizedUnit:
        radiationNormalization.value === null ? null : "W/m2",
      status: radiationNormalization.status,
      transformation:
        radiationNormalization.transformation ||
        (radiationField && radiationRaw !== null
          ? "ssrd normalization unavailable because energy-per-area " +
            "units or accumulation metadata are invalid; no value fabricated."
          : "Raw ssrd is unavailable; no radiation value is fabricated."),
      sourceTimestamp:
        radiationField?.valid_time_utc ||
        validTime,
      forecastInitializationTime:
        radiationField?.forecast_initialization_time_utc ||
        initializationTime,
      forecastValidTime:
        radiationField?.valid_time_utc ||
        validTime,
      forecastStep:
        radiationField?.forecast_step ??
        forecastStep,
      stepRange: radiationField?.step_range || null,
      accumulation: radiationNormalization.accumulation,
      rawRecordRef: rawReference("ssrd", radiationField)
    })
  ];

  return {
    location: {
      name: "ECMWF Open Data grid point",
      latitude: requestedCoordinate?.latitude ?? null,
      longitude: requestedCoordinate?.longitude ?? null,
      requested_coordinate: requestedCoordinate,
      source_grid: sourceGrid
    },

    time: {
      timestamp: validTime,
      timezone: "UTC",
      forecast_lead_hours: null,
      forecast_initialization_time: initializationTime,
      forecast_valid_time: validTime,
      forecast_step: forecastStep,
      step_range: radiationField?.step_range || null,
      accumulation: radiationField
        ? {
            start_step:
              radiationField.accumulation_start_step ?? null,
            end_step:
              radiationField.accumulation_end_step ?? null,
            period_steps:
              radiationField.accumulation_period_steps ?? null
          }
        : null
    },

    environment: {
      air_temperature_c: airTemperatureC,
      relative_humidity_pct: null,
      wind_speed_ms: windSpeedMs,
      wind_direction_deg: null,
      dew_point_c: dewPointC,
      pressure_hpa: null,
      solar_radiation_wm2: radiationNormalization.value,
      surface_temperature_c: surfaceTemperatureC,
      rainfall_mm: null
    },

    provenance: {
      source_id: ECMWF_SOURCE_ID,
      source_name: ECMWF_SOURCE_NAME,
      data_type: "forecast",
      data_status: "forecast",
      variable: "2t,2d,10u,10v,ssrd,skt",
      units: "K, K, m/s, m/s, J/m2, K",
      retrieved_at:
        rawPayload.provenance?.retrieved_at ||
        null,
      variables: provenanceVariables
    },

    quality: {
      quality_flag:
        missingFields.length === 0
          ? "acceptable"
          : "missing",
      missing_fields: missingFields,
      pending_fields: pendingFields,
      unavailable_fields: unavailableFields,
      notes: [
        "ECMWF remains forecast/model data.",
        "Raw source values and native units remain traceable.",
        "RH derivation is intentionally pending.",
        "W/m2 normalization for ssrd is intentionally pending.",
        "No wind direction, pressure, rainfall, wet-bulb, or " +
        "globe-temperature value is created."
      ].join(" ")
    }
  };
}

module.exports = {
  normalizeECMWFPayload,
  kelvinToCelsius
};