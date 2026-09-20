"use strict";

/**
 * Deterministic pairwise alignment for normalized thermal observations.
 *
 * These defaults are conservative policy defaults, not scientific claims:
 * timestamps must be within 15 minutes and coordinates within 0.1 degrees.
 * Unit and data-type compatibility are exact matches. Callers may provide
 * a complete or partial configuration override for a deployment's contract.
 */
const DEFAULT_ALIGNMENT_CONFIG = Object.freeze({
  temporal_tolerance_ms: 15 * 60 * 1000,
  spatial_tolerance_degrees: 0.1
});

const DATA_TYPES = new Set([
  "observation",
  "reanalysis",
  "forecast",
  "satellite",
  "derived",
  "climate"
]);

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function mergeConfig(overrides = {}) {
  const config = {
    ...DEFAULT_ALIGNMENT_CONFIG,
    ...overrides
  };

  if (
    !isFiniteNumber(config.temporal_tolerance_ms) ||
    config.temporal_tolerance_ms < 0 ||
    !isFiniteNumber(config.spatial_tolerance_degrees) ||
    config.spatial_tolerance_degrees < 0
  ) {
    throw new TypeError(
      "Alignment tolerances must be finite, non-negative numbers"
    );
  }

  return config;
}

function getVariableEntry(record) {
  const entries = record?.provenance?.variables;
  if (Array.isArray(entries) && entries.length === 1) {
    return entries[0];
  }

  const variable = record?.provenance?.variable;
  if (typeof variable === "string" && variable.trim() !== "") {
    return {
      canonical_variable: variable.trim(),
      normalized_unit: record.provenance.units ?? null
    };
  }

  return null;
}

function getCanonicalVariable(record) {
  return getVariableEntry(record)?.canonical_variable ?? null;
}

function getUnit(record) {
  const entry = getVariableEntry(record);
  return entry?.normalized_unit ?? record?.provenance?.units ?? null;
}

function getValue(record, variableEntry) {
  if (Object.prototype.hasOwnProperty.call(record || {}, "value")) {
    return record.value;
  }

  const variable = variableEntry?.canonical_variable;
  return variable ? record?.environment?.[variable] : undefined;
}

function statusForValue(record, variableEntry) {
  const value = getValue(record, variableEntry);
  const qualityFlag = record?.quality?.quality_flag;
  const variableStatus = variableEntry?.status;

  if (
    value === null ||
    value === undefined ||
    qualityFlag === "missing" ||
    variableStatus === "missing"
  ) {
    return "missing_value";
  }

  if (qualityFlag === "poor") {
    return "poor_quality";
  }

  return "ok";
}

function compareTemporal(recordA, recordB, config) {
  const timestampA = recordA?.time?.timestamp ?? recordA?.timestamp;
  const timestampB = recordB?.time?.timestamp ?? recordB?.timestamp;
  const parsedA = Date.parse(timestampA);
  const parsedB = Date.parse(timestampB);

  if (!Number.isFinite(parsedA) || !Number.isFinite(parsedB)) {
    return {
      status: "temporally_misaligned",
      timestamp_a: timestampA ?? null,
      timestamp_b: timestampB ?? null,
      difference_ms: null,
      tolerance_ms: config.temporal_tolerance_ms
    };
  }

  const difference = Math.abs(parsedA - parsedB);
  return {
    status:
      difference <= config.temporal_tolerance_ms
        ? "aligned"
        : "temporally_misaligned",
    timestamp_a: new Date(parsedA).toISOString(),
    timestamp_b: new Date(parsedB).toISOString(),
    difference_ms: difference,
    tolerance_ms: config.temporal_tolerance_ms
  };
}

function getCoordinates(record) {
  const location = record?.location;
  const grid = location?.source_grid ?? record?.source_grid;
  if (grid) {
    return {
      latitude: grid.latitude,
      longitude: grid.longitude
    };
  }

  return {
    latitude: location?.latitude,
    longitude: location?.longitude
  };
}

function longitudeDifference(first, second) {
  return Math.abs(
    (first - second + 540) % 360 - 180
  );
}

