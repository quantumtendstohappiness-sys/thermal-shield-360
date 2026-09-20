(function () {
"use strict";

/**
 * Auditable disagreement analysis for records that have already been
 * normalized and aligned. This module describes observed differences only;
 * it does not decide whether a difference is scientifically acceptable.
 */

const DEFAULT_OPTIONS = Object.freeze({
  reference_epsilon: 1e-9
});

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function variableName(record) {
  if (typeof record?.variable === "string" && record.variable.trim() !== "") {
    return record.variable.trim();
  }
  const variables = record?.provenance?.variables;
  if (Array.isArray(variables) && variables.length === 1) {
    return variables[0]?.canonical_variable ?? null;
  }
  return typeof record?.provenance?.variable === "string"
    ? record.provenance.variable.trim()
    : null;
}

function valueOf(record, variable) {
  if (Object.prototype.hasOwnProperty.call(record || {}, "value")) {
    return record.value;
  }
  return record?.environment?.[variable];
}

function sourceId(record) {
  return record?.source_id ?? record?.provenance?.source_id ?? null;
}

function sourceName(record) {
  return record?.source_name ?? record?.provenance?.source_name ?? null;
}

function unitOf(record) {
  const variables = record?.provenance?.variables;
  const entry = Array.isArray(variables) && variables.length === 1 ? variables[0] : null;
  return record?.unit ?? entry?.normalized_unit ?? record?.provenance?.units ?? null;
}

function qualityStatus(record, qualityResult) {
  if (qualityResult?.status) return qualityResult.status;
  return record?.quality?.status ??
    record?.quality?.quality_flag ??
    record?.quality_flag ??
    null;
}

function qualityResultFor(qualityResults, index, record, variable) {
  const supplied = Array.isArray(qualityResults)
    ? qualityResults[index]
    : qualityResults?.[sourceId(record)] ?? qualityResults?.[index];
  if (Array.isArray(supplied?.results)) {
    return supplied.results.find((item) => item?.variable === variable) ??
      supplied.results[0] ??
      null;
  }
  return supplied ?? null;
}

function sourceDetails(record, variable, qualityResult, eligible, reason) {
  return {
    source_id: sourceId(record),
    source_name: sourceName(record),
    value: valueOf(record, variable),
    unit: unitOf(record),
    data_type: record?.data_type ?? record?.provenance?.data_type ?? null,
    timestamp: record?.timestamp ?? record?.time?.timestamp ?? null,
    quality: record?.quality ?? null,
    quality_status: qualityStatus(record, qualityResult),
    provenance: record?.provenance ?? null,
    eligible,
    reason: reason ?? null
  };
}

function eligibleReason(record, variable, qualityResult) {
  const value = valueOf(record, variable);
  const status = qualityStatus(record, qualityResult);
  if (!isFiniteNumber(value)) return "Value is missing or not a finite number.";
  if (status !== "eligible" && status !== "good" && status !== "acceptable") {
    return status
      ? `Quality status "${status}" is not eligible for disagreement analysis.`
      : "Quality status is missing; eligibility was not assumed.";
  }
  return null;
}

function pairwiseValues(values) {
  const pairwise = [];
  for (let i = 0; i < values.length; i += 1) {
    for (let j = i + 1; j < values.length; j += 1) {
      const difference = Math.abs(values[i].value - values[j].value);
      pairwise.push({
        source_a: values[i].source_id,
        source_b: values[j].source_id,
        difference,
        status: difference === 0 ? "agreement" : "difference_recorded"
      });
    }
  }
  return pairwise;
}

function analyzeGroup(variable, entries, options) {
  const eligible = [];
  const excluded = [];

  entries.forEach(({ record, index, qualityResult }) => {
    const reason = eligibleReason(record, variable, qualityResult);
    const details = sourceDetails(record, variable, qualityResult, reason === null, reason);
    (reason === null ? eligible : excluded).push({ index, details });
  });

  const values = eligible.map((entry) => entry.details);
  const sourceValues = entries.map((entry) =>
    sourceDetails(entry.record, variable, entry.qualityResult,
      eligible.some((item) => item.index === entry.index),
      eligible.some((item) => item.index === entry.index) ? null : eligibleReason(
        entry.record, variable, entry.qualityResult
      ))
  );
  const base = {
    variable,
    status: "no_eligible_sources",
    source_count: values.length,
    eligible_source_ids: values.map((item) => item.source_id),
    source_values: sourceValues,
    excluded_sources: excluded.map((item) => item.details),
    pairwise: [],
    statistics: {
      min: null,
      max: null,
      range: null,
      relative_disagreement: null,
      reference_scale: null
    },
    reasons: []
  };

  if (values.length === 0) {
    base.reasons.push("No eligible finite numeric source value passed the quality gate.");
    return base;
  }
  if (values.length === 1) {
    base.status = "single_source";
    base.reasons.push("Only one eligible source value is available; disagreement is not measurable.");
    return base;
  }

  const numbers = values.map((item) => item.value);
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  const range = max - min;
  const referenceScale = Math.max(Math.abs(min), Math.abs(max));
  const epsilon = options.reference_epsilon;
  base.status = range === 0 ? "agreement" : "disagreement";
  base.pairwise = pairwiseValues(values);
  base.statistics.min = min;
  base.statistics.max = max;
  base.statistics.range = range;
  base.statistics.reference_scale = referenceScale;
  if (referenceScale > epsilon) {
    base.statistics.relative_disagreement = range / referenceScale;
    base.reasons.push("Relative disagreement is range divided by the maximum absolute source value.");
  } else {
    base.reasons.push(
      `Relative disagreement is not meaningful because the reference scale is at or below ${epsilon}.`
    );
  }
  base.reasons.push(range === 0
    ? "All eligible source values are identical."
    : "Eligible source values differ; no scientific acceptability threshold was applied.");
  return base;
}

function analyzeDisagreement(records, options = {}) {
  if (!Array.isArray(records)) {
    throw new TypeError("Normalized source records must be an array.");
  }
  const config = { ...DEFAULT_OPTIONS, ...options };
  if (!isFiniteNumber(config.reference_epsilon) || config.reference_epsilon < 0) {
    throw new TypeError("reference_epsilon must be a finite, non-negative number.");
  }

  const groups = new Map();
  records.forEach((record, index) => {
    const variable = variableName(record);
    if (variable === null) return;
    if (!groups.has(variable)) groups.set(variable, []);
    groups.get(variable).push({
      record,
      index,
      qualityResult: qualityResultFor(options.qualityResults, index, record, variable)
    });
  });
  return {
    variables: [...groups.entries()].map(([variable, entries]) =>
      analyzeGroup(variable, entries, config)
    )
  };
}

const calculateDisagreement = analyzeDisagreement;
const assessDisagreement = analyzeDisagreement;

if (typeof window !== "undefined") {
  window.ThermalShieldFusionDisagreement = {
    analyzeDisagreement,
    calculateDisagreement,
    assessDisagreement
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    analyzeDisagreement,
    calculateDisagreement,
    assessDisagreement
  };
}
})();
