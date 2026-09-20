(function () {
"use strict";

const DATA_TYPES = new Set([
  "observation",
  "reanalysis",
  "forecast",
  "satellite",
  "derived"
]);

const VALUE_RANGES = Object.freeze({
  air_temperature_c: { minimum: -80, maximum: 60 },
  relative_humidity_pct: { minimum: 0, maximum: 100 },
  wind_speed_ms: { minimum: 0 },
  wind_direction_deg: { minimum: 0, maximum: 360 },
  pressure_hpa: { minimum: 0 },
  solar_radiation_wm2: { minimum: 0 },
  rainfall_mm: { minimum: 0 }
});

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isPresentString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isValidTimestamp(value) {
  return isPresentString(value) && Number.isFinite(Date.parse(value));
}

function getMetadata(record) {
  const provenance = isObject(record.provenance) ? record.provenance : {};
  const quality = isObject(record.quality) ? record.quality : {};
  const location = record.location;

  return {
    sourceId: record.source_id ?? provenance.source_id,
    sourceName: record.source_name ?? provenance.source_name,
    dataType: record.data_type ?? provenance.data_type,
    unit: record.unit ?? provenance.units,
    timestamp: record.timestamp ?? record.time?.timestamp,
    retrievedAt: record.retrieved_at ?? provenance.retrieved_at,
    location,
    qualityFlag: record.quality_flag ?? quality.quality_flag ?? quality.status
  };
}

function getVariables(record) {
  if (isPresentString(record.variable)) {
    return [{
      name: record.variable,
      value: record.value,
      unit: record.unit,
      lineage: null
    }];
  }

  const environment = isObject(record.environment) ? record.environment : {};
  const lineage = record.provenance?.variables;

  if (Array.isArray(lineage) && lineage.length > 0) {
    return lineage.map((entry) => ({
      name: entry?.canonical_variable,
      value: entry?.canonical_variable
        ? environment[entry.canonical_variable]
        : undefined,
      unit: entry?.normalized_unit,
      lineage: entry
    }));
  }

  return Object.keys(environment).map((name) => ({
    name,
    value: environment[name],
    unit: null,
    lineage: null
  }));
}

function validateLocation(location) {
  if (!isObject(location)) {
    return "Location is missing.";
  }

  if (!isFiniteNumber(location.latitude) || !isFiniteNumber(location.longitude)) {
    return "Location latitude and longitude must be finite numbers.";
  }

  if (location.latitude < -90 || location.latitude > 90) {
    return "Location latitude is outside the schema range -90 to 90.";
  }

  if (location.longitude < -180 || location.longitude > 180) {
    return "Location longitude is outside the schema range -180 to 180.";
  }

  return null;
}

function validateRecordMetadata(metadata, unit) {
  const reasons = [];

  if (!isPresentString(metadata.sourceId)) {
    reasons.push("Source provenance/source_id is missing.");
  }

  if (!isPresentString(metadata.sourceName)) {
    reasons.push("Source provenance/source_name is missing.");
  }

  if (!DATA_TYPES.has(metadata.dataType)) {
    reasons.push(
      "Data type must be observation, reanalysis, forecast, satellite, or derived."
    );
  }

  if (!isPresentString(unit)) {
    reasons.push("A normalized unit is required.");
  }

  if (!isPresentString(metadata.timestamp)) {
    reasons.push("A timestamp is required.");
  } else if (!isValidTimestamp(metadata.timestamp)) {
    reasons.push("Timestamp must be a valid date-time string.");
  }

  if (!isPresentString(metadata.retrievedAt)) {
    reasons.push("A provenance retrieved_at timestamp is required.");
  } else if (!isValidTimestamp(metadata.retrievedAt)) {
    reasons.push("Provenance retrieved_at must be a valid date-time string.");
  }

  const locationReason = validateLocation(metadata.location);
  if (locationReason) {
    reasons.push(locationReason);
  }

  if (!isPresentString(metadata.qualityFlag)) {
    reasons.push("The existing source quality flag is required.");
  } else if (!["good", "acceptable", "poor", "missing"].includes(metadata.qualityFlag)) {
    reasons.push("Quality flag must be good, acceptable, poor, or missing.");
  }

  return reasons;
}

function validateValue(variable, value) {
  if (value === null || value === undefined) {
    return {
      status: "missing_value",
      reasons: ["Variable value is null or missing."]
    };
  }

  if (!isFiniteNumber(value)) {
    return {
      status: "invalid_value",
      reasons: ["Variable value must be a finite number."]
    };
  }

  const range = VALUE_RANGES[variable];
  if (range && (
    (range.minimum !== undefined && value < range.minimum) ||
    (range.maximum !== undefined && value > range.maximum)
  )) {
    const bounds = [
      range.minimum === undefined ? null : range.minimum,
      range.maximum === undefined ? null : range.maximum
    ].filter((bound) => bound !== null).join(" to ");

    return {
      status: "invalid_value",
      reasons: [`Variable value is outside the schema range ${bounds}.`]
    };
  }

  return { status: "eligible", reasons: [] };
}

function evaluateVariable(record, variable) {
  const metadata = getMetadata(record);
  const reasons = [];

  if (!isPresentString(variable.name)) {
    return {
      variable: variable.name ?? null,
      status: "incompatible_record",
      reasons: ["A canonical variable name is required."],
      original_record: record
    };
  }

  const valueResult = validateValue(variable.name, variable.value);
  if (valueResult.status === "missing_value" || valueResult.status === "invalid_value") {
    return {
      variable: variable.name,
      status: valueResult.status,
      reasons: valueResult.reasons,
      original_record: record
    };
  }

  if (!isPresentString(variable.unit ?? metadata.unit)) {
    reasons.push("A normalized unit is required for this variable.");
  }

  reasons.push(...validateRecordMetadata(metadata, variable.unit ?? metadata.unit));

  if (metadata.qualityFlag === "poor") {
    return {
      variable: variable.name,
      status: "poor_quality",
      reasons: ["Existing source quality flag is poor.", ...reasons],
      original_record: record
    };
  }

  if (metadata.qualityFlag === "missing") {
    return {
      variable: variable.name,
      status: "missing_value",
      reasons: ["Existing source quality flag marks the value as missing.", ...reasons],
      original_record: record
    };
  }

  if (reasons.some((reason) => reason.startsWith("Data type must be"))) {
    return {
      variable: variable.name,
      status: "incompatible_record",
      reasons,
      original_record: record
    };
  }

  if (reasons.some((reason) => reason.startsWith("Quality flag must be"))) {
    return {
      variable: variable.name,
      status: "incompatible_record",
      reasons,
      original_record: record
    };
  }

  if (reasons.length > 0) {
    return {
      variable: variable.name,
      status: "incomplete_provenance",
      reasons,
      original_record: record
    };
  }

  return {
    variable: variable.name,
    status: "eligible",
    reasons: [],
    original_record: record
  };
}

function evaluateRecord(record) {
  if (!isObject(record)) {
    return {
      status: "incompatible_record",
      results: [],
      reasons: ["A normalized source record object is required."],
      original_record: record
    };
  }

  const variables = getVariables(record);
  if (variables.length === 0) {
    return {
      status: "incompatible_record",
      results: [],
      reasons: ["Record contains no individual variable value to evaluate."],
      original_record: record
    };
  }

  const results = variables.map((variable) => evaluateVariable(record, variable));
  const statusOrder = [
    "incompatible_record",
    "incomplete_provenance",
    "poor_quality",
    "invalid_value",
    "missing_value",
    "eligible"
  ];
  const status = statusOrder.find((candidate) =>
    results.some((result) => result.status === candidate)
  );

  return {
    status,
    results,
    reasons: results.flatMap((result) => result.reasons),
    original_record: record
  };
}

function evaluateRecords(records) {
  if (!Array.isArray(records)) {
    throw new TypeError("Normalized source records must be an array.");
  }

  return records.map(evaluateRecord);
}

if (typeof window !== "undefined") {
  window.ThermalShieldFusionQualityGate = {
    evaluateRecord,
    evaluateRecords
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    evaluateRecord,
    evaluateRecords
  };
}
})();
