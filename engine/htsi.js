/**
 * Thermal Shield 360
 * Human Thermal Stress Index (HTSI) Core
 *
 * HTSI combines validated thermal indicators with
 * persistence, radiation/low-wind stress and forecast downside.
 *
 * IMPORTANT:
 * - Missing thermal indices are NOT treated as zero.
 * - Available component weights are renormalized.
 * - Screening normalization ranges are configurable
 *   and require calibration against Indian historical data.
 * - HTSI is NOT a medical diagnosis or official warning.
 */

const DEFAULT_WEIGHTS = {
  utci: 0.30,
  wbgt: 0.25,
  heat_index: 0.15,
  persistence: 0.10,
  radiation_low_wind: 0.10,
  forecast_downside: 0.10
};

/*
 * Prototype screening normalization.
 * These are calibration placeholders, NOT official thresholds.
 */
const DEFAULT_RANGES = {
  utci: { min: 20, max: 45 },
  wbgt: { min: 15, max: 35 },
  heat_index: { min: 20, max: 50 },
  persistence: { min: 0, max: 1 },
  radiation_low_wind: { min: 0, max: 1 },
  forecast_downside: { min: 0, max: 1 }
};

function clamp(value, min = 0, max = 1) {
  return Math.min(Math.max(value, min), max);
}

function normalize(value, range) {
  if (!Number.isFinite(value)) return null;

  if (!range || !Number.isFinite(range.min) || !Number.isFinite(range.max)) {
    return null;
  }

  if (range.max <= range.min) return null;

  return clamp(
    (value - range.min) / (range.max - range.min)
  );
}

function calculateHTSI(
  {
    utci,
    wbgt,
    heatIndex,
    persistence,
    radiationLowWind,
    forecastDownside
  },
  options = {}
) {
  const weights = {
    ...DEFAULT_WEIGHTS,
    ...(options.weights || {})
  };

  const ranges = {
    ...DEFAULT_RANGES,
    ...(options.ranges || {})
  };

  const components = [
    {
      name: "utci",
      value: utci,
      weight: weights.utci
    },
    {
      name: "wbgt",
      value: wbgt,
      weight: weights.wbgt
    },
    {
      name: "heat_index",
      value: heatIndex,
      weight: weights.heat_index
    },
    {
      name: "persistence",
      value: persistence,
      weight: weights.persistence
    },
    {
      name: "radiation_low_wind",
      value: radiationLowWind,
      weight: weights.radiation_low_wind
    },
    {
      name: "forecast_downside",
      value: forecastDownside,
      weight: weights.forecast_downside
    }
  ];

  const available = [];
  const missing = [];

  for (const component of components) {
    const normalized = normalize(
      component.value,
      ranges[component.name]
    );

    if (normalized === null) {
      missing.push(component.name);
      continue;
    }

    available.push({
      ...component,
      normalized
    });
  }

  if (available.length === 0) {
    return {
      value: null,
      status: "unavailable",
      coverage: 0,
      available_components: [],
      missing_components: missing,
      message: "No valid HTSI components are available."
    };
  }

  const availableWeight = available.reduce(
    (sum, component) => sum + component.weight,
    0
  );

  if (availableWeight <= 0) {
    return {
      value: null,
      status: "invalid",
      coverage: 0,
      available_components: [],
      missing_components: missing,
      message: "Available component weights are invalid."
    };
  }

  let weightedScore = 0;

  for (const component of available) {
    weightedScore +=
      component.normalized *
      (component.weight / availableWeight);
  }

  const htsi = Number((weightedScore * 100).toFixed(1));

  const coverage = Number(
    (availableWeight /
      Object.values(weights).reduce(
        (sum, weight) => sum + weight,
        0
      )).toFixed(2)
  );

  let status = "low";
  if (htsi >= 75) {
    status = "very_high";
  } else if (htsi >= 60) {
    status = "high";
  } else if (htsi >= 40) {
    status = "moderate";
  }

  return {
    value: htsi,
    status,
    coverage,
    available_components: available.map(
      (component) => component.name
    ),
    missing_components: missing,
    weights_used: Object.fromEntries(
      available.map((component) => [
        component.name,
        Number(
          (component.weight / availableWeight).toFixed(4)
        )
      ])
    ),
    method_version: "HTSI-v0.1",
    calibration_status: "prototype_calibration_required",
    medical_status: "not_a_medical_diagnosis"
  };
}

if (typeof window !== "undefined") {
  window.ThermalShieldHTSI = {
    calculateHTSI
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    calculateHTSI
  };
    }
