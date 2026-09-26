const $ = id => document.getElementById(id);

let thermalShieldFusionResult = null;
const thermalShieldFusionSources = new Map();
let weatherLoadSequence = 0;
let selectedLocation = null;

function setSelectedLocation({ name, latitude, longitude }) {
  if (
    typeof name !== "string" ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    throw new Error("Selected location must have a name and finite coordinates.");
  }

  selectedLocation = {
    name,
    latitude,
    longitude
  };
  thermalShieldFusionSources.clear();
  thermalShieldFusionResult = null;
  window.thermalShieldFusionResult = null;
  ["temp", "rh", "wind", "rad"].forEach(id => {
    $(id).value = "";
  });
  updateThermalShieldFusion();
  $("lat").value = latitude;
  $("lon").value = longitude;
  $("selectedLocation").textContent = `📍 ${name}`;
  weatherLoadSequence += 1;
}

function selectedLocationForRequest() {
  if (!selectedLocation) return null;
  return {
    name: selectedLocation.name,
    latitude: selectedLocation.latitude,
    longitude: selectedLocation.longitude
  };
}

function registerThermalShieldFusionSource(normalized) {
  const sourceId = normalized?.provenance?.source_id;
  if (typeof sourceId !== "string" || sourceId.trim() === "") {
    throw new Error("Normalized source record is missing provenance.source_id.");
  }

  const dataType = String(normalized?.provenance?.data_type ?? "").toLowerCase();
  const dataStatus = String(normalized?.provenance?.data_status ?? "").toLowerCase();
  const sourceKey = sourceId.toLowerCase();

  // ONE fusion engine, three logical layers.
  // Never infer current state from a forecast valid time.
  const isOpenMeteoCurrent =
    sourceKey.includes("open_meteo") &&
    (dataStatus === "current" || dataStatus === "now");

  const isForecastSource =
    dataType === "forecast" ||
    dataStatus === "forecast" ||
    sourceKey.includes("ecmwf") ||
    sourceKey.includes("gfs") ||
    sourceKey.includes("gefs");

  const fusionLayer =
    isOpenMeteoCurrent ? "current" :
    isForecastSource ? "forecast" :
    ["reanalysis", "analysis", "historical"].includes(dataType) ||
    ["historical", "reanalysis", "analysis"].includes(dataStatus) ||
    sourceKey.includes("nasa_power") ? "historical" :
    "unclassified";

  const fusionRecord = {
    ...normalized,
    fusion_layer: fusionLayer
  };

  const fusionKey = fusionLayer === "forecast" ? sourceId + ":" + (normalized?.forecast?.valid_time || normalized?.time?.timestamp || Date.now()) : sourceId; thermalShieldFusionSources.set(fusionKey, fusionRecord);
  updateThermalShieldFusion();
}

