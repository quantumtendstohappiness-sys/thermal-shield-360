"use strict";

const DEFAULT_OPTIONS = Object.freeze({
  qualityScores: Object.freeze({ good: 1, acceptable: 0.75, poor: 0.25, missing: 0 }),
  forecastLeadTime: Object.freeze({ preferred_hours: 6, maximum_hours: 72 })
});

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function sourceId(record) {
  return record?.source_id ?? record?.provenance?.source_id ?? null;
}

function sourceName(record) {
  return record?.source_name ?? record?.provenance?.source_name ?? null;
}

function provenance(record) {
  return record?.provenance ?? null;
}

function variableName(record) {
  const direct = record?.variable;
  if (typeof direct === "string" && direct.trim() !== "") {
    return direct.trim();
  }
  const variableList = record?.provenance?.variables;
  if (Array.isArray(variableList) && variableList.length === 1) {
    return typeof variableList[0]?.canonical_variable === "string"
      ? variableList[0].canonical_variable.trim()
      : null;
  }
  return typeof record?.provenance?.variable === "string" && record.provenance.variable.trim() !== ""
    ? record.provenance.variable.trim()
    : null;
}

function valueOf(record, variable) {
  if (Object.prototype.hasOwnProperty.call(record || {}, "value")) {
    return record.value;
  }
  return record?.environment?.[variable] ?? null;
}

function qualityStatus(record) {
  return record?.quality?.status ?? record?.quality?.quality_flag ?? record?.quality_flag ?? null;
}

function dataType(record) {
  return record?.data_type ?? record?.provenance?.data_type ?? null;
}

function timestamp(record) {
  return record?.timestamp ?? record?.time?.timestamp ?? null;
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
  return alignments?.[`${indexA}:${indexB}`] ?? alignments?.[`${indexB}:${indexA}`] ?? null;
}

function alignmentSummary(alignments, type, record, recordIndex, records) {
  const items = [];
  records.forEach((other, otherIndex) => {
    if (other === record) return;
    const match = pairFor(alignments, record, other, recordIndex, otherIndex);
    const metadata = match?.metadata ?? {};
    const status = type === "temporal"
      ? metadata.temporal?.status ?? metadata?.status ?? null
      : metadata.spatial?.status ?? metadata?.status ?? null;
    if (status !== null) {
      items.push(status);
    }
  });

  if (items.length === 0) {
    return {
      name: `${type}_alignment`,
      score: 1,
      input: { status: "not_provided" },
      reason: "No pairwise alignment result was provided for this source; no penalty was asserted."
    };
  }

  const aligned = items.filter((status) => status === "aligned").length;
  const score = aligned === items.length ? 1 : 0;
  return {
    name: `${type}_alignment`,
    score,
    input: { status: items },
    reason: aligned === items.length
      ? "All supplied pairwise temporal/spatial alignment results are aligned."
      : "At least one supplied pairwise alignment result is not aligned."
  };
}

function forecastComponent(record, options) {
  const type = dataType(record);
  const forecast = record?.forecast;
  if (type !== "forecast") {
    return {
      name: "observation_forecast_status",
      score: 1,
      input: { data_type: type, status: "observation_or_non_forecast" },
      reason: "Observation data carries no forecast penalty; non-forecast sources retain their configured status."
    };
  }

  const valid = Date.parse(forecast?.valid_time ?? timestamp(record));
  const initialized = Date.parse(forecast?.initialization_time ?? timestamp(record));
  const leadHours = Number.isFinite(valid) && Number.isFinite(initialized)
    ? Math.max(0, (valid - initialized) / 3600000)
    : null;

  const preferred = options?.forecastLeadTime?.preferred_hours ?? DEFAULT_OPTIONS.forecastLeadTime.preferred_hours;
  const maximum = options?.forecastLeadTime?.maximum_hours ?? DEFAULT_OPTIONS.forecastLeadTime.maximum_hours;
  const relevance = leadHours === null
    ? 1
    : leadHours <= preferred
      ? 1
      : Math.max(0, 1 - (leadHours - preferred) / Math.max(1, maximum - preferred));

  return {
    name: "observation_forecast_status",
    score: relevance,
    input: { data_type: type, status: "forecast", lead_hours: leadHours },
    reason: leadHours === null
      ? "Forecast lead time is unavailable; no forecast penalty was inferred."
      : "Forecast relevance was derived from the configured lead-time policy."
  };
}

