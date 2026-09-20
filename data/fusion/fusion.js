(function () {
"use strict";

let calculateWeights;
let assessConfidence;
let analyzeDisagreement;

if (typeof module !== "undefined" && module.exports) {
  ({ calculateWeights } = require("./weighting"));
  ({ assessConfidence } = require("./confidence"));
  ({ analyzeDisagreement } = require("./disagreement"));
} else if (typeof window !== "undefined") {
  ({ calculateWeights } = window.ThermalShieldFusionWeighting);
  ({ assessConfidence } = window.ThermalShieldFusionConfidence);
  ({ analyzeDisagreement } = window.ThermalShieldFusionDisagreement);
}

const MISSING_VALUE = "missing_value";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function variableEntry(record) {
  if (typeof record?.variable === "string" && record.variable.trim() !== "") {
    return {
      canonical_variable: record.variable,
      normalized_unit: record.unit ?? null
    };
  }

  const variables = record?.provenance?.variables;
  if (Array.isArray(variables) && variables.length === 1) {
    return variables[0];
  }

  const variable = record?.provenance?.variable;
  return typeof variable === "string" && variable.trim() !== ""
    ? { canonical_variable: variable, normalized_unit: record.provenance.units ?? null }
    : null;
}

function canonicalVariable(record) {
  return variableEntry(record)?.canonical_variable ?? null;
}

function valueFor(record, variable) {
  if (Object.prototype.hasOwnProperty.call(record || {}, "value")) {
    return record.value;
  }
  return record?.environment?.[variable];
}

function unitFor(record, entry) {
  return record?.unit ?? entry?.normalized_unit ?? record?.provenance?.units ?? null;
}

function sourceValue(record, qualityResult) {
  const entry = variableEntry(record);
  const variable = entry?.canonical_variable ?? null;
  return {
    source_id: record?.source_id ?? record?.provenance?.source_id ?? null,
    source_name: record?.source_name ?? record?.provenance?.source_name ?? null,
    value: valueFor(record, variable),
    unit: unitFor(record, entry),
    timestamp: record?.timestamp ?? record?.time?.timestamp ?? null,
    data_type: record?.data_type ?? record?.provenance?.data_type ?? null,
    quality: record?.quality ?? null,
    quality_result: qualityResult ?? null,
    forecast: record?.forecast ?? null,
    source_grid: record?.source_grid ?? record?.location?.source_grid ?? null
  };
}

function qualityFor(qualityResults, index, record) {
  const result = Array.isArray(qualityResults)
    ? qualityResults[index]
    : qualityResults?.[record?.source_id];
  if (!result) return null;
  if (Array.isArray(result.results)) {
    const variable = canonicalVariable(record);
    return result.results.find((item) => item.variable === variable) ?? result.results[0] ?? null;
  }
  return result;
}

function qualityStatus(result, record) {
  if (!result) {
    return valueFor(record, canonicalVariable(record)) == null ? MISSING_VALUE : "not_assessed";
  }
  return result.status ?? "not_assessed";
}

function pairAlignment(alignmentResults, indexA, indexB, sourceA, sourceB) {
  if (Array.isArray(alignmentResults)) {
    return alignmentResults.find((result) => {
      const records = result?.source_records ?? [];
      return (records[0] === sourceA && records[1] === sourceB) ||
        (records[0] === sourceB && records[1] === sourceA) ||
        (result?.source_a_index === indexA && result?.source_b_index === indexB) ||
        (result?.source_a_index === indexB && result?.source_b_index === indexA);
    }) ?? null;
  }
  return alignmentResults?.[`${indexA}:${indexB}`] ??
    alignmentResults?.[`${indexB}:${indexA}`] ?? null;
}

function pairIsCompatible(alignment) {
  return alignment?.status === "aligned" &&
    alignment?.metadata?.temporal?.status === "aligned" &&
    alignment?.metadata?.spatial?.status === "aligned";
}

function makeResult(
  variable,
  values,
  qualityResults,
  alignments,
  status,
  reason,
  weighting,
  disagreementResult,
  confidenceResult
) {
  const units = values.map((item) => item.unit).filter((unit) => unit != null);
  const unit = units.length > 0 ? units[0] : null;
  const unifiedValue = status === "single_source"
    ? values[0]?.value ?? null
    : status === "provisional_consensus"
      ? values.reduce((sum, item) =>
        sum + item.value * item.weighting.normalized_weight, 0)
      : null;

  return {
    canonical_variable: variable,
    status,
    unified_value: unifiedValue,
    unit,
    contributing_sources: status === "unavailable" ? [] : values.map((item) => item.source_id),
    source_values: values,
    alignment: {
      status: status === "provisional_consensus" || status === "single_source" ? "aligned" : "not_fusable",
      temporal: alignments.map((item) => item?.metadata?.temporal ?? null),
      spatial: alignments.map((item) => item?.metadata?.spatial ?? null),
      metadata: alignments
    },
    quality_assessment: {
      status: values.length > 0 ? "eligible_values_only" : "unavailable",
      results: values.map((item) => item.quality_result ?? null)
    },
    disagreement: disagreementResult ?? {
      variable,
      status: "not_calculated",
      reasons: []
    },
    confidence: confidenceResult ?? {
      status: "not_calculated",
      score: null,
      basis: null
    },
    weighting: weighting ?? null,
    methodology: {
      description: status === "provisional_consensus"
        ? "Variable-specific weighted consensus of eligible values after exact variable/unit matching and temporal/spatial alignment."
        : "No value was inferred. Eligible source values and layer results are preserved.",
      method: status,
      alignment_rules: [
        "Canonical variable and normalized unit must match exactly.",
        "Every contributing value must pass the quality gate.",
        "Multiple values require aligned temporal and spatial pairwise results.",
        "Source weights, disagreement, and confidence are retained from their respective fusion layers.",
        "No HTSI integration is applied."
      ]
    },
    missing_fields: reason ? [reason] : [],
    unavailable_sources: status === "unavailable"
      ? values.map((item) => ({ source_id: item.source_id, reason }))
      : []
  };
}

function fuseRecords(records, alignmentResults = [], qualityResults = [], options = {}) {
  if (!Array.isArray(records)) throw new TypeError("Normalized source records must be an array.");

  const weightingResults = calculateWeights(records, {
    ...(options.weighting ?? {}),
    alignments: alignmentResults
  });
  const disagreementResults = analyzeDisagreement(records, {
    ...(options.disagreement ?? {}),
    qualityResults
  });
  const confidenceResults = assessConfidence(records, {
    ...(options.confidence ?? {}),
    alignments: alignmentResults,
    weightingResults
  });
  const variableResult = (results, variable) =>
    results.variables.find((item) => item.variable === variable) ?? null;

  const groups = new Map();
  records.forEach((record, index) => {
    const variable = canonicalVariable(record);
    if (!groups.has(variable)) groups.set(variable, []);
    groups.get(variable).push({ record, index, quality: qualityFor(qualityResults, index, record) });
  });

  return {
    results: [...groups.entries()]
      .filter(([variable]) => variable !== null)
      .map(([variable, entries]) => {
        const eligible = entries.filter(({ record, quality }) =>
          qualityStatus(quality, record) === "eligible" &&
          isFiniteNumber(valueFor(record, variable))
        );
        const weighting = variableResult(weightingResults, variable);
        const disagreement = variableResult(disagreementResults, variable);
        const confidence = variableResult(confidenceResults, variable);
        const weightedSources = new Map(
          (weighting?.sources ?? []).map((source) => [source.source_id, source])
        );
        const sourceValues = eligible.map(({ record, quality }) => {
          const value = sourceValue(record, quality);
          return {
            ...value,
            weighting: weightedSources.get(value.source_id) ?? null
          };
        });
        if (eligible.length === 0) {
          return makeResult(variable, entries.map(({ record, quality }) => sourceValue(record, quality)),
            qualityResults, [], "unavailable", "No eligible non-missing value passed the quality gate.",
            weighting, disagreement, confidence);
        }
        if (eligible.length === 1) {
          return makeResult(variable, sourceValues, qualityResults, [], "single_source", null,
            weighting, disagreement, null);
        }

        const alignments = [];
        for (let i = 0; i < eligible.length; i += 1) {
          for (let j = i + 1; j < eligible.length; j += 1) {
            alignments.push(pairAlignment(
              alignmentResults, eligible[i].index, eligible[j].index,
              eligible[i].record, eligible[j].record
            ));
          }
        }
        const sameUnit = sourceValues.every((item) => item.unit === sourceValues[0].unit);
        if (!sameUnit || alignments.some((alignment) => !pairIsCompatible(alignment))) {
          return makeResult(variable, sourceValues, qualityResults, alignments, "unavailable",
            !sameUnit ? "Eligible values have incompatible units." : "Eligible values are not temporally and spatially compatible.",
            weighting, disagreement, confidence);
        }
        const weightedValues = sourceValues.filter((value) =>
          value.weighting?.eligible &&
          isFiniteNumber(value.weighting.normalized_weight)
        );
        if (weightedValues.length !== sourceValues.length) {
          return makeResult(variable, sourceValues, qualityResults, alignments, "unavailable",
            "One or more eligible values did not receive an eligible source weight.",
            weighting, disagreement, confidence);
        }
        return makeResult(variable, weightedValues, qualityResults, alignments,
          "provisional_consensus", null, weighting, disagreement, confidence);
      })
  };
}

const fuse = fuseRecords;

if (typeof window !== "undefined") window.ThermalShieldFusion = { fuse, fuseRecords };
if (typeof module !== "undefined" && module.exports) module.exports = { fuse, fuseRecords };
})();