function compareSpatial(recordA, recordB, config) {
  const coordinatesA = getCoordinates(recordA);
  const coordinatesB = getCoordinates(recordB);
  const valid =
    isFiniteNumber(coordinatesA.latitude) &&
    isFiniteNumber(coordinatesA.longitude) &&
    isFiniteNumber(coordinatesB.latitude) &&
    isFiniteNumber(coordinatesB.longitude);

  if (!valid) {
    return {
      status: "spatially_misaligned",
      coordinates_a: coordinatesA,
      coordinates_b: coordinatesB,
      difference_degrees: null,
      tolerance_degrees: config.spatial_tolerance_degrees
    };
  }

  const difference = {
    latitude: Math.abs(coordinatesA.latitude - coordinatesB.latitude),
    longitude: longitudeDifference(
      coordinatesA.longitude,
      coordinatesB.longitude
    )
  };

  return {
    status:
      difference.latitude <= config.spatial_tolerance_degrees &&
      difference.longitude <= config.spatial_tolerance_degrees
        ? "aligned"
        : "spatially_misaligned",
    coordinates_a: coordinatesA,
    coordinates_b: coordinatesB,
    difference_degrees: difference,
    tolerance_degrees: config.spatial_tolerance_degrees
  };
}

function alignRecords(recordA, recordB, options = {}) {
  if (!recordA || typeof recordA !== "object" || !recordB || typeof recordB !== "object") {
    throw new TypeError("Both source records must be objects");
  }

  const config = mergeConfig(options);
  const variableA = getVariableEntry(recordA);
  const variableB = getVariableEntry(recordB);
  const canonicalVariableA = getCanonicalVariable(recordA);
  const canonicalVariableB = getCanonicalVariable(recordB);
  const valueStatusA = statusForValue(recordA, variableA);
  const valueStatusB = statusForValue(recordB, variableB);
  const temporal = compareTemporal(recordA, recordB, config);
  const spatial = compareSpatial(recordA, recordB, config);
  const dataTypeA = recordA.provenance?.data_type ?? recordA.data_type ?? null;
  const dataTypeB = recordB.provenance?.data_type ?? recordB.data_type ?? null;
  const unitA = getUnit(recordA);
  const unitB = getUnit(recordB);
  const sameDataType =
    DATA_TYPES.has(dataTypeA) && dataTypeA === dataTypeB;
  const sameUnit = typeof unitA === "string" && unitA === unitB;
  const sameVariable =
    canonicalVariableA !== null && canonicalVariableA === canonicalVariableB;

  let status = "aligned";
  if (valueStatusA !== "ok" || valueStatusB !== "ok") {
    status = valueStatusA === "poor_quality" || valueStatusB === "poor_quality"
      ? "poor_quality"
      : "missing_value";
  } else if (!sameVariable) {
    status = "incompatible_data_type";
  } else if (!sameDataType) {
    status = "incompatible_data_type";
  } else if (!sameUnit) {
    status = "incompatible_units";
  } else if (temporal.status !== "aligned") {
    status = temporal.status;
  } else if (spatial.status !== "aligned") {
    status = spatial.status;
  }

  return {
    status,
    canonical_variable: sameVariable ? canonicalVariableA : null,
    source_records: [recordA, recordB],
    records: {
      source_a: recordA,
      source_b: recordB
    },
    metadata: {
      configuration: config,
      temporal,
      spatial,
      data_type: {
        status: sameDataType ? "aligned" : "incompatible_data_type",
        source_a: dataTypeA,
        source_b: dataTypeB
      },
      units: {
        status: sameUnit ? "aligned" : "incompatible_units",
        source_a: unitA,
        source_b: unitB
      },
      variable: {
        status: sameVariable ? "aligned" : "incompatible_data_type",
        source_a: canonicalVariableA,
        source_b: canonicalVariableB
      },
      value: {
        source_a: valueStatusA,
        source_b: valueStatusB
      }
    }
  };
}

if (typeof window !== "undefined") {
  window.ThermalShieldAlignment = { alignRecords, DEFAULT_ALIGNMENT_CONFIG };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { alignRecords, DEFAULT_ALIGNMENT_CONFIG };
}
