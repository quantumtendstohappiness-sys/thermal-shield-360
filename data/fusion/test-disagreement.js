"use strict";

const assert = require("node:assert/strict");
const { analyzeDisagreement } = require("./disagreement");

function record(overrides = {}) {
  const sourceId = overrides.source_id ?? "source-a";
  return {
    source_id: sourceId,
    source_name: overrides.source_name ?? sourceId.toUpperCase(),
    variable: "air_temperature_c",
    value: 20,
    unit: "C",
    timestamp: "2026-01-01T00:00:00Z",
    location: { latitude: 10, longitude: 20 },
    data_type: "observation",
    quality: { status: "good" },
    retrieved_at: "2026-01-01T00:01:00Z",
    provenance: {
      source_id: sourceId,
      source_name: overrides.source_name ?? sourceId.toUpperCase(),
      provider_record: `${sourceId}-raw`
    },
    ...overrides
  };
}

{
  const result = analyzeDisagreement([
    record({ source_id: "a", value: 20 }),
    record({ source_id: "b", value: 20 })
  ]);
  const variable = result.variables[0];
  assert.equal(variable.status, "agreement");
  assert.deepEqual(variable.statistics, {
    min: 20, max: 20, range: 0, relative_disagreement: 0, reference_scale: 20
  });
  assert.equal(variable.pairwise[0].status, "agreement");
}

{
  const result = analyzeDisagreement([
    record({ source_id: "a", value: 20 }),
    record({ source_id: "b", value: 25 })
  ]);
  const variable = result.variables[0];
  assert.equal(variable.status, "disagreement");
  assert.equal(variable.statistics.range, 5);
  assert.equal(variable.statistics.relative_disagreement, 0.2);
  assert.equal(variable.pairwise[0].difference, 5);
}

{
  const result = analyzeDisagreement([record({ source_id: "only", value: 20 })]);
  assert.equal(result.variables[0].status, "single_source");
  assert.equal(result.variables[0].source_count, 1);
  assert.equal(result.variables[0].statistics.range, null);
  assert.match(result.variables[0].reasons[0], /one eligible source/i);
}

{
  const result = analyzeDisagreement([
    record({ source_id: "good", value: 20 }),
    record({ source_id: "missing", value: null, quality: { status: "missing" } }),
    record({ source_id: "poor", value: 21, quality: { status: "poor" } })
  ]);
  const variable = result.variables[0];
  assert.equal(variable.status, "single_source");
  assert.deepEqual(variable.eligible_source_ids, ["good"]);
  assert.equal(variable.excluded_sources.length, 2);
  assert.match(variable.excluded_sources[0].reason, /not a finite number/i);
}

{
  const result = analyzeDisagreement([
    record({ source_id: "a", value: -1e-12 }),
    record({ source_id: "b", value: 1e-12 })
  ]);
  const variable = result.variables[0];
  assert.equal(variable.status, "disagreement");
  assert.equal(variable.statistics.reference_scale, 1e-12);
  assert.equal(variable.statistics.relative_disagreement, null);
  assert.match(variable.reasons[0], /not meaningful/i);
}

{
  const original = record({
    source_id: "preserved",
    provenance: { source_id: "preserved", provider_record: "keep-me", nested: { revision: 7 } }
  });
  const result = analyzeDisagreement([original]);
  assert.deepEqual(result.variables[0].source_values[0].provenance, original.provenance);
  assert.equal(result.variables[0].source_values[0].source_id, "preserved");
  assert.equal(result.variables[0].source_values[0].value, original.value);
}

console.log("disagreement tests passed");