function nasaTimestampToISO(timestamp) {
  const match = String(timestamp).match(
    /^(\d{4})(\d{2})(\d{2})(\d{2})$/
  );

  if (!match) {
    throw new Error("NASA POWER returned an invalid observation timestamp.");
  }

  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:00:00Z`;
}

function normalizedVariableNames(normalized) {
  return normalized.provenance.variables.map(
    entry => entry.canonical_variable
  );
}

function normalizedVariableRecord(normalized, variable) {
  const lineage = normalized.provenance.variables.find(
    entry => entry.canonical_variable === variable
  );

  if (!lineage) {
    throw new Error(
      `Normalized source is missing lineage for ${variable}.`
    );
  }

  return {
    source_id: normalized.provenance.source_id,
    source_name: normalized.provenance.source_name,
    variable,
    value: normalized.environment[variable] ?? lineage.normalized_value ?? null,
    unit: lineage.normalized_unit,
    timestamp:
      lineage.source_timestamp ??
      lineage.forecast_valid_time ??
      normalized.time.timestamp,
    retrieved_at: normalized.provenance.retrieved_at,
    location: {
      ...normalized.location,
      source_grid: lineage.source_grid ?? normalized.location.source_grid
    },
    data_type: normalized.provenance.data_type,
    fusion_layer: normalized.fusion_layer ?? null,
    quality_flag: lineage.status === "missing" ? "missing" : lineage.status === "poor" ? "poor" : "acceptable",
    forecast: {
      initialization_time:
        lineage.forecast_initialization_time ??
        normalized.time.forecast_initialization_time ??
        null,
      valid_time:
        lineage.forecast_valid_time ??
        normalized.time.forecast_valid_time ??
        null,
      lead_hours: normalized.time.forecast_lead_hours ?? null,
      step: lineage.forecast_step ?? normalized.time.forecast_step ?? null
    },
    provenance: {
      source_id: normalized.provenance.source_id,
      source_name: normalized.provenance.source_name,
      data_type: normalized.provenance.data_type,
    fusion_layer: normalized.fusion_layer ?? null,
      retrieved_at: normalized.provenance.retrieved_at,
      data_status: normalized.provenance.data_status,
      variables: [lineage]
    },
    quality: normalized.quality
  };
}

function normalizedHasVariable(normalized, variable) {
  return normalizedVariableNames(normalized).includes(variable);
}

function appendFusionField(container, label, value) {
  const field = document.createElement("div");
  const heading = document.createElement("b");
  const content = document.createElement("span");
  heading.textContent = label;
  content.textContent = displayValue(value);
  field.append(heading, content);
  container.appendChild(field);
}

function appendPresentFusionField(container, label, value) {
  if (value === null || value === undefined || value === "") return;
  appendFusionField(container, label, value);
}

function fusionStatusLabel(status) {
  if (status === "single_source") return "Single-source";
  if (status === "provisional_consensus") return "Fused / consensus";
  if (status === "unavailable") return "Unavailable";
  return status || "Unavailable";
}

function fusionStatusClass(status) {
  if (status === "single_source") return "single-source";
  if (status === "provisional_consensus") return "consensus";
  return "unavailable";
}

function appendFusionList(container, label, values) {
  if (!Array.isArray(values) || values.length === 0) return;
  appendFusionField(container, label, values.join(", "));
}

function appendFusionSourceValues(container, sourceValues) {
  if (!Array.isArray(sourceValues) || sourceValues.length === 0) return;

  sourceValues.forEach(source => {
    if (!source || typeof source !== "object") return;
    const sourceLabel = [
      source.source_id,
      source.timestamp,
      source.unit
    ].filter(Boolean).join(" · ");
    appendPresentFusionField(
      container,
      `Source value${sourceLabel ? ` (${sourceLabel})` : ""}`,
      source.value
    );
  });
}

function appendFusionAlignment(container, alignment) {
  if (!alignment || typeof alignment !== "object") return;
  if (alignment.status) {
    appendFusionField(container, "Overall alignment", alignment.status);
  }

  ["temporal", "spatial"].forEach(type => {
    const values = Array.isArray(alignment[type])
      ? alignment[type]
      : [alignment[type]];
    const statuses = values
      .filter(value => value && typeof value === "object" && value.status)
      .map(value => value.status);
    appendFusionList(container, `${type[0].toUpperCase()}${type.slice(1)} alignment`, statuses);
  });
}

function renderThermalShieldFusion(result) {
  const status = $("fusionStatus");
  const resultsBox = $("fusionResults");
  resultsBox.replaceChildren();

  if (!result || !Array.isArray(result.results) || result.results.length === 0) {
    status.textContent = "No fusion result is available.";
    return;
  }

  status.textContent = `${result.results.length} fusion result${
    result.results.length === 1 ? "" : "s"
  } available.`;

  const fusionLayers = [
    ["historical", "Historical Fusion"],
    ["current", "Current Fusion"],
    ["forecast", "Forecast Fusion"]
  ];

  fusionLayers.forEach(([layer, layerTitle]) => {
    const layerBox = document.createElement("section");
    layerBox.className = "fusion-layer-section";

    const layerHeading = document.createElement("h4");
    layerHeading.textContent = layerTitle;
    layerHeading.className = "fusion-layer-heading";
    layerBox.appendChild(layerHeading);

    const layerResults = result.results.filter(
      fusion => fusion.fusion_layer === layer
    );

    if (layerResults.length === 0) {
      const empty = document.createElement("p");
      empty.textContent = "No fusion results available for this layer.";
      empty.className = "fusion-layer-empty";
      layerBox.appendChild(empty);
    }

    layerResults.forEach(fusion => {
    const card = document.createElement("article");
    card.className = `fusion-result ${fusionStatusClass(fusion.status)}`;

    const heading = document.createElement("h3");
    heading.textContent = fusion.canonical_variable || "Unnamed variable";
    card.appendChild(heading);

    const statusBadge = document.createElement("span");
    statusBadge.className = "fusion-status";
    statusBadge.textContent = fusionStatusLabel(fusion.status);
    card.appendChild(statusBadge);

    const fields = document.createElement("div");
    fields.className = "fusion-fields";
    appendFusionField(fields, "Unified value", fusion.unified_value);
    appendFusionField(fields, "Unit", fusion.unit);
    appendFusionList(fields, "Contributing source IDs", fusion.contributing_sources);
    appendFusionSourceValues(fields, fusion.source_values);
    appendFusionAlignment(fields, fusion.alignment);

    if (fusion.confidence && typeof fusion.confidence === "object") {
      appendPresentFusionField(fields, "Confidence status", fusion.confidence.status);
      if (fusion.confidence.score !== null && fusion.confidence.score !== undefined) {
        appendFusionField(fields, "Confidence score", fusion.confidence.score);
      }
      appendPresentFusionField(fields, "Confidence basis", fusion.confidence.basis);
      appendPresentFusionField(fields, "Confidence reason", fusion.confidence.reason);
    }

    if (fusion.disagreement && typeof fusion.disagreement === "object") {
      appendPresentFusionField(fields, "Disagreement", fusion.disagreement.status);
      appendPresentFusionField(fields, "Disagreement details", fusion.disagreement.details);
      if (Array.isArray(fusion.disagreement.pairwise)) {
        const pairwise = fusion.disagreement.pairwise
          .map(pair => {
            if (!pair || typeof pair !== "object") return null;
            const sources = [pair.source_a, pair.source_b].filter(Boolean).join(" / ");
            const difference = pair.difference === null || pair.difference === undefined
              ? null
              : `difference ${pair.difference}`;
            return [sources, difference, pair.status].filter(Boolean).join(": ");
          })
          .filter(Boolean);
        appendFusionList(fields, "Pairwise disagreement", pairwise);
      }
      appendFusionList(fields, "Disagreement reasons", fusion.disagreement.reasons);
    }

    appendPresentFusionField(fields, "Quality status", fusion.quality_assessment?.status);
    appendFusionList(fields, "Missing fields", fusion.missing_fields);
    if (Array.isArray(fusion.unavailable_sources) && fusion.unavailable_sources.length > 0) {
      const unavailable = fusion.unavailable_sources
        .map(source => [source?.source_id, source?.reason].filter(Boolean).join(": "))
        .filter(Boolean);
      appendFusionList(fields, "Unavailable sources", unavailable);
    }

    card.appendChild(fields);
    layerBox.appendChild(card);
  });

  resultsBox.appendChild(layerBox);
  });
}

function updateThermalShieldFusion() {
  const sources = [...thermalShieldFusionSources.values()]
    .filter(Boolean);

  if (sources.length === 0) {
    thermalShieldFusionResult = null;
    window.thermalShieldFusionResult = null;
    renderThermalShieldFusion(null);
    return;
  }

  const variables = [...new Set(
    sources.flatMap(normalizedVariableNames)
  )];
  const records = variables.flatMap(variable =>
    sources
      .filter(source => normalizedHasVariable(source, variable))
      .map(source => normalizedVariableRecord(source, variable))
  );
  const qualityGate = window.ThermalShieldFusionQualityGate;
  if (!qualityGate || typeof qualityGate.evaluateRecords !== "function") {
    throw new Error(
      "Fusion quality gate failed to load from data/fusion/quality-gate.js."
    );
  }
  const quality = qualityGate.evaluateRecords(
    records
  );
  const alignments = [];

  for (let i = 0; i < records.length; i += 1) {
    for (let j = i + 1; j < records.length; j += 1) {
      if (records[i].variable === records[j].variable) {
        alignments.push(
          window.ThermalShieldAlignment.alignRecords(
            records[i],
            records[j]
          )
        );
      }
    }
  }

  const layerResults = [];
  for (const layer of ["historical", "current", "forecast"]) {
    const layerRecords = records.filter(
      (record) => record.fusion_layer === layer
    );
    if (layerRecords.length === 0) continue;

    if (layer === "forecast") {       const forecastGroups = [...layerRecords.reduce((map, record) => {               const key = record.forecast?.valid_time || record.timestamp || "unknown";                       if (!map.has(key)) map.set(key, []);                               map.get(key).push(record);                                       return map;                                             }, new Map()).values()];                                                   for (const groupRecords of forecastGroups) {                                                           const groupQuality = qualityGate.evaluateRecords(groupRecords);                                                                   const groupAlignments = [];                                                                           for (let i = 0; i < groupRecords.length; i += 1) {                                                                                     for (let j = i + 1; j < groupRecords.length; j += 1) {                                                                                                 if (groupRecords[i].variable === groupRecords[j].variable) {                                                                                                               groupAlignments.push(window.ThermalShieldAlignment.alignRecords(groupRecords[i], groupRecords[j]));                                                                                                                           }                                                                                                                                     }                                                                                                                                             }                                                                                                                                                     const groupResult = window.ThermalShieldFusion.fuseRecords(groupRecords, groupAlignments, groupQuality);                                                                                                                                                             groupResult.results.forEach((item) => { item.fusion_layer = layer; });                                                                                                                                                                     layerResults.push(...groupResult.results);                                                                                                                                                                           }                                                                                                                                                                                 continue;                                                                                                                                                                                     }                                                                                                                                                                                         if (layer === "forecast") {       const forecastGroups = [...layerRecords.reduce((map, record) => {               const key = record.forecast?.valid_time || record.timestamp || "unknown";                       if (!map.has(key)) map.set(key, []);                               map.get(key).push(record);                                       return map;                                             }, new Map()).values()];                                                   for (const groupRecords of forecastGroups) {                                                           const groupQuality = qualityGate.evaluateRecords(groupRecords);                                                                   const groupAlignments = [];                                                                           for (let i = 0; i < groupRecords.length; i += 1) {                                                                                     for (let j = i + 1; j < groupRecords.length; j += 1) {                                                                                                 if (groupRecords[i].variable === groupRecords[j].variable) {                                                                                                               groupAlignments.push(window.ThermalShieldAlignment.alignRecords(groupRecords[i], groupRecords[j]));                                                                                                                           }                                                                                                                                     }                                                                                                                                             }                                                                                                                                                     const groupResult = window.ThermalShieldFusion.fuseRecords(groupRecords, groupAlignments, groupQuality);                                                                                                                                                             groupResult.results.forEach((item) => { item.fusion_layer = layer; });                                                                                                                                                                     layerResults.push(...groupResult.results);                                                                                                                                                                           }                                                                                                                                                                                 continue;                                                                                                                                                                                     }                                                                                                                                                                                         const layerQuality = qualityGate.evaluateRecords(layerRecords);
    const layerAlignments = [];

    for (let i = 0; i < layerRecords.length; i += 1) {
      for (let j = i + 1; j < layerRecords.length; j += 1) {
        if (layerRecords[i].variable === layerRecords[j].variable) {
          layerAlignments.push(
            window.ThermalShieldAlignment.alignRecords(
              layerRecords[i],
              layerRecords[j]
            )
          );
        }
      }
    }

    const result = window.ThermalShieldFusion.fuseRecords(
      layerRecords,
      layerAlignments,
      layerQuality
    );

    result.results.forEach((item) => {
      item.fusion_layer = layer;
    });
    layerResults.push(...result.results);
  }

  thermalShieldFusionResult = {
    results: layerResults
  };
  window.thermalShieldFusionResult = thermalShieldFusionResult;
  renderThermalShieldFusion(thermalShieldFusionResult);
}

const HTSI_FUSION_INPUTS = Object.freeze({
  air_temperature_c: { key: "T", unit: "degC" },
  relative_humidity_pct: { key: "RH", unit: "%" },
  wind_speed_ms: { key: "wind", unit: "m/s" },
  solar_radiation_wm2: { key: "rad", unit: "W/m2" }
});

function validFusionSourceValue(source, unit) {
  return source &&
    typeof source === "object" &&
    typeof source.source_id === "string" &&
    source.source_id !== "" &&
    Number.isFinite(source.value) &&
    source.unit === unit &&
    typeof source.timestamp === "string" &&
    Number.isFinite(Date.parse(source.timestamp));
}

function eligibleFusionResult(result, unit) {
  if (!result ||
      !["single_source", "provisional_consensus"].includes(result.status) ||
      result.quality_assessment?.status !== "eligible_values_only" ||
      result.alignment?.status !== "aligned" ||
      result.unit !== unit ||
      !Number.isFinite(result.unified_value) ||
      !Array.isArray(result.contributing_sources) ||
      result.contributing_sources.length === 0 ||
      !Array.isArray(result.source_values) ||
      result.source_values.length === 0 ||
      !result.source_values.every(source => validFusionSourceValue(source, unit))) {
    return false;
  }

  if (result.status === "provisional_consensus") {
    const temporal = result.alignment?.temporal;
    const spatial = result.alignment?.spatial;
    return Array.isArray(temporal) &&
      temporal.length > 0 &&
      temporal.every(item => item?.status === "aligned") &&
      Array.isArray(spatial) &&
      spatial.length > 0 &&
      spatial.every(item => item?.status === "aligned");
  }

  return true;
}

function fusedHTSIInputs(result) {
  const inputs = {};
  if (!result || !Array.isArray(result.results)) return inputs;

  result.results.forEach(fusion => {
    const input = HTSI_FUSION_INPUTS[fusion?.canonical_variable];
    if (input && fusion.fusion_layer === "current" && eligibleFusionResult(fusion, input.unit)) {
      inputs[input.key] = fusion.unified_value;
    }
  });

  return inputs;
}

function normalizeNASAObservation({
  latitude,
  longitude,
  timestamp,
  parameterData,
  retrievedAt = new Date().toISOString()
}) {
  const normalizedValue = value =>
    value === -999 || value === -999.0 || !Number.isFinite(value)
      ? null
      : value;
  const environment = {
    air_temperature_c: normalizedValue(parameterData.T2M[timestamp]),
    relative_humidity_pct: normalizedValue(parameterData.RH2M[timestamp]),
    wind_speed_ms: normalizedValue(parameterData.WS10M[timestamp]),
    solar_radiation_wm2: normalizedValue(
      parameterData.ALLSKY_SFC_SW_DWN?.[timestamp]
    ),
    nasa_wet_bulb_related_c: normalizedValue(
      parameterData.T2MWET?.[timestamp]
    ),
    dew_point_c: normalizedValue(parameterData.T2MDEW?.[timestamp])
  };
  const missingFields = Object.entries(environment)
    .filter(([, value]) => value === null)
    .map(([name]) => `environment.${name}`);

  return window.normalizeNASARecord({
    location: {
      name: "NASA POWER point",
      latitude,
      longitude
    },
    time: {
      timestamp: nasaTimestampToISO(timestamp),
      timezone: "UTC"
    },
    environment,
    provenance: {
      source_id: "nasa_power",
      source_name:
        "NASA Prediction Of Worldwide Energy Resources (POWER)",
      data_type: "reanalysis",
      variables:
        "T2M,RH2M,WS10M,T2MWET,T2MDEW,ALLSKY_SFC_SW_DWN",
      retrieved_at: retrievedAt
    },
    quality: {
      quality_flag: "acceptable",
      missing_fields: missingFields
    }
  });
}

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

function wetBulbStull(T, RH) {
  const rh = clamp(RH, 5, 99);

  return T * Math.atan(0.151977 * Math.sqrt(rh + 8.313659))
    + Math.atan(T + rh)
    - Math.atan(rh - 1.676331)
    + 0.00391838 * Math.pow(rh, 1.5) * Math.atan(0.023101 * rh)
    - 4.686035;
}

/*
 * IMPORTANT:
 * This is a transparent WBGT proxy for the prototype UI.
 * It is NOT official ISO WBGT because measured globe
 * temperature is unavailable.
 */
function wbgtProxy(T, RH, wind, rad) {
  const tw = wetBulbStull(T, RH);

  const globeProxy =
    T +
    0.20 * Math.sqrt(Math.max(0, rad)) -
    0.7 * Math.min(wind, 10);

  return 0.7 * tw + 0.2 * globeProxy + 0.1 * T;
}

async function loadNASA(latitude, longitude, loadSequence) {
  try {

    function formatUTCDate(date) {
      return [
        date.getUTCFullYear(),
        String(date.getUTCMonth() + 1).padStart(2, "0"),
        String(date.getUTCDate()).padStart(2, "0")
      ].join("");
    }

    const endDate = new Date();
    const startDate = new Date(
      endDate.getTime() - 10 * 24 * 60 * 60 * 1000
    );

    const start = formatUTCDate(startDate);
    const end = formatUTCDate(endDate);

    const nasaUrl =
      "https://power.larc.nasa.gov/api/temporal/hourly/point" +
      "?parameters=T2M,RH2M,WS10M,T2MWET,T2MDEW,ALLSKY_SFC_SW_DWN" +
      "&community=SB" +
      `&longitude=${encodeURIComponent(longitude)}` +
      `&latitude=${encodeURIComponent(latitude)}` +
      `&start=${start}` +
      `&end=${end}` +
      "&format=JSON" +
      "&time-standard=UTC";

    const response = await fetch(nasaUrl);

    if (!response.ok) {
      throw new Error(
        `NASA POWER HTTP ${response.status}`
      );
    }

    const data = await response.json();
    if (loadSequence !== weatherLoadSequence) {
      return {
        source: "NASA POWER",
        status: "stale"
      };
    }

    const parameterData =
      data.properties?.parameter;
    const responseCoordinates = data.geometry?.coordinates;
    if (
      !parameterData ||
      !parameterData.T2M ||
      !parameterData.RH2M ||
      !parameterData.WS10M ||
      !Array.isArray(responseCoordinates) ||
      !Number.isFinite(responseCoordinates[0]) ||
      !Number.isFinite(responseCoordinates[1])
    ) {
      throw new Error(
        "NASA POWER returned incomplete weather data or coordinates."
      );
    }

    const timestamps =
      Object.keys(parameterData.T2M)
        .sort()
        .reverse();

    const latestTimestamp =
  timestamps.find((timestamp) =>
    parameterData.T2M[timestamp] !== -999 &&
    parameterData.RH2M?.[timestamp] !== -999 &&
    parameterData.WS10M?.[timestamp] !== -999 &&
    Number.isFinite(parameterData.T2M[timestamp]) &&
    Number.isFinite(parameterData.RH2M?.[timestamp]) &&
    Number.isFinite(parameterData.WS10M?.[timestamp])
  );

    if (!latestTimestamp) {
      throw new Error(
        "No valid NASA POWER observation was found."
      );
    }

    function cleanNASAValue(value) {
      if (
        value === -999 ||
        value === -999.0 ||
        !Number.isFinite(value)
      ) {
        return null;
      }

      return value;
    }

    const temperature =
      cleanNASAValue(
        parameterData.T2M[latestTimestamp]
      );

    const humidity =
      cleanNASAValue(
        parameterData.RH2M[latestTimestamp]
      );

    const wind =
      cleanNASAValue(
        parameterData.WS10M[latestTimestamp]
      );

    const wetBulb =
      cleanNASAValue(
        parameterData.T2MWET?.[latestTimestamp]
      );

    const dewPoint =
      cleanNASAValue(
        parameterData.T2MDEW?.[latestTimestamp]
      );

    const solarRadiation =
      cleanNASAValue(
        parameterData.ALLSKY_SFC_SW_DWN?.[
          latestTimestamp
        ]
      );

    if (
      !Number.isFinite(temperature) ||
      !Number.isFinite(humidity) ||
      !Number.isFinite(wind)
    ) {
      throw new Error(
        "Latest NASA POWER observation is incomplete."
      );
    }

    const retrievedAt = new Date().toISOString();
    registerThermalShieldFusionSource(
      normalizeNASAObservation({
        latitude,
        longitude,
        timestamp: latestTimestamp,
        parameterData,
        retrievedAt
      })
    );

    const nasaDisplayData = {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [longitude, latitude]
      },
      properties: {
        source: "NASA POWER",
        source_id: "nasa_power",
        data_type: "reanalysis",
        observation_timestamp_utc: latestTimestamp,
        retrieved_at: retrievedAt,
        environment: {
          air_temperature_c: temperature,
          relative_humidity_pct: humidity,
          wind_speed_ms: wind,
          nasa_wet_bulb_related_c: wetBulb,
          dew_point_c: dewPoint,
          solar_radiation_wm2: solarRadiation
        },
        provenance: {
          provider:
            "NASA Prediction Of Worldwide Energy Resources (POWER)",
          variables:
            "T2M,RH2M,WS10M,T2MWET,T2MDEW,ALLSKY_SFC_SW_DWN",
          time_standard: "UTC",
          note:
            "Live NASA POWER response requested for the selected location. T2MWET is retained as a NASA POWER wet-bulb-related parameter and is not treated as measured natural wet-bulb temperature."
        },
        quality: {
          quality_flag: "acceptable",
          missing_fields: Object.entries({
            air_temperature_c: temperature,
            relative_humidity_pct: humidity,
            wind_speed_ms: wind,
            nasa_wet_bulb_related_c: wetBulb,
            dew_point_c: dewPoint,
            solar_radiation_wm2: solarRadiation
          })
            .filter(([, value]) => value === null)
            .map(([name]) => `environment.${name}`)
        }
      }
    };
    const nasaNormalized = normalizeNASAObservation({
      latitude,
      longitude,
      timestamp: latestTimestamp,
      parameterData,
      retrievedAt: nasaDisplayData.properties.retrieved_at
    });
    renderNASAResearch(nasaDisplayData, nasaNormalized, {
      name: selectedLocation?.name,
      latitude,
      longitude
    });

    $("temp").value = temperature;
    $("rh").value = humidity;
    $("wind").value = wind;

    if (Number.isFinite(solarRadiation)) {
      $("rad").value = solarRadiation;
    } else {
      $("rad").value = "";
    }

    $("nasaResearchStatus").textContent =
      `NASA POWER loaded for ${latitude}, ${longitude}: ` +
      `${latestTimestamp} UTC.`;

    return {
      source: "NASA POWER",
      status: "success"
    };
  } catch (e) {
    if (loadSequence !== weatherLoadSequence) {
      return {
        source: "NASA POWER",
        status: "stale"
      };
    }
    $("nasaResearchStatus").textContent =
      `NASA POWER research-data load failed: ${e.message}`;
    return {
      source: "NASA POWER",
      status: "failure",
      error: e
    };
  }
}


async function loadOpenMeteo(latitude, longitude, loadSequence) {
  const host = document.querySelector("main") || document.body;
  let card = document.getElementById("openMeteoCard");
  if (!card) {
    card = document.createElement("section");
    card.id = "openMeteoCard";
    card.style.cssText = "margin:16px 0;padding:24px;border:1px solid #e1e5ea;border-radius:20px;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.06);";
    const fusionSection = Array.from(host.querySelectorAll("section")).find(el =>
    /Multi-Source Environmental Data Fusion/i.test(el.textContent || "")
  );
  if (fusionSection && fusionSection !== card) {
    host.insertBefore(card, fusionSection);
  } else {
    host.appendChild(card);
  }
  }
  card.innerHTML = `<h2 style="margin:0 0 12px;">4. Open-Meteo research-data display</h2><div>Loading selected location…</div>`;
  try {
    const raw = await window.fetchOpenMeteo(latitude, longitude);
    if (loadSequence !== weatherLoadSequence) return { source: "Open-Meteo", status: "stale" };
    const normalized = window.normalizeOpenMeteoRecord(raw);
    registerThermalShieldFusionSource(normalized);
    const e = normalized.environment || {};
    card.innerHTML = `
      <h2 style="margin:0 0 12px;">4. Open-Meteo research-data display</h2>
      <div>Located: ${Number(latitude).toFixed(5)}, ${Number(longitude).toFixed(5)}</div>
      <div>Timestamp: ${normalized.time?.timestamp || "Not supplied"}</div>
      <hr>
      <div>Temperature: ${e.air_temperature_c ?? "Not supplied"} °C</div>
      <div>Relative Humidity: ${e.relative_humidity_pct ?? "Not supplied"} %</div>
      <div>Dew Point: ${e.dew_point_c ?? "Not supplied"} °C</div>
      <div>Wind Speed: ${e.wind_speed_ms ?? "Not supplied"} m/s</div>
      <div>Shortwave Solar Radiation: ${e.solar_radiation_wm2 ?? "Not supplied"} W/m²</div>
      <div>Status: ${normalized.quality?.quality_flag || "unknown"}</div>
      <small>Source: Open-Meteo • values preserved without source substitution</small>
    `;
    return { source: "Open-Meteo", status: "success" };
  } catch (error) {
    card.innerHTML = `<strong>Open-Meteo</strong><div>Status: unavailable</div><small>${String(error.message || error)}</small>`;
    return { source: "Open-Meteo", status: "error" };
  }
}

async function loadWeather() {
  const requestLocation = selectedLocationForRequest();

  if (!requestLocation) {
    $("status").textContent = "Please select your location first.";
    $("nasaResearchStatus").textContent =
      "NASA POWER is waiting for a selected location.";
    $("ecmwfStatus").textContent =
      "ECMWF Open Data is waiting for a selected location.";
    return;
  }

  const loadSequence = ++weatherLoadSequence;
  const { name, latitude, longitude } = requestLocation;
  loadOpenMeteo(latitude, longitude, loadSequence);
  const locationLabel = `${latitude}, ${longitude}`;
  $("status").textContent =
    `Loading BOTH NASA POWER and ECMWF Open Data for ${name} ` +
    `(${locationLabel})…`;
  $("nasaResearchStatus").textContent =
    `Loading NASA POWER research data for ${name} (${locationLabel})…`;
  $("ecmwfStatus").textContent =
    `Loading ECMWF Open Data research data for ${name} (${locationLabel})…`;
  $("nasaResearchSummary").hidden = true;
  $("nasaResearchRawDetails").hidden = true;
  $("nasaResearchParameters").replaceChildren();
  $("ecmwfSummary").hidden = true;
  $("ecmwfRawDetails").hidden = true;
  $("ecmwfParameters").replaceChildren();
  thermalShieldFusionSources.clear();
  updateThermalShieldFusion();

  const nasaPromise = loadNASA(latitude, longitude, loadSequence);
  const openMeteoPromise = loadOpenMeteo(latitude, longitude, loadSequence);
  const gfsResults = await Promise.all(forecastSteps.map(step => loadGFS(latitude, longitude, loadSequence, step)));
  const ecmwfResults = await Promise.all(forecastSteps.map((step, index) => loadECMWF(latitude, longitude, loadSequence, step, gfsResults[index]?.valid_time || null)));
  const results = [await nasaPromise, ecmwfResults, gfsResults, await openMeteoPromise];

  if (loadSequence !== weatherLoadSequence) return;

  const nasaResult = results[0];
  const ecmwfResult = results[1];
  const nasaStatus = nasaResult.status === "success"
    ? "NASA POWER succeeded"
    : "NASA POWER failed";
  const ecmwfSuccess = Array.isArray(ecmwfResult) && ecmwfResult.length > 0 && ecmwfResult.every(item => item?.status === "success");
  const ecmwfStatus = ecmwfSuccess
    ? "ECMWF Open Data succeeded"
    : "ECMWF Open Data failed";
  const settledState =
    nasaResult.status === "success" && ecmwfSuccess
      ? "Loading complete"
      : "Loading complete with errors";

  $("status").textContent =
    `${settledState} for ${name} (${locationLabel}): ` +
    `${nasaStatus}; ${ecmwfStatus}.`;
  if (nasaResult.status === "success" && ecmwfSuccess) {
    calculate();
  }
}

function displayValue(value) {
  if (value === null || value === undefined) {
    return "Missing (not supplied)";
  }

  return String(value);
}

function addNASAField(container, label, value) {
  const field = document.createElement("div");
  const heading = document.createElement("b");
  const content = document.createElement("span");
  heading.textContent = label;
  content.textContent = displayValue(value);
  field.append(heading, content);
  container.appendChild(field);
}

function nasaCoordinateValue(coordinates) {
  if (!Array.isArray(coordinates)) return null;
  return coordinates
    .slice(0, 3)
    .map(value => displayValue(value))
    .join(", ");
}

function renderNASAResearch(data, normalized, requestedLocation) {
  const properties = data?.properties || {};
  const environment = properties.environment || {};
  const provenance = normalized?.provenance || {};
  const quality = normalized?.quality || {};
  const summary = $("nasaResearchSummary");
  const parametersBox = $("nasaResearchParameters");
  const lineages = Array.isArray(provenance.variables)
    ? provenance.variables
    : [];
  const nativeValues = {
    T2M: environment.air_temperature_c,
    RH2M: environment.relative_humidity_pct,
    WS10M: environment.wind_speed_ms,
    T2MWET: environment.nasa_wet_bulb_related_c,
    T2MDEW: environment.dew_point_c,
    ALLSKY_SFC_SW_DWN: environment.solar_radiation_wm2
  };

  summary.replaceChildren();
  parametersBox.replaceChildren();

  addNASAField(summary, "Source", properties.source);
  addNASAField(summary, "Source ID", properties.source_id);
  addNASAField(summary, "Selected location", requestedLocation?.name);
  addNASAField(
    summary,
    "Requested coordinates",
    requestedLocation
      ? `${displayValue(requestedLocation.latitude)}, ${displayValue(requestedLocation.longitude)}`
      : null
  );
  addNASAField(summary, "Observation timestamp (UTC)", properties.observation_timestamp_utc);
  addNASAField(summary, "Normalized timestamp (UTC)", normalized?.time?.timestamp);
  addNASAField(
    summary,
    "Response coordinates",
    nasaCoordinateValue(data?.geometry?.coordinates)
  );
  addNASAField(summary, "Data type", properties.data_type);
  addNASAField(summary, "Quality", quality.quality_flag);
  addNASAField(summary, "Retrieved (UTC)", properties.retrieved_at);
  addNASAField(
    summary,
    "Available parameters",
    Object.entries(environment)
      .filter(([, value]) => value !== null && value !== undefined)
      .map(([name]) => name)
      .join(", ")
  );
  addNASAField(summary, "Missing fields", quality.missing_fields?.join(", "));
  addNASAField(summary, "Provider provenance", provenance.source_name);
  addNASAField(summary, "Variable provenance", properties.provenance?.variables);

  lineages.forEach(lineage => {
    const card = document.createElement("article");
    card.className = "nasa-parameter";
    const title = document.createElement("h3");
    title.textContent = lineage.source_variable || lineage.canonical_variable;
    card.appendChild(title);
    addNASAField(
      card,
      "Native value",
      nativeValues[lineage.source_variable] ?? lineage.native_value
    );
    addNASAField(card, "Native units", lineage.native_unit);
    addNASAField(card, "Normalized value", lineage.normalized_value);
    addNASAField(card, "Normalized units", lineage.normalized_unit);
    addNASAField(card, "Timestamp (UTC)", lineage.source_timestamp);
    addNASAField(card, "Status", lineage.status);
    addNASAField(card, "Transformation", lineage.transformation);
    addNASAField(card, "Raw record reference", lineage.raw_record_ref);
    parametersBox.appendChild(card);
  });

  $("nasaResearchRaw").textContent = JSON.stringify(data, null, 2);
  summary.hidden = false;
  $("nasaResearchRawDetails").hidden = false;
}

function addECMWFField(container, label, value) {
  const field = document.createElement("div");
  const heading = document.createElement("b");
  const content = document.createElement("span");

  heading.textContent = label;
  content.textContent = displayValue(value);
  field.append(heading, content);
  container.appendChild(field);
}

function renderECMWF(data, requestedLocation) {
  const properties = data.properties || {};
  const provenance = data.provenance || {};
  const quality = data.quality || {};
  const summary = $("ecmwfSummary");
  const parametersBox = $("ecmwfParameters");

  summary.replaceChildren();
  parametersBox.replaceChildren();

  addECMWFField(summary, "Source", properties.source);
  addECMWFField(summary, "Selected location", requestedLocation?.name);
  addECMWFField(summary, "Model", properties.model);
  addECMWFField(summary, "Resolution", properties.resolution);
  addECMWFField(summary, "Status", properties.status);
  addECMWFField(
    summary,
    "Requested coordinate",
    requestedLocation
      ? `${displayValue(requestedLocation.latitude)}, ${displayValue(requestedLocation.longitude)}`
      : null
  );
  addECMWFField(
    summary,
    "Forecast initialization (UTC)",
    properties.forecast_initialization_time_utc
  );
  addECMWFField(
    summary,
    "Forecast valid time (UTC)",
    properties.forecast_valid_time_utc
  );
  addECMWFField(
    summary,
    "Requested forecast step",
    properties.forecast_step_requested
  );
  addECMWFField(summary, "Retrieved (UTC)", provenance.retrieved_at);
  addECMWFField(summary, "Quality", quality.quality_flag);

  const parameters = properties.parameters;
  if (!parameters || typeof parameters !== "object") {
    parametersBox.textContent = "No ECMWF parameter values were supplied.";
  } else {
    Object.entries(parameters).forEach(([name, parameter]) => {
      const card = document.createElement("article");
      card.className = "ecmwf-parameter";
      const title = document.createElement("h3");
      title.textContent = name;
      card.appendChild(title);

      if (!parameter || typeof parameter !== "object") {
        addECMWFField(card, "Raw value", parameter);
      } else {
        addECMWFField(card, "Raw value", parameter.raw_value);
        addECMWFField(card, "Native units", parameter.raw_units);
        addECMWFField(
          card,
          "Forecast initialization (UTC)",
          parameter.forecast_initialization_time_utc
        );
        addECMWFField(card, "Valid time (UTC)", parameter.valid_time_utc);
        addECMWFField(card, "Forecast step", parameter.forecast_step);
        addECMWFField(card, "GRIB step range", parameter.step_range);

        const gridPoint = parameter.nearest_grid_point;
        addECMWFField(
          card,
          "Nearest grid point",
          gridPoint
            ? `${displayValue(gridPoint.latitude)}, ${displayValue(gridPoint.longitude)}`
            : null
        );
        addECMWFField(
          card,
          "Nearest grid flat index",
          gridPoint?.flat_index
        );
      }

      parametersBox.appendChild(card);
    });
  }

  $("ecmwfRaw").textContent = JSON.stringify(data, null, 2);
  $("ecmwfSummary").hidden = false;
  $("ecmwfRawDetails").hidden = false;
}

const forecastSteps = [3, 6, 9, 12, 15, 18, 21, 24];

async function loadGFS(latitude, longitude, loadSequence, forecastStep = 3) {
  try {
    const response = await fetch(`https://thermal-shield-360.vercel.app/api/noaa-gfs?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}&forecast_step=${encodeURIComponent(forecastStep)}`);
    const data = await response.json();
    if (!response.ok || data?.status === "error") throw new Error(data?.error || "NOAA GFS request failed");
    if (loadSequence !== weatherLoadSequence) return { source: "NOAA GFS", status: "stale" };
    const normalized = window.normalizeGFSPayload({ type: "Feature", geometry: { type: "Point", coordinates: [Number(longitude), Number(latitude)] }, properties: data });
    const gfsStatus = $("gfsStatus");
    const gfsSummary = $("gfsSummary");
    const gfsRawDetails = $("gfsRawDetails");
    const gfsRaw = $("gfsRaw");
    if (gfsStatus) gfsStatus.textContent = `NOAA GFS loaded for ${latitude}, ${longitude}.`;
    if (gfsSummary) {
      gfsSummary.hidden = false;
      const view = normalized.properties || normalized;
            const env = view.environment || {};
            const location = view.location || {};
            const grid = location.source_grid || {};
            const requested = location.requested_coordinate || {};
            const gfsVariables = Array.isArray(view.provenance?.variables) ? view.provenance.variables : [];
            const windULineage = gfsVariables.find(v => v?.canonical_variable === "wind_u");
            const windVLineage = gfsVariables.find(v => v?.canonical_variable === "wind_v");
            const time = view.time || {};
            const prov = view.provenance || {};
            const quality = view.quality || {};
            const show = v => v === null || v === undefined || v === "" ? "Not supplied" : String(v);
            gfsSummary.innerHTML = `
                <div class="data-grid">
                    <div><strong>Source</strong><span>NOAA GFS / NCEP</span></div>
                    <div><strong>Model</strong><span>GFS</span></div>
                    <div><strong>Resolution</strong><span>0.25°</span></div>
                    <div><strong>Requested Location</strong><span>${show(requested.latitude)}, ${show(requested.longitude)}</span></div>
                    <div><strong>Nearest GFS Grid</strong><span>${show(grid.latitude)}, ${show(grid.longitude)}</span></div>
                    <div><strong>Forecast Initialization</strong><span>${show(time.forecast_initialization_time)}</span></div>
                    <div><strong>Forecast Valid Time</strong><span>${show(time.forecast_valid_time)}</span></div>
                    <div><strong>Forecast Step</strong><span>${show(time.forecast_step ?? time.forecast_lead_hours)} hours</span></div>
                    <div><strong>Air Temperature</strong><span>${show(env.air_temperature_c)} °C</span></div>
                    <div><strong>Dew Point</strong><span>${show(env.dew_point_c)} °C</span></div>
                    <div><strong>Wind U</strong><span>${show(windULineage?.normalized_value ?? windULineage?.native_value)} m/s</span></div>
                    <div><strong>Wind V</strong><span>${show(windVLineage?.normalized_value ?? windVLineage?.native_value)} m/s</span></div>
                    <div><strong>Wind Speed</strong><span>${show(env.wind_speed_ms)} m/s</span></div>
                    <div><strong>Relative Humidity</strong><span>${show(env.relative_humidity_pct)} %</span></div>
                    <div><strong>Solar Radiation</strong><span>${show(env.solar_radiation_wm2)} W/m²</span></div>
                    <div><strong>Quality</strong><span>${show(quality.quality_flag || quality.status)}</span></div>
                    <div><strong>Retrieved At</strong><span>${show(prov.retrieved_at)}</span></div>
                </div>`;

    }
    if (gfsRawDetails) gfsRawDetails.hidden = false;
    if (gfsRaw) gfsRaw.textContent = JSON.stringify(data, null, 2);
    registerThermalShieldFusionSource(normalized);
    return { source: "NOAA GFS", status: "success", valid_time: time.forecast_valid_time };
  } catch (error) {
    if (loadSequence !== weatherLoadSequence) return { source: "NOAA GFS", status: "stale" };
    const status = $("gfsStatus"); if (status) status.textContent = `NOAA GFS failed: ${error.message}`; return { source: "NOAA GFS", status: "failed", error: error.message };
  }
}

