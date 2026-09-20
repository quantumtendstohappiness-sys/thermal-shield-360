"use strict";

const assert = require("assert");
const { calculateWeights } = require("./weighting");

const base = (overrides = {}) => ({
  source_id: "source",
  source_name: "Test source",
  variable: "air_temperature_c",
  value: 30,
  unit: "Cel",
  timestamp: "2026-01-01T00:00:00Z",
  location: { latitude: 20, longitude: 77 },
  data_type: "observation",
  quality: { status: "good" },
  retrieved_at: "2026-01-01T00:05:00Z",
  provenance: { source_id: "source", source_name: "Test source", provider: "test" },
  ...overrides
});

function sources(result) {
  return result.variables[0].sources;
}

function pairAlignment(a, b, temporal = "aligned", spatial = "aligned") {
  return {
    source_records: [a, b],
    metadata: { temporal: { status: temporal }, spatial: { status: spatial } }
  };
}

{
  const a = base({ source_id: "a" });
  const b = base({ source_id: "b", value: 31 });
  const result = calculateWeights([a, b], { alignments: [pairAlignment(a, b)] });
  assert.deepStrictEqual(result.variables[0].eligible_source_ids, ["a", "b"]);
  assert.strictEqual(sources(result).reduce((sum, item) => sum + item.normalized_weight, 0), 1);
  assert.ok(sources(result).every((item) => item.components.length === 5));
}

{
  const result = calculateWeights([base({ variable: undefined, value: 30 })]);
  assert.strictEqual(sources(result)[0].eligible, false);
  assert.strictEqual(sources(result)[0].normalized_weight, null);
  assert.match(sources(result)[0].reasons.join(" "), /canonical variable/i);
}

{
  const result = calculateWeights([base({ quality: { status: "poor" } })]);
  assert.strictEqual(sources(result)[0].eligible, false);
  assert.strictEqual(sources(result)[0].raw_weight, 0);
}

{
  const observation = base({ source_id: "observation" });
  const forecast = base({
    source_id: "forecast",
    data_type: "forecast",
    forecast: {
      initialization_time: "2025-12-31T00:00:00Z",
      valid_time: "2026-01-01T00:00:00Z"
    }
  });
  const result = calculateWeights([observation, forecast], {
    alignments: [pairAlignment(observation, forecast)]
  });
  const forecastSource = sources(result).find((item) => item.source_id === "forecast");
  assert.strictEqual(forecastSource.components.find((item) => item.name === "observation_forecast_status").input.status, "forecast");
}

{
  const a = base({ source_id: "a" });
  const b = base({ source_id: "b" });
  const result = calculateWeights([a, b], { alignments: [pairAlignment(a, b, "aligned", "spatially_misaligned")] });
  assert.strictEqual(result.variables[0].status, "unavailable");
  assert.ok(sources(result).every((item) => item.normalized_weight === null));
}

{
  const a = base({ source_id: "a" });
  const b = base({ source_id: "b" });
  const result = calculateWeights([a, b], { alignments: [pairAlignment(a, b, "temporally_misaligned", "aligned")] });
  assert.ok(sources(result).every((item) => item.eligible === false));
}

{
  const result = calculateWeights([base({ source_id: "only" })]);
  assert.strictEqual(sources(result)[0].normalized_weight, 1);
  assert.deepStrictEqual(result.variables[0].eligible_source_ids, ["only"]);
}

console.log("weighting tests passed");
