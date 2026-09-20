"use strict";

const assert = require("node:assert/strict");
const nasaPayload = require("../live/nasa-power-current.json");
const ecmwfPayload = require("../live/ecmwf-current.json");
const { normalizeNASARecord } = require("../normalization/nasa");
const { normalizeECMWFPayload } = require("../normalization/ecmwf");
const { alignRecords } = require("./alignment");
const { evaluateRecords } = require("./quality-gate");
const { fuseRecords } = require("./fusion");

function nasaTimestamp(value) {
  assert.match(value, /^\d{10}$/, "NASA observation timestamp must be YYYYMMDDHH.");
  const match = value.match(/^(\d{4})(\d{2})(\d{2})(\d{2})$/);
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:00:00Z`;
}

function normalizeLiveNASA() {
  assert.equal(nasaPayload.type, "Feature");
  const properties = nasaPayload.properties;
  const coordinates = nasaPayload.geometry?.coordinates;

  assert.ok(properties && coordinates, "NASA live feature must contain properties and geometry.");
  return normalizeNASARecord({
    location: {
      name: "NASA POWER live point",
      latitude: coordinates[1],
      longitude: coordinates[0]
    },
    time: {
      timestamp: nasaTimestamp(properties.observation_timestamp_utc),
      timezone: properties.provenance?.time_standard || "UTC"
    },
    environment: properties.environment,
    provenance: {
      source_id: properties.source_id,
      source_name: properties.source,
      data_type: properties.data_type,
      variables: properties.provenance?.variables,
      retrieved_at: properties.retrieved_at
    },
    quality: properties.quality
  });
}

function variableNames(normalized) {
  return normalized.provenance.variables.map(
    (entry) => entry.canonical_variable
  );
}

function variableRecord(normalized, variable) {
  const lineage = normalized.provenance.variables.find(
    (entry) => entry.canonical_variable === variable
  );
  assert.ok(lineage, `Missing normalized lineage for ${variable}.`);

  return {
    source_id: normalized.provenance.source_id,
    source_name: normalized.provenance.source_name,
    variable,
    value: normalized.environment[variable],
    unit: lineage.normalized_unit,
    timestamp: normalized.time.timestamp,
    retrieved_at: normalized.provenance.retrieved_at,
    location: normalized.location,
    data_type: normalized.provenance.data_type,
    quality_flag: normalized.quality.quality_flag,
    provenance: {
      source_id: normalized.provenance.source_id,
      source_name: normalized.provenance.source_name,
      data_type: normalized.provenance.data_type,
      retrieved_at: normalized.provenance.retrieved_at,
      variables: [lineage]
    },
    quality: normalized.quality
  };
}

function hasVariable(normalized, variable) {
  return normalized.provenance.variables.some(
    (entry) => entry.canonical_variable === variable
  );
}

function sourceSummary(normalized) {
  const names = variableNames(normalized);
  return {
    source_id: normalized.provenance.source_id,
    source_name: normalized.provenance.source_name,
    data_type: normalized.provenance.data_type,
    retrieved_at: normalized.provenance.retrieved_at,
    timestamp: normalized.time.timestamp,
    location: normalized.location,
    available_variables: names.filter(
      (name) => Number.isFinite(normalized.environment[name])
    ),
    missing_variables: names.filter(
      (name) => normalized.environment[name] === null ||
        normalized.environment[name] === undefined
    )
  };
}

const nasa = normalizeLiveNASA();
const ecmwf = normalizeECMWFPayload(ecmwfPayload);
assert.equal(nasa.provenance.source_id, "nasa_power");
assert.equal(ecmwf.provenance.source_id, "ecmwf_opendata");

const names = [...new Set([...variableNames(nasa), ...variableNames(ecmwf)])];
const records = names.flatMap((variable) => {
  const sourceRecords = [];
  if (hasVariable(nasa, variable)) {
    sourceRecords.push(variableRecord(nasa, variable));
  }
  if (hasVariable(ecmwf, variable)) {
    sourceRecords.push(variableRecord(ecmwf, variable));
  }
  return sourceRecords;
});
const quality = evaluateRecords(records);
const alignments = [];
const alignmentByVariable = {};

for (const variable of names) {
  if (!hasVariable(nasa, variable) || !hasVariable(ecmwf, variable)) {
    continue;
  }
  const nasaRecord = variableRecord(nasa, variable);
  const ecmwfRecord = variableRecord(ecmwf, variable);
  const alignment = alignRecords(nasaRecord, ecmwfRecord);
  alignments.push(alignment);
  alignmentByVariable[variable] = {
    status: alignment.status,
    temporal: alignment.metadata.temporal,
    spatial: alignment.metadata.spatial,
    data_type: alignment.metadata.data_type,
    units: alignment.metadata.units
  };
}

const fusion = fuseRecords(records, alignments, quality);
const fusionByVariable = Object.fromEntries(
  fusion.results.map((result) => [
    result.canonical_variable,
    {
      status: result.status,
      unified_value: result.unified_value,
      unit: result.unit,
      contributing_sources: result.contributing_sources,
      missing_fields: result.missing_fields
    }
  ])
);

for (const variable of names) {
  assert.ok(fusionByVariable[variable], `Fusion result missing for ${variable}.`);
}

const report = {
  status: "completed",
  deterministic: true,
  external_api_calls: 0,
  sources: [sourceSummary(nasa), sourceSummary(ecmwf)],
  variables: {
    union: names,
    shared: names.filter(
      (name) => hasVariable(nasa, name) && hasVariable(ecmwf, name)
    )
  },
  alignment: alignmentByVariable,
  fusion: fusionByVariable
};

console.log(JSON.stringify(report, null, 2));
