"use strict";

const assert = require("node:assert/strict");
const { assessConfidence } = require("./confidence");

function base(overrides = {}) {
  return {
    source_id: "source-a",
    source_name: "Source A",
    variable: "air_temperature_c",
    value: 20,
    unit: "C",
    timestamp: "2026-01-01T00:00:00Z",
    location: { latitude: 10, longitude: 20 },
    data_type: "observation",
    quality: { status: "good" },
    retrieved_at: "2026-01-01T00:01:00Z",
    provenance: { source_id: "source-a", source_name: "Source A" },
    ...overrides,
    location: { latitude: 10, longitude: 20, ...(overrides.location || {}) },
    provenance: { source_id: overrides.source_id ?? "source-a", source_name: overrides.source_name ?? "Source A", ...(overrides.provenance || {}) }
  };
}

function pairAlignment(a, b, temporal = "aligned", spatial = "aligned") {
  return {
    source_records: [a, b],
    metadata: { temporal: { status: temporal }, spatial: { status: spatial } }
  };
}

{
  const a = base({ source_id: "a", source_name: "A" });
  const b = base({ source_id: "b", source_name: "B", value: 20 });
  const result = assessConfidence([a, b], {
    alignments: [pairAlignment(a, b)]
  });

  assert.equal(result.variables[0].status, "assessed");
  assert.ok(result.variables[0].confidence.score >= 0.9, "agreement should preserve high confidence");
  assert.equal(result.variables[0].agreement.status, "agreement");
}

{
  const a = base({ source_id: "a", source_name: "A", value: 20 });
  const b = base({ source_id: "b", source_name: "B", value: 20 });
  const agreement = assessConfidence([a, b], { alignments: [pairAlignment(a, b)] });

  const c = base({ source_id: "c", source_name: "C", value: 20 });
  const d = base({ source_id: "d", source_name: "D", value: 25 });
  const result = assessConfidence([c, d], { alignments: [pairAlignment(c, d)] });

  assert.ok(agreement.variables[0].confidence.score > result.variables[0].confidence.score,
    "agreement should score at least as well as disagreement");
  assert.equal(agreement.variables[0].agreement.status, "agreement");
  assert.equal(result.variables[0].agreement.status, "disagreement");
}

{
  const source = base({ source_id: "only", source_name: "Only" });
  const result = assessConfidence([source]);
  assert.equal(result.variables[0].status, "assessed");
  assert.equal(result.variables[0].source_count, 1);
  assert.ok(result.variables[0].confidence.score > 0.5);
  assert.equal(result.variables[0].sources[0].source_id, "only");
}

{
  const goodSource = base({ source_id: "good", source_name: "Good" });
  const missingSource = base({ source_id: "missing", source_name: "Missing", value: null, quality: { status: "missing" } });
  const poorSource = base({ source_id: "poor", source_name: "Poor", quality: { status: "poor" } });
  const result = assessConfidence([goodSource, missingSource, poorSource], {
    alignments: [pairAlignment(goodSource, missingSource), pairAlignment(goodSource, poorSource)]
  });

  assert.equal(result.variables[0].eligible_source_ids.includes("good"), true);
  assert.equal(result.variables[0].eligible_source_ids.includes("missing"), false);
  assert.equal(result.variables[0].eligible_source_ids.includes("poor"), false);
  assert.ok(result.variables[0].confidence.score > 0);
}

{
  const observation = base({ source_id: "obs", source_name: "Observation", value: 20 });
  const forecast = base({
    source_id: "fcst",
    source_name: "Forecast",
    value: 21,
    data_type: "forecast",
    forecast: {
      initialization_time: "2026-01-01T00:00:00Z",
      valid_time: "2026-01-01T12:00:00Z"
    }
  });
  const observationResult = assessConfidence([observation], { alignments: [] });
  const forecastResult = assessConfidence([forecast], { alignments: [] });

  assert.ok(observationResult.variables[0].confidence.score > forecastResult.variables[0].confidence.score,
    "observation confidence should be at least as strong as an equivalent forecast");
  const forecastSource = forecastResult.variables[0].sources[0];
  assert.ok(forecastSource.components.some((item) => item.name === "observation_forecast_status" && item.score < 1));
}

console.log("confidence tests passed");