async function loadECMWF(latitude, longitude, loadSequence, forecastStep = 3, targetValidTime = null) {
  const status = $("ecmwfStatus");

  try {
    const ecmwfUrl =
      "https://thermal-shield-360.vercel.app/api/ecmwf" +
      `?latitude=${encodeURIComponent(latitude)}` +
      `&longitude=${encodeURIComponent(longitude)}` + `&forecast_step=${encodeURIComponent(forecastStep)}` + (targetValidTime ? `&target_valid_time=${encodeURIComponent(targetValidTime)}` : "");
    const response = await fetch(ecmwfUrl);

    if (!response.ok) {
      throw new Error(`ECMWF HTTP ${response.status}`);
    }

    const data = await response.json();
    if (loadSequence !== weatherLoadSequence) {
      return {
        source: "ECMWF Open Data",
        status: "stale"
      };
    }
    const properties = data?.properties;

    if (
      !data ||
      data.type !== "Feature" ||
      !properties ||
      properties.status !== "raw/not normalized" ||
      data.quality?.status !== "raw/not normalized"
    ) {
      throw new Error(
        "ECMWF returned a payload that is not marked raw/not normalized."
      );
    }
    const requestedCoordinate = properties.requested_coordinate;
    if (
      !requestedCoordinate ||
      requestedCoordinate.latitude !== latitude ||
      requestedCoordinate.longitude !== longitude
    ) {
      throw new Error(
        "ECMWF returned data for coordinates other than the selected location."
      );
    }

    renderECMWF(data, {
      name: selectedLocation?.name,
      latitude,
      longitude
    });
    registerThermalShieldFusionSource(
      window.normalizeECMWFPayload(data)
    );
    status.textContent =
      `ECMWF Open Data loaded for ${latitude}, ${longitude}. ` +
      "Values remain raw and separate from HTSI.";
    return {
      source: "ECMWF Open Data",
      status: "success"
    };
  } catch (error) {
    if (loadSequence !== weatherLoadSequence) {
      return {
        source: "ECMWF Open Data",
        status: "stale"
      };
    }
    status.textContent =
      `ECMWF research-data load failed: ${error.message}`;
    return {
      source: "ECMWF Open Data",
      status: "failure",
      error
    };
  }
}
  