function agreementFactor(records, variable) {
  const finiteValues = records
    .map((record) => ({ record, value: valueOf(record, variable) }))
    .filter(({ value }) => isFiniteNumber(value));

  if (finiteValues.length < 2) {
    return {
      score: 1,
      status: "not_applicable",
      pairwise: [],
      reason: "Only one eligible value is available for this variable; no agreement penalty was applied."
    };
  }

  const pairwise = [];
  for (let i = 0; i < finiteValues.length; i += 1) {
    for (let j = i + 1; j < finiteValues.length; j += 1) {
      const a = finiteValues[i].value;
      const b = finiteValues[j].value;
      pairwise.push({
        source_a: sourceId(finiteValues[i].record),
        source_b: sourceId(finiteValues[j].record),
        difference: Math.abs(a - b),
        status: a === b ? "agreement" : "disagreement"
      });
    }
  }

  if (pairwise.length === 0) {
    return {
      score: 1,
      status: "not_applicable",
      pairwise,
      reason: "Agreement data is unavailable because no comparable values were present."
    };
  }

  const hasDisagreement = pairwise.some((entry) => entry.status === "disagreement");
  return {
    score: hasDisagreement ? 0.75 : 1,
    status: hasDisagreement ? "disagreement" : "agreement",
    pairwise,
    reason: hasDisagreement
      ? "Multiple variable values are present and at least one pair disagrees; confidence was reduced to reflect the disagreement."
      : "All comparable values agree; confidence reflects source agreement."
  };
}

function component(name, score, input, reason) {
  return {
    name,
    score: Math.max(0, Math.min(1, score)),
    input,
    reason
  };
}

function prepareWeightingInput(weightingResults, variable) {
  if (!weightingResults) {
    return null;
  }

  if (Array.isArray(weightingResults.variables)) {
    const variableResult = weightingResults.variables.find((item) => item.variable === variable);
    if (variableResult) {
      return variableResult;
    }
  }

  if (Array.isArray(weightingResults)) {
    const variableResult = weightingResults.find((item) => item.variable === variable);
    if (variableResult) {
      return variableResult;
    }
  }

  if (isObject(weightingResults) && Object.prototype.hasOwnProperty.call(weightingResults, variable)) {
    return weightingResults[variable];
  }

  return null;
}

function recordIsEligible(record, variable) {
  const value = valueOf(record, variable);
  const status = qualityStatus(record);
  const reasons = [];

  if (!variable) {
    reasons.push("Canonical variable is missing.");
  }
  if (!isFiniteNumber(value)) {
    reasons.push("Variable value is missing or not finite.");
  }
  if (status === "poor" || status === "missing") {
    reasons.push(`Source quality status is ${status}.`);
  }
  if (sourceId(record) == null) {
    reasons.push("Source identifier is missing.");
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    quality_status: status,
    value
  };
}

