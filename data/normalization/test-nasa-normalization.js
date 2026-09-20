"use strict";

const assert = require("node:assert/strict");
const { normalizeNASARecord } = require("./nasa");

function makeValidRecord(overrides = {}) {
  const base = {
    location: {
      name: "NASA POWER point",
      latitude: 35.3,
      longitude: -120.7
    },
    time: {
      timestamp: "2024-06-01T12:00:00Z",
      timezone: "UTC",
      forecast_lead_hours: null,
      forecast_initialization_time: null,
      forecast_valid_time: null,
      forecast_step: null,
      step_range: null
    },
    environment: {
      air_temperature_c: 27.4,
      relative_humidity_pct: 48,
      wind_speed_ms: 4.2,
      solar_radiation_wm2: 610,
      nasa_wet_bulb_related_c: 21.8,
      dew_point_c: 16.3
    },
    provenance: {
      source_id: "nasa_power",
      source_name: "NASA Prediction Of Worldwide Energy Resources (POWER)",
      data_type: "reanalysis",
      variable: "T2M,RH2M,WS10M,T2MWET,T2MDEW,ALLSKY_SFC_SW_DWN",
      units: "degC, %, m/s, degC, degC, W/m2",
      retrieved_at: "2024-06-01T12:05:00Z",
      data_status: "reference"
    },
    quality: {
      quality_flag: "acceptable",
      missing_fields: [],
      notes: "NASA POWER record."
    }
  };

  return {
    ...base,
    ...overrides,
    location: {
      ...base.location,
      ...(overrides.location || {})
    },
    time: {
      ...base.time,
      ...(overrides.time || {})
    },
    environment: {
      ...base.environment,
      ...(overrides.environment || {})
    },
    provenance: {
      ...base.provenance,
      ...(overrides.provenance || {})
    },
    quality: {
      ...base.quality,
      ...(overrides.quality || {})
    }
  };
}

function testMapping() {
  const raw = makeValidRecord();
  const normalized = normalizeNASARecord(raw);

  assert.equal(
    normalized.environment.air_temperature_c,
    raw.environment.air_temperature_c
  );
  assert.equal(
    normalized.environment.relative_humidity_pct,
    raw.environment.relative_humidity_pct
  );
  assert.equal(
    normalized.environment.wind_speed_ms,
    raw.environment.wind_speed_ms
  );
  assert.equal(
    normalized.environment.solar_radiation_wm2,
    raw.environment.solar_radiation_wm2
  );

  assert.equal(normalized.location.name, raw.location.name);
  assert.equal(normalized.time.timestamp, raw.time.timestamp);
  assert.equal(normalized.provenance.source_id, "nasa_power");
  assert.equal(normalized.provenance.data_type, "reanalysis");
  assert.equal(normalized.provenance.retrieved_at, raw.provenance.retrieved_at);

  const solarEntry = normalized.provenance.variables.find(
    (entry) => entry.canonical_variable === "solar_radiation_wm2"
  );
  assert.ok(solarEntry);
  assert.equal(solarEntry.source_variable, "ALLSKY_SFC_SW_DWN");
  assert.equal(solarEntry.native_value, raw.environment.solar_radiation_wm2);
  assert.equal(solarEntry.normalized_unit, "W/m2");

  const wetBulbContext = normalized.provenance.variables.find(
    (entry) => entry.canonical_variable === "nasa_wet_bulb_related_c"
  );
  assert.ok(wetBulbContext);
  assert.equal(wetBulbContext.source_variable, "T2MWET");
  assert.equal(wetBulbContext.native_value, raw.environment.nasa_wet_bulb_related_c);
  assert.match(
    wetBulbContext.transformation,
    /not treated as a measured natural wet-bulb temperature/
  );
  assert.equal(normalized.environment.nasa_wet_bulb_related_c, undefined);
  assert.equal(normalized.environment.natural_wet_bulb_c, undefined);
}

function testMissingSolarHandling() {
  const raw = makeValidRecord({
    environment: {
      ...makeValidRecord().environment,
      solar_radiation_wm2: null
    },
    quality: {
      quality_flag: "acceptable",
      missing_fields: ["environment.solar_radiation_wm2"],
      notes: "Solar missing in NASA POWER record."
    }
  });

  const normalized = normalizeNASARecord(raw);

  assert.equal(normalized.environment.solar_radiation_wm2, null);
  assert.deepEqual(normalized.quality.missing_fields, [
    "environment.solar_radiation_wm2"
  ]);
  assert.equal(
    normalized.provenance.variables.find(
      (entry) => entry.canonical_variable === "solar_radiation_wm2"
    ).status,
    "missing"
  );
}

function testProvenancePreservation() {
  const raw = makeValidRecord({
    time: {
      timestamp: "2024-06-01T12:00:00Z",
      timezone: "UTC",
      forecast_lead_hours: 0,
      forecast_initialization_time: "2024-06-01T11:00:00Z",
      forecast_valid_time: "2024-06-01T12:00:00Z",
      forecast_step: 1,
      step_range: "0-1"
    },
    provenance: {
      source_id: "nasa_power",
      source_name: "NASA Prediction Of Worldwide Energy Resources (POWER)",
      data_type: "reanalysis",
      variable: "T2M,RH2M,WS10M,T2MWET,T2MDEW,ALLSKY_SFC_SW_DWN",
      units: "degC, %, m/s, degC, degC, W/m2",
      retrieved_at: "2024-06-01T12:06:00Z",
      data_status: "reference"
    }
  });

  const normalized = normalizeNASARecord(raw);

  assert.equal(normalized.time.forecast_lead_hours, 0);
  assert.equal(
    normalized.time.forecast_initialization_time,
    raw.time.forecast_initialization_time
  );
  assert.equal(
    normalized.time.forecast_valid_time,
    raw.time.forecast_valid_time
  );
  assert.equal(normalized.time.forecast_step, 1);
  assert.equal(normalized.time.step_range, "0-1");
  assert.equal(normalized.provenance.data_status, "reference");
  assert.equal(normalized.provenance.source_name, raw.provenance.source_name);
  assert.equal(normalized.quality.notes, raw.quality.notes);
}

function testMalformedInputRejected() {
  assert.throws(() => normalizeNASARecord(null), /NASA record must be an object/);
  assert.throws(() => normalizeNASARecord({}), /NASA record is missing location/);
  assert.throws(
    () => normalizeNASARecord({
      location: {
        name: "broken",
        latitude: 10,
        longitude: 20
      },
      time: { timestamp: "not-a-date" },
      environment: {},
      provenance: {},
      quality: {}
    }),
    /valid ISO date-time/
  );
}

testMapping();
testMissingSolarHandling();
testProvenancePreservation();
testMalformedInputRejected();

console.log("NASA normalization tests passed.");