function calculate() {

  const fusedInputs = fusedHTSIInputs(thermalShieldFusionResult);
  const hasFusionResult = Boolean(
    thermalShieldFusionResult &&
    Array.isArray(thermalShieldFusionResult.results)
  );
  const args = {
    T: hasFusionResult
      ? fusedInputs.T
      : parseFloat($("temp").value),
    RH: hasFusionResult
      ? fusedInputs.RH
      : parseFloat($("rh").value),
    wind: hasFusionResult
      ? fusedInputs.wind
      : parseFloat($("wind").value),
    rad: hasFusionResult
      ? fusedInputs.rad
      : parseFloat($("rad").value),
    utci: parseFloat($("utci").value),
    persistence:
      parseFloat($("persistence").value) || 0,
    downside:
      parseFloat($("downside").value) || 0
  };

  if (hasFusionResult) {
    $("temp").value = Number.isFinite(args.T) ? args.T : "";
    $("rh").value = Number.isFinite(args.RH) ? args.RH : "";
    $("wind").value = Number.isFinite(args.wind) ? args.wind : "";
    $("rad").value = Number.isFinite(args.rad) ? args.rad : "";
  }

  if (
  ![
    args.T,
    args.RH,
    args.wind
  ].every(Number.isFinite)
) {
  $("risk").textContent =
    "Temperature, humidity, or wind data unavailable";
  return;
}
  /*
   * Use the dedicated Heat Index engine.
   */
  const heatIndexResult =
    window.ThermalShieldHeatIndex.calculateHeatIndex(
      args.T,
      args.RH
    );

  if (
    !heatIndexResult ||
    !Number.isFinite(heatIndexResult.value_c)
  ) {
    $("risk").textContent =
      "Heat Index unavailable";
    return;
  }

  const hi = heatIndexResult.value_c;

  /*
   * Keep the existing WBGT proxy visible for transparency.
   *
   * IMPORTANT:
   * This proxy is NOT passed to the HTSI engine as official WBGT.
   */
  const wbgtProxyValue =
  Number.isFinite(args.rad)
    ? wbgtProxy(
        args.T,
        args.RH,
        args.wind,
        args.rad
      )
    : null;

  /*
   * Radiation + low-wind stress modifier.
   *
   * This remains a transparent prototype modifier.
   */
  const radStress =
  Number.isFinite(args.rad)
    ? clamp(args.rad / 800, 0, 1) * 0.65 +
      (1 - clamp(args.wind / 4, 0, 1)) * 0.35
    : null;

  /*
   * STEP 9.6:
   * HTSI is now calculated by the dedicated
   * engine/htsi.js module.
   *
   * WBGT is deliberately null because the dashboard
   * currently has only a proxy, not validated globe
   * and natural-wet-bulb measurements.
   */
  const htsiResult =
    window.ThermalShieldHTSI.calculateHTSI({
      utci: args.utci,
      wbgt: null,
      heatIndex: hi,
      persistence: args.persistence,
      radiationLowWind: radStress,
      forecastDownside: args.downside
    });

  if (
    !htsiResult ||
    !Number.isFinite(htsiResult.value)
  ) {
    $("risk").textContent =
      "HTSI unavailable";
    return;
  }

  const score =
    Math.round(htsiResult.value);

  $("score").textContent = score;

  $("risk").textContent =
    score < 25
      ? "Low thermal-stress signal"
      : score < 50
        ? "Moderate thermal-stress signal"
        : score < 75
          ? "High thermal-stress signal"
          : "Very high thermal-stress signal";

  $("explain").textContent =
    `HTSI engine: ${htsiResult.method_version}. ` +
    `Coverage: ${Math.round(htsiResult.coverage * 100)}%. ` +
    `Prototype calibration required.`;

  $("hi").textContent =
    `${hi.toFixed(1)} °C`;

  $("wbgt").textContent =
  Number.isFinite(wbgtProxyValue)
    ? `${wbgtProxyValue.toFixed(1)} °C (proxy)`
    : "Unavailable — no valid solar-radiation observation";

  $("utciOut").textContent =
    Number.isFinite(args.utci)
      ? `${args.utci.toFixed(1)} °C`
      : "not supplied";

  $("persistOut").textContent =
    args.persistence.toFixed(2);

  $("radOut").textContent =
  Number.isFinite(radStress)
    ? radStress.toFixed(2)
    : "Unavailable";

  $("downOut").textContent =
    args.downside.toFixed(2);

  $("formula").textContent =
    `HTSI engine: ${htsiResult.method_version}

Available components:
${htsiResult.available_components.join(", ")}

Missing components:
${htsiResult.missing_components.length
  ? htsiResult.missing_components.join(", ")
  : "none"}

Coverage:
${Math.round(htsiResult.coverage * 100)}%

Weights actually used:
${JSON.stringify(
  htsiResult.weights_used,
  null,
  2
)}

Important:
WBGT proxy is displayed separately and is NOT
used as official WBGT in HTSI until required
measurements/methodology are validated.

Calibration status:
${htsiResult.calibration_status}

Medical status:
${htsiResult.medical_status}`;

  
      $("sourceLog").textContent =
    `Weather: NASA POWER live selected-location observation
(T2M, RH2M, WS10M, T2MWET, T2MDEW, ALLSKY_SFC_SW_DWN).

Heat Index: Thermal Shield 360 Heat Index engine
using NOAA/NWS-style Rothfusz methodology.

WBGT: transparent prototype proxy only.
Not passed to HTSI as validated WBGT.

UTCI: supplied only when valid UTCI input
is available.

HTSI: engine/htsi.js
Method: ${htsiResult.method_version}

Available:
${htsiResult.available_components.join(", ")}

Missing:
${htsiResult.missing_components.length
  ? htsiResult.missing_components.join(", ")
  : "none"}

ENSO: data/enso.json based on NOAA CPC
contextual evidence.

HTSI calibration:
prototype calibration required.`;
}