function assessConfidence(records, options = {}) {
  if (!Array.isArray(records)) {
    throw new TypeError("Normalized source records must be an array.");
  }

  const alignments = options.alignments ?? options.alignmentResults ?? [];
  const weightingResults = options.weightingResults ?? options.weights ?? options.weighting ?? null;
  const groups = new Map();

  records.forEach((record, index) => {
    const variable = variableName(record);
    if (!groups.has(variable)) {
      groups.set(variable, []);
    }
    groups.get(variable).push({ record, index });
  });

  const variables = [...groups.entries()].map(([variable, entries]) => {
    const eligibleEntries = entries.filter(({ record }) => recordIsEligible(record, variable).eligible);
    const agreement = agreementFactor(eligibleEntries.map(({ record }) => record), variable);
    const weightingInput = prepareWeightingInput(weightingResults, variable);
    const sourceMap = new Map();
    if (Array.isArray(weightingInput?.sources)) {
      weightingInput.sources.forEach((source) => {
        if (source?.source_id) {
          sourceMap.set(source.source_id, source);
        }
      });
    }

    const sources = entries.map(({ record, index }) => {
      const eligibility = recordIsEligible(record, variable);
      const weightingSource = sourceMap.get(sourceId(record));
      const rawWeight = weightingSource?.raw_weight ?? null;
      const normalizedWeight = weightingSource?.normalized_weight ?? null;
      const qualityScore = DEFAULT_OPTIONS.qualityScores[qualityStatus(record)] ?? 0;

      const temporal = alignmentSummary(alignments, "temporal", record, index, entries.map((entry) => entry.record));
      const spatial = alignmentSummary(alignments, "spatial", record, index, entries.map((entry) => entry.record));
      const dataAvailability = component(
        "data_availability",
        isFiniteNumber(valueOf(record, variable)) ? 1 : 0,
        { value_present: isFiniteNumber(valueOf(record, variable)) },
        isFiniteNumber(valueOf(record, variable))
          ? "Finite value is available for the source."
          : "Value is missing or non-finite; no availability confidence is assigned."
      );
      const forecast = forecastComponent(record, options);
      const sourceQuality = component(
        "source_quality",
        qualityScore,
        { quality_status: qualityStatus(record) },
        "Score reflects the record-quality status supplied by the source."
      );

      const components = [sourceQuality, temporal, spatial, dataAvailability, forecast];
      const sourceScore = components.reduce((score, item) => score * item.score, 1) * agreement.score;
      const reasons = [...eligibility.reasons];

      if (!eligibility.eligible) {
        reasons.push("Source is not eligible for confidence assessment.");
      }
      if (weightingSource && weightingSource.eligible === false) {
        reasons.push("Source was marked ineligible by the weighting layer.");
      }

      return {
        source_id: sourceId(record),
        source_name: sourceName(record),
        variable,
        provenance: provenance(record),
        data_type: dataType(record),
        value: valueOf(record, variable),
        unit: record?.unit ?? record?.provenance?.units ?? null,
        eligible: eligibility.eligible && (weightingSource ? weightingSource.eligible !== false : true),
        reasons,
        raw_weight: rawWeight,
        normalized_weight: normalizedWeight,
        components,
        agreement: {
          status: agreement.status,
          score: agreement.score,
          reason: agreement.reason,
          pairwise: agreement.pairwise
        },
        confidence_score: eligibility.eligible && (weightingSource ? weightingSource.eligible !== false : true)
          ? sourceScore
          : 0,
        quality_status: qualityStatus(record)
      };
    });

    const availableSources = sources.filter((source) => source.eligible);
    return {
      variable,
      status: availableSources.length > 0 ? "assessed" : "unavailable",
      source_count: availableSources.length,
      eligible_source_ids: availableSources.map((source) => source.source_id),
      confidence: {
        score: availableSources.length === 0
          ? 0
          : availableSources.reduce((sum, source) => sum + source.confidence_score, 0) / availableSources.length,
        status: availableSources.length === 0 ? "unavailable" : "assessed",
        reason: availableSources.length === 0
          ? "No eligible source values remained after quality and availability checks."
          : "Confidence was computed from eligible source quality, alignment, availability, forecast relevance, and source agreement."
      },
      agreement: {
        status: agreement.status,
        score: agreement.score,
        reason: agreement.reason,
        pairwise: agreement.pairwise
      },
      sources,
      reasons: availableSources.length === 0
        ? ["No eligible source records remained."]
        : []
    };
  });

  return { variables };
}

const calculateConfidence = assessConfidence;
const scoreConfidence = assessConfidence;

if (typeof window !== "undefined") {
  window.ThermalShieldFusionConfidence = {
    assessConfidence,
    calculateConfidence,
    scoreConfidence
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { assessConfidence, calculateConfidence, scoreConfidence };
}
