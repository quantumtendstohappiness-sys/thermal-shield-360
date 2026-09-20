(function () {
"use strict";

/**
 * Variable-specific, auditable weighting for normalized source records.
 *
 * This module ranks eligible values; it deliberately does not fuse values.
 * Defaults are neutral across source identities and data providers. A caller
 * may supply variable-specific component functions or scores when a deployment
 * has an explicit, documented policy.
 */

const DEFAULT_OPTIONS = Object.freeze({
  qualityScores: Object.freeze({ good: 1, acceptable: 0.75 }),
  dataTypeScores: Object.freeze({
    observation: 1,
    forecast: 1,
    reanalysis: 1,
    satellite: 1,
    derived: 1
  }),
  forecastLeadTime: Object.freeze({
    preferred_hours: 6,
    maximum_hours: 72
  })
});

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function sourceId(record) {
  return record?.source_id ?? record?.provenance?.source_id ?? null;
}

function variableName(record) {
  if (typeof record?.variable === "string" && record.variable.trim()) {
    return record.variable.trim();
  }
  const variables = record?.provenance?.variables;
  if (Array.isArray(variables) && variables.length === 1) {
    return variables[0]?.canonical_variable ?? null;
  }
  return record?.provenance?.variable ?? null;
}

function valueOf(record, variable) {
  if (Object.prototype.hasOwnProperty.call(record || {}, "value")) {
    return record.value;
  }
  return record?.environment?.[variable];
}

function qualityFlag(record) {
  return record?.quality?.quality_flag ??
    record?.quality?.status ??
    record?.quality_flag ??
    null;
}

function dataType(record) {
  return record?.data_type ?? record?.provenance?.data_type ?? null;
}

function timestamp(record) {
  return record?.timestamp ?? record?.time?.timestamp ?? null;
}

function coordinates(record) {
  const location = record?.location ?? {};
  const grid = record?.source_grid ?? location.source_grid ?? {};
  return {
    latitude: grid.latitude ?? location.latitude,
    longitude: grid.longitude ?? location.longitude
  };
}

function mergeOptions(options) {
  const merged = {
    ...DEFAULT_OPTIONS,
    ...options,
    qualityScores: { ...DEFAULT_OPTIONS.qualityScores, ...(options.qualityScores || {}) },
    dataTypeScores: { ...DEFAULT_OPTIONS.dataTypeScores, ...(options.dataTypeScores || {}) },
    forecastLeadTime: { ...DEFAULT_OPTIONS.forecastLeadTime, ...(options.forecastLeadTime || {}) }
  };
  return merged;
}

function component(name, score, input, reason) {
  return {
    name,
    score: Math.max(0, Math.min(1, score)),
    input,
    reason
  };
}

function pairFor(alignments, a, b, indexA, indexB) {
  if (Array.isArray(alignments)) {
    return alignments.find((item) => {
      const records = item?.source_records ?? [];
      return (records[0] === a && records[1] === b) ||
        (records[0] === b && records[1] === a) ||
        (item?.source_a_index === indexA && item?.source_b_index === indexB) ||
        (item?.source_a_index === indexB && item?.source_b_index === indexA);
    }) ?? null;
  }
  return alignments?.[`${indexA}:${indexB}`] ??
    alignments?.[`${indexB}:${indexA}`] ?? null;
}

function alignmentFor(record, entry, entries, options) {
  const temporal = [];
  const spatial = [];
  entries.forEach((other) => {
    if (other.record === record) return;
    const alignment = pairFor(
      options.alignments ?? options.alignmentResults,
      record,
      other.record,
      entry.index,
      other.index
    );
    if (alignment?.metadata?.temporal) temporal.push(alignment.metadata.temporal);
    if (alignment?.metadata?.spatial) spatial.push(alignment.metadata.spatial);
  });
  return { temporal, spatial };
}

function scoreAlignment(items, kind, target, record) {
  if (target) {
    if (kind === "temporal") {
      const actual = Date.parse(timestamp(record));
      const wanted = Date.parse(target.timestamp);
      if (Number.isFinite(actual) && Number.isFinite(wanted) && finite(target.tolerance_ms)) {
        const difference = Math.abs(actual - wanted);
        return component("temporal_alignment", Math.max(0, 1 - difference / target.tolerance_ms),
          { status: difference <= target.tolerance_ms ? "aligned" : "misaligned", difference_ms: difference },
          "Score is based on distance from the requested timestamp.");
      }
    } else {
      const actual = coordinates(record);
      if (finite(actual.latitude) && finite(actual.longitude) &&
          finite(target.latitude) && finite(target.longitude) && finite(target.tolerance_degrees)) {
        const difference = Math.max(
          Math.abs(actual.latitude - target.latitude),
          Math.abs(actual.longitude - target.longitude)
        );
        return component("spatial_alignment", Math.max(0, 1 - difference / target.tolerance_degrees),
          { status: difference <= target.tolerance_degrees ? "aligned" : "misaligned", difference_degrees: difference },
          "Score is based on distance from the requested location.");
      }
    }
  }

  if (items.length === 0) {
    return component(`${kind}_alignment`, 1, { status: "not_provided" },
      "No alignment result was supplied; no alignment penalty was asserted.");
  }
  const statuses = items.map((item) => item.status);
  const aligned = statuses.filter((status) => status === "aligned").length;
  return component(`${kind}_alignment`, aligned / items.length,
    { statuses }, aligned === items.length
      ? "All supplied pairwise alignment results are aligned."
      : "At least one supplied pairwise alignment result is not aligned.");
}

function forecastComponent(record, options) {
  const type = dataType(record);
  const forecast = record?.forecast;
  if (type !== "forecast") {
    return component("observation_forecast_status", options.dataTypeScores[type] ?? 1,
      { data_type: type, status: "observation_or_non_forecast" },
      "No source identity preference is applied; the configured data-type score is used.");
  }
  const valid = Date.parse(forecast?.valid_time ?? timestamp(record));
  const initialized = Date.parse(forecast?.initialization_time ?? timestamp(record));
  const leadHours = Number.isFinite(valid) && Number.isFinite(initialized)
    ? Math.max(0, (valid - initialized) / 3600000)
    : null;
  const maximum = options.forecastLeadTime.maximum_hours;
  const preferred = options.forecastLeadTime.preferred_hours;
  const relevance = leadHours === null ? 1 :
    leadHours <= preferred ? 1 : Math.max(0, 1 - (leadHours - preferred) / Math.max(1, maximum - preferred));
  return component("observation_forecast_status",
    relevance * (options.dataTypeScores.forecast ?? 1),
    { data_type: type, status: "forecast", lead_hours: leadHours },
    "Forecast relevance is based on explicit lead-time policy, not source identity.");
}

function weightRecord(record, entry, entries, options) {
  const reasons = [];
  const variable = variableName(record);
  const value = valueOf(record, variable);
  const quality = qualityFlag(record);
  const alignments = alignmentFor(record, entry, entries, options);
  const qualityScore = options.qualityScores[quality];
  const components = [];

  if (!isObject(record)) reasons.push("Record is not an object.");
  if (!variable) reasons.push("Canonical variable is missing.");
  if (!finite(value)) reasons.push("Variable value is missing or not finite.");
  if (quality === "poor" || quality === "missing") reasons.push(`Quality status is ${quality}.`);
  if (qualityScore === undefined) reasons.push("Quality status is not eligible for weighting.");

  components.push(component("source_quality", qualityScore ?? 0, { quality_status: quality },
    "Score comes from the record quality status and configured quality scores."));
  components.push(scoreAlignment(alignments.temporal, "temporal", options.targetTemporal, record));
  components.push(scoreAlignment(alignments.spatial, "spatial", options.targetSpatial, record));
  components.push(component("data_availability", finite(value) ? 1 : 0,
    { value_present: finite(value) }, finite(value) ? "Finite value is available." : "Missing values receive no weight."));
  components.push(forecastComponent(record, options));

  for (const item of components) {
    if (item.score === 0 && !reasons.includes(`${item.name} is not aligned.`)) {
      if (item.name.endsWith("alignment")) reasons.push(`${item.name} is not aligned.`);
    }
  }
  const eligible = reasons.length === 0 && components.every((item) => item.score > 0);
  if (!eligible && reasons.length === 0) reasons.push("One or more weighting components is zero.");
  const rawWeight = eligible ? components.reduce((product, item) => product * item.score, 1) : 0;
  return {
    source_id: sourceId(record),
    source_name: record?.source_name ?? record?.provenance?.source_name ?? null,
    variable,
    provenance: record?.provenance ?? null,
    eligible,
    reasons,
    components,
    raw_weight: rawWeight,
    normalized_weight: null
  };
}

function calculateWeights(records, options = {}) {
  if (!Array.isArray(records)) throw new TypeError("Normalized source records must be an array.");
  const config = mergeOptions(options);
  const entries = records.map((record, index) => ({ record, index }));
  const groups = new Map();
  entries.forEach((entry) => {
    const variable = variableName(entry.record);
    if (!groups.has(variable)) groups.set(variable, []);
    groups.get(variable).push(entry);
  });

  const variables = [...groups.entries()].map(([variable, group]) => {
    const sources = group.map((entry) => weightRecord(entry.record, entry, group, config));
    const eligible = sources.filter((source) => source.eligible);
    const total = eligible.reduce((sum, source) => sum + source.raw_weight, 0);
    eligible.forEach((source) => {
      source.normalized_weight = total > 0 ? source.raw_weight / total : 1 / eligible.length;
    });
    return {
      variable,
      sources,
      eligible_source_ids: eligible.map((source) => source.source_id),
      status: eligible.length === 0 ? "unavailable" : "weighted"
    };
  });

  return { variables };
}

const weightSources = calculateWeights;
const calculateSourceWeights = calculateWeights;
const weightRecords = calculateWeights;

if (typeof window !== "undefined") {
  window.ThermalShieldFusionWeighting = {
    calculateWeights,
    calculateSourceWeights,
    weightSources,
    weightRecords
  };
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { calculateWeights, calculateSourceWeights, weightSources, weightRecords };
}
})();
