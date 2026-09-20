"use strict";

const assert = require("node:assert/strict");
const { alignRecords } = require("./alignment");
const { evaluateRecords } = require("./quality-gate");
const { fuseRecords } = require("./fusion");

function record(sourceId, overrides = {}) {
  return {
    source_id: sourceId,
    source_name: `Synthetic ${sourceId}`,
    variable: "air_temperature_c",
    value: 25,
    unit: "degC",
    timestamp: "2026-09-20T08:00:00Z",
    retrieved_at: "2026-09-20T08:01:00Z",
    location: { latitude: 35, longitude: -120 },
    data_type: "observation",
    quality_flag: "good",
    provenance: {
      source_id: sourceId,
      source_name: `Synthetic ${sourceId}`,
      data_type: "observation",
      retrieved_at: "2026-09-20T08:01:00Z",
      variables: [{
        canonical_variable: "air_temperature_c",
        normalized_unit: "degC"
      }]
    },
    ...overrides
  };
}

function layers(records) {
  const quality = evaluateRecords(records);
  const alignments = [];
  for (let i = 0; i < records.length; i += 1) {
    for (let j = i + 1; j < records.length; j += 1) {
      alignments.push(alignRecords(records[i], records[j]));
    }
  }
  return { quality, alignments };
}

function testSingleSource() {
  const records = [record("a")];
  const result = fuseRecords(records, [], evaluateRecords(records)).results[0];
  assert.equal(result.status, "single_source");
  assert.equal(result.unified_value, 25);
  assert.deepEqual(result.contributing_sources, ["a"]);
  assert.equal(result.confidence.status, "not_calculated");
}

function testCompatibleTwoSourceConsensus() {
  const records = [record("a"), record("b", { value: 27 })];
  const { quality, alignments } = layers(records);
  const result = fuseRecords(records, alignments, quality).results[0];
  assert.equal(result.status, "provisional_consensus");
  assert.equal(result.unified_value, 26);
  assert.equal(result.source_values.length, 2);
  assert.equal(result.weighting.variable, "air_temperature_c");
  assert.deepEqual(result.weighting.eligible_source_ids, ["a", "b"]);
  assert.equal(result.disagreement.status, "disagreement");
  assert.equal(result.confidence.status, "assessed");
  assert.ok(result.confidence.reasons.length === 0);
}

function testIncompatibleTime() {
  const records = [record("a"), record("b", { timestamp: "2026-09-20T08:16:00Z" })];
  const { quality, alignments } = layers(records);
  const result = fuseRecords(records, alignments, quality).results[0];
  assert.equal(result.status, "unavailable");
  assert.equal(result.unified_value, null);
}

function testMissingValue() {
  const records = [record("a", { value: null, quality_flag: "missing" })];
  const result = fuseRecords(records, [], evaluateRecords(records)).results[0];
  assert.equal(result.status, "unavailable");
  assert.equal(result.source_values[0].value, null);
  assert.match(result.missing_fields[0], /eligible/);
}

function testIncompatibleVariable() {
  const records = [
    record("a"),
    record("b", { variable: "relative_humidity_pct", value: 50, unit: "percent" })
  ];
  const { quality, alignments } = layers(records);
  const result = fuseRecords(records, alignments, quality);
  assert.equal(result.results.length, 2);
  assert.deepEqual(result.results.map((item) => item.status), ["single_source", "single_source"]);
}

testSingleSource();
testCompatibleTwoSourceConsensus();
testIncompatibleTime();
testMissingValue();
testIncompatibleVariable();
console.log("Fusion tests passed.");
