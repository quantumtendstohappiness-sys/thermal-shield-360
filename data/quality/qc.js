/**
 * Thermal Shield 360
 * Data Quality Control Engine
 *
 * Validates normalized thermal observations before
 * they enter the thermal-index and HTSI pipeline.
 */

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidISODate(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return false;
  }

  return !Number.isNaN(Date.parse(value));
}

function checkRange(value, minimum, maximum) {
  if (value === null || value === undefined) {
    return {
      status: "missing",
      message: "Value not provided"
    };
  }

  if (!isNumber(value)) {
    return {
      status: "poor",
      message: "Value must be numeric"
    };
  }

  if (value < minimum || value > maximum) {
    return {
      status: "poor",
      message: `Value outside allowed range ${minimum} to ${maximum}`
    };
  }

  return {
    status: "good",
    message: "Value passed range validation"
  };
}

function validateThermalObservation(record) {
  const results = {};
  const environment = record?.environment || {};
  const location = record?.location || {};
  const time = record?.time || {};
  const provenance = record?.provenance || {};

  // Temperature
  results.air_temperature_c = checkRange(
    environment.air_temperature_c,
    -80,
    60
  );

  // Relative humidity
  results.relative_humidity_pct = checkRange(
    environment.relative_humidity_pct,
    0,
    100
  );

  // Wind speed
  results.wind_speed_ms = checkRange(
    environment.wind_speed_ms,
    0,
    Infinity
  );

  // Solar radiation
  results.solar_radiation_wm2 = checkRange(
    environment.solar_radiation_wm2,
    0,
    Infinity
  );

  // Latitude
  results.latitude = checkRange(
    location.latitude,
    -90,
    90
  );

  // Longitude
  results.longitude = checkRange(
    location.longitude,
    -180,
    180
  );

  // Timestamp
  if (isValidISODate(time.timestamp)) {
    results.timestamp = {
      status: "good",
      message: "Valid ISO-8601 timestamp"
    };
  } else {
    results.timestamp = {
      status: "poor",
      message: "Invalid or missing timestamp"
    };
  }

  // Source ID
  results.source_id = {
    status:
      typeof provenance.source_id === "string" &&
      provenance.source_id.trim() !== ""
        ? "good"
        : "missing",
    message:
      typeof provenance.source_id === "string" &&
      provenance.source_id.trim() !== ""
        ? "Source ID present"
        : "Source ID missing"
  };

  // Source name
  results.source_name = {
    status:
      typeof provenance.source_name === "string" &&
      provenance.source_name.trim() !== ""
        ? "good"
        : "missing",
    message:
      typeof provenance.source_name === "string" &&
      provenance.source_name.trim() !== ""
        ? "Source name present"
        : "Source name missing"
  };

  // Retrieval timestamp
  if (isValidISODate(provenance.retrieved_at)) {
    results.retrieved_at = {
      status: "good",
      message: "Valid retrieval timestamp"
    };
  } else {
    results.retrieved_at = {
      status: "missing",
      message: "Retrieval timestamp missing or invalid"
    };
  }

  const statuses = Object.values(results).map(
    (result) => result.status
  );

  let overallStatus = "good";

  if (statuses.includes("poor")) {
    overallStatus = "poor";
  } else if (statuses.includes("missing")) {
    overallStatus = "acceptable";
  }

  return {
    overall_status: overallStatus,
    checks: results,
    checked_at: new Date().toISOString()
  };
}


// Browser/global access
if (typeof window !== "undefined") {
  window.ThermalShieldQC = {
    validateThermalObservation
  };
}


// Node/module access
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    validateThermalObservation
  };
}