async function loadENSO() {

  try {

    const r =
      await fetch("data/enso.json");

    const d =
      await r.json();

    $("ensoBox").innerHTML =
      `<b>${d.source}</b><br>` +
      `${d.date} — ${d.status}<br>` +
      `Niño-3.4 anomaly: ${d.nino34_anomaly_c} °C<br>` +
      `Very-strong event probability: ` +
      `${d.very_strong_event_probability_text}<br>` +
      `<small>${d.note}</small>`;

  } catch (e) {

    $("ensoBox").textContent =
      "ENSO evidence file could not be loaded.";

  }
}

function useMyLocation() {
  const status = $("locationStatus");

  if (!navigator.geolocation) {
    status.textContent =
      "Location services are not supported by this browser.";
    return;
  }

  status.textContent =
    "⏳ Detecting your current location...";

  navigator.geolocation.getCurrentPosition(
    async function (position) {
      const latitude =
        Number(position.coords.latitude.toFixed(6));

      const longitude =
        Number(position.coords.longitude.toFixed(6));
      const locationSelection = {
        name: "Detected location",
        latitude,
        longitude
      };

      setSelectedLocation(locationSelection);

      try {
  const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`;
  const response = await fetch(nominatimUrl);

  if (!response.ok) {
    throw new Error("Reverse geocoding failed.");
  }

  const place = await response.json();

  const address = place.address || {};

  const locationName =
    address.city ||
    address.town ||
    address.village ||
    address.municipality ||
    address.county ||
    "Detected location";

  const state =
    address.state || "";

  const country =
    address.country || "";

  const readableLocation =
    [locationName, state, country]
      .filter(Boolean)
      .join(", ");

  locationSelection.name = readableLocation;
  if (
    selectedLocation?.latitude === latitude &&
    selectedLocation?.longitude === longitude
  ) {
    setSelectedLocation(locationSelection);
  }

} catch (error) {

  if (
    selectedLocation?.latitude === latitude &&
    selectedLocation?.longitude === longitude
  ) {
    $("selectedLocation").textContent =
  "📍 Location detected";
  }

}

      status.textContent =
        "✓ Location detected successfully.";

      $("status").textContent =
        "Your device location has been detected. Ready to load environmental data.";
    },

    function (error) {
      if (error.code === 1) {
        status.textContent =
          "Location permission denied. Please allow location access in Chrome.";
      } else if (error.code === 2) {
        status.textContent =
          "Location unavailable. Please turn on device Location.";
      } else if (error.code === 3) {
        status.textContent =
          "Location request timed out. Please try again.";
      } else {
        status.textContent =
          "Unable to detect your location.";
      }
    },

    {
  enableHighAccuracy: false,
  timeout: 30000,
  maximumAge: 600000
    }
  );
}

async function searchLocation() {
  const query = $("locationSearch").value.trim();
  const resultsBox = $("locationResults");

  if (!query) {
    resultsBox.textContent =
      "Please enter a city, area or place.";
    return;
  }

  resultsBox.textContent =
    "⏳ Searching for locations...";

  try {
    const nominatimUrl =
      "https://nominatim.openstreetmap.org/search" +
      `?q=${encodeURIComponent(query)}` +
      "&format=jsonv2" +
      "&addressdetails=1" +
      "&limit=5";

    const response = await fetch(nominatimUrl);

    if (!response.ok) {
      throw new Error(
        `Location search HTTP ${response.status}`
      );
    }

    const results = await response.json();

    if (!Array.isArray(results) || results.length === 0) {
      resultsBox.textContent =
        "No matching locations found.";
      return;
    }

    resultsBox.innerHTML = "";

    results.forEach((place) => {
      const button = document.createElement("button");

      button.type = "button";
      button.textContent = place.display_name;

      button.addEventListener("click", () => {
        const latitude = Number(place.lat);
        const longitude = Number(place.lon);

        if (
          !Number.isFinite(latitude) ||
          !Number.isFinite(longitude)
        ) {
          resultsBox.textContent =
            "Selected location has invalid coordinates.";
          return;
        }

        setSelectedLocation({
          name: place.display_name,
          latitude,
          longitude
        });

        resultsBox.textContent =
          "✓ Location selected successfully.";

        $("status").textContent =
          "Selected location. Ready to load environmental data.";
      });

      resultsBox.appendChild(button);
    });

  } catch (error) {
    resultsBox.textContent =
      `Location search failed: ${error.message}`;
  }
}
$("locationBtn").addEventListener(
  "click",
  useMyLocation
);
$("searchLocationBtn").addEventListener(
  "click",
  searchLocation
);
$("loadBtn").addEventListener(
  "click",
  loadWeather
);

$("calcBtn").addEventListener(
  "click",
  calculate
);

loadENSO();
