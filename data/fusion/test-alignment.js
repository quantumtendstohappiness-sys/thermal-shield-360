"use strict";

const assert = require("node:assert/strict");
const {
  alignRecords,
  DEFAULT_ALIGNMENT_CONFIG
} = require("./alignment");

function makeRecord(overrides = {}) {
  const base = {
    location: { name: "Synthetic point", latitude: 35, longitude: -120 },
    time: { timestamp: "2026-09-20T08:00:00Z", timezone: "UTC" },
    environment: { air_temperature_c: 25 },
    provenance: {
      source_id: "synthetic-a",
      source_name: "Synthetic source",
      data_type: "observation",
      retrieved_at: "2026-09-20T08:01:00Z",
      variables: [{
        canonical_variable: "air_temperature_c",
        source_variable: "temperature",
        normalized_unit: "degC",
        status: "normalized"
      }]
    },
    quality: { quality_flag: "good", missing_fields: [] }
  };

  return {
    ...base,
    ...overrides,
    location: { ...base.location, ...(overrides.location || {}) },
    time: { ...base.time, ...(overrides.time || {}) },
    environment: { ...base.environment, ...(overrides.environment || {}) },
    provenance: { ...base.provenance, ...(overrides.provenance || {}) },
    quality: { ...base.quality, ...(overrides.quality || {}) }
  };
}

const recordB = (overrides = {}) => makeRecord({
  ...overrides,
  provenance: {
    source_id: "synthetic-b",
    source_name: "Synthetic second source",
    ...(overrides.provenance || {})
  }
});

function testAlignedRecords() {
  const result = alignRecords(makeRecord(), recordB());
  assert.equal(result.status, "aligned");
  assert.equal(result.canonical_variable, "air_temperature_c");
  assert.equal(result.metadata.temporal.status, "aligned");
  assert.equal(result.metadata.spatial.status, "aligned");
  assert.strictEqual(result.records.source_a, result.source_records[0]);
  assert.strictEqual(result.records.source_b, result.source_records[1]);
}

function testTemporalMismatch() {
  const result = alignRecords(
    makeRecord(),
    recordB({ time: { timestamp: "2026-09-20T08:16:00Z" } })
  );
  assert.equal(result.status, "temporally_misaligned");
  assert.equal(
    result.metadata.temporal.tolerance_ms,
    DEFAULT_ALIGNMENT_CONFIG.temporal_tolerance_ms
  );
}

function testSpatialMismatch() {
  const result = alignRecords(
    makeRecord(),
    recordB({ location: { latitude: 35.2, longitude: -120 } })
  );
  assert.equal(result.status, "spatially_misaligned");
  assert.equal(result.metadata.spatial.status, "spatially_misaligned");
}

function testMissingValue() {
  const result = alignRecords(
    makeRecord({
      environment: { air_temperature_c: null },
      quality: { quality_flag: "missing", missing_fields: ["air_temperature_c"] }
    }),
    recordB()
  );
  assert.equal(result.status, "missing_value");
  assert.equal(result.metadata.value.source_a, "missing_value");
}

function testIncompatibleDataType() {
  const result = alignRecords(
    makeRecord(),
    recordB({ provenance: { data_type: "forecast" } })
  );
  assert.equal(result.status, "incompatible_data_type");
  assert.equal(result.metadata.data_type.source_a, "observation");
  assert.equal(result.metadata.data_type.source_b, "forecast");
}

testAlignedRecords();
testTemporalMismatch();
testSpatialMismatch();
testMissingValue();
testIncompatibleDataType();

console.log("Alignment tests passed.");
