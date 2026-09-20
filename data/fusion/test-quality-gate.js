"use strict";

const assert = require("node:assert/strict");
const { evaluateRecord } = require("./quality-gate");

function makeRecord(overrides = {}) {
  const record = {
    variable: "air_temperature_c",
    value: 25,
    unit: "degC",
    timestamp: "2026-09-20T08:00:00Z",
    retrieved_at: "2026-09-20T08:01:00Z",
    location: { latitude: 35, longitude: -120 },
    source_id: "synthetic-source",
    source_name: "Synthetic source",
    data_type: "observation",
    quality_flag: "good"
  };

  return { ...record, ...overrides };
}

function testEligibleData() {
  const record = makeRecord();
  const result = evaluateRecord(record);

  assert.equal(result.status, "eligible");
  assert.equal(result.results[0].status, "eligible");
  assert.strictEqual(result.original_record, record);
  assert.strictEqual(result.results[0].original_record, record);
}

function testMissingValue() {
  const result = evaluateRecord(makeRecord({ value: null }));

  assert.equal(result.status, "missing_value");
  assert.equal(result.results[0].status, "missing_value");
  assert.match(result.results[0].reasons[0], /null or missing/);
}

function testInvalidNumericValue() {
  const result = evaluateRecord(makeRecord({ value: Number.NaN }));

  assert.equal(result.status, "invalid_value");
  assert.equal(result.results[0].status, "invalid_value");
  assert.match(result.results[0].reasons[0], /finite number/);
}

function testIncompleteProvenance() {
  const result = evaluateRecord(makeRecord({ source_id: null }));

  assert.equal(result.status, "incomplete_provenance");
  assert.equal(result.results[0].status, "incomplete_provenance");
  assert.match(result.results[0].reasons[0], /source_id/);
}

function testPoorQualityInput() {
  const result = evaluateRecord(makeRecord({ quality_flag: "poor" }));

  assert.equal(result.status, "poor_quality");
  assert.equal(result.results[0].status, "poor_quality");
  assert.match(result.results[0].reasons[0], /quality flag is poor/);
}

testEligibleData();
testMissingValue();
testInvalidNumericValue();
testIncompleteProvenance();
testPoorQualityInput();

console.log("Quality gate tests passed.");
