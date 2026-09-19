/**
 * ECMWF normalization tests.
 *
 * Uses Node.js built-in assertions and the repository's actual
 * data/live/ecmwf-current.json payload structure.
 */

"use strict";

const assert = require("node:assert/strict");

const {
  normalizeECMWFPayload,
  kelvinToCelsius
} = require("./ecmwf");

const sourcePayload = require("../live/ecmwf-current.json");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeSourcePayload() {
  return normalizeECMWFPayload(clone(sourcePayload));
}

function makeSyntheticValidPayload() {
  const payload = clone(sourcePayload);
  const parameters = payload.properties.parameters;

  parameters["2t"].raw_value = 300;
  parameters["2d"].raw_value = 295;
  parameters["10u"].raw_value = 3;
  parameters["10v"].raw_value = 4;

  return payload;
}

function findLineage(normalized, canonicalVariable) {
  const lineage = normalized.provenance.variables.find(
    (item) => item.canonical_variable === canonicalVariable
  );

  assert.ok(
    lineage,
    `Missing provenance lineage for ${canonicalVariable}`
  );

  return lineage;
}

function testKelvinToCelsius() {
  const normalized = normalizeSourcePayload();
  const rawKelvin =
    sourcePayload.properties.parameters["2t"].raw_value;

  assert.equal(
    normalized.environment.air_temperature_c,
    rawKelvin - 273.15
  );

  assert.equal(
    normalized.environment.air_temperature_c,
    kelvinToCelsius(rawKelvin, "test 2t")
  );

  const lineage = findLineage(
    normalized,
    "air_temperature_c"
  );

  assert.equal(lineage.source_variable, "2t");
  assert.equal(lineage.native_value, rawKelvin);
  assert.equal(lineage.native_unit, "K");
  assert.equal(
    lineage.normalized_value,
    rawKelvin - 273.15
  );
  assert.equal(lineage.normalized_unit, "degC");
  assert.equal(lineage.status, "normalized");
  assert.equal(
    lineage.transformation,
    "value_C = value_K - 273.15"
  );
}

function testDewPointUses2dAsDewPoint() {
  const normalized = normalizeSourcePayload();
  const rawKelvin =
    sourcePayload.properties.parameters["2d"].raw_value;

  assert.equal(
    normalized.environment.dew_point_c,
    rawKelvin - 273.15
  );

  assert.equal(
    normalized.environment.dew_point_c,
    kelvinToCelsius(rawKelvin, "test 2d")
  );

  const lineage = findLineage(
    normalized,
    "dew_point_c"
  );

  assert.equal(lineage.source_variable, "2d");
  assert.equal(lineage.native_value, rawKelvin);
  assert.equal(lineage.native_unit, "K");
  assert.equal(
    lineage.normalized_value,
    rawKelvin - 273.15
  );
  assert.equal(lineage.normalized_unit, "degC");
  assert.equal(lineage.status, "normalized");
  assert.equal(
    lineage.transformation,
    "value_C = value_K - 273.15"
  );

  assert.equal(
    normalized.environment.natural_wet_bulb_c,
    undefined
  );

  assert.equal(
    normalized.environment.wet_bulb_c,
    undefined
  );

  assert.equal(
    normalized.provenance.variables.some(
      (item) =>
        item.canonical_variable === "natural_wet_bulb_c" ||
        item.canonical_variable === "wet_bulb_c"
    ),
    false
  );
}

function testWindSpeedMagnitude() {
  const normalized = normalizeSourcePayload();

  const u =
    sourcePayload.properties.parameters["10u"].raw_value;

  const v =
    sourcePayload.properties.parameters["10v"].raw_value;

  const expected = Math.sqrt((u * u) + (v * v));

  assert.equal(
    normalized.environment.wind_speed_ms,
    expected
  );

  const uLineage = findLineage(normalized, "wind_u");
  const vLineage = findLineage(normalized, "wind_v");
  const speedLineage = findLineage(
    normalized,
    "wind_speed_ms"
  );

  assert.equal(uLineage.source_variable, "10u");
  assert.equal(uLineage.native_value, u);
  assert.equal(uLineage.native_unit, "m s**-1");

  assert.equal(vLineage.source_variable, "10v");
  assert.equal(vLineage.native_value, v);
  assert.equal(vLineage.native_unit, "m s**-1");

  assert.equal(speedLineage.source_variable, "10u,10v");
  assert.equal(speedLineage.native_value, null);
  assert.equal(speedLineage.normalized_value, expected);
  assert.equal(speedLineage.normalized_unit, "m/s");
  assert.equal(speedLineage.status, "derived");
  assert.deepEqual(
    speedLineage.input_variables,
    ["10u", "10v"]
  );
  assert.equal(
    speedLineage.transformation,
    "wind_speed_ms = sqrt(10u^2 + 10v^2)"
  );

  assert.equal(
    normalized.environment.wind_direction_deg,
    null
  );

  assert.equal(
    normalized.provenance.variables.some(
      (item) => item.canonical_variable === "wind_direction_deg"
    ),
    false
  );
}

function testRelativeHumidityRemainsPending() {
  const normalized = normalizeSourcePayload();

  assert.equal(
    normalized.environment.relative_humidity_pct,
    null
  );

  assert.ok(
    normalized.quality.pending_fields.includes(
      "environment.relative_humidity_pct"
    )
  );

  const lineage = findLineage(
    normalized,
    "relative_humidity_pct"
  );

  assert.equal(lineage.native_value, null);
  assert.equal(lineage.native_unit, null);
  assert.equal(lineage.normalized_value, null);
  assert.equal(lineage.normalized_unit, "%");
  assert.equal(lineage.status, "missing");
  assert.deepEqual(
    lineage.input_variables,
    ["2t", "2d"]
  );
  assert.match(
    lineage.transformation,
    /RH derivation intentionally pending/
  );
  assert.match(
    lineage.transformation,
    /No ECMWF raw RH field is created/
  );
}

function testSSRDRemainsRaw() {
  const normalized = normalizeSourcePayload();

  const rawSSRD =
    sourcePayload.properties.parameters.ssrd.raw_value;

  const rawUnits =
    sourcePayload.properties.parameters.ssrd.raw_units;

  assert.equal(
    normalized.environment.solar_radiation_wm2,
    null
  );

  assert.ok(
    normalized.quality.pending_fields.includes(
      "environment.solar_radiation_wm2"
    )
  );

  const lineage = findLineage(
    normalized,
    "solar_radiation_wm2"
  );

  assert.equal(lineage.source_variable, "ssrd");
  assert.equal(lineage.native_value, rawSSRD);
  assert.equal(lineage.native_unit, rawUnits);
  assert.equal(lineage.native_unit, "J m**-2");
  assert.equal(lineage.normalized_value, null);
  assert.equal(lineage.normalized_unit, null);
  assert.equal(lineage.status, "source");
  assert.match(
    lineage.transformation,
    /not converted/
  );

  assert.notEqual(
    lineage.normalized_value,
    rawSSRD
  );
}

function testSurfaceTemperatureUsesSktOnly() {
  const normalized = normalizeSourcePayload();

  const rawSkt =
    sourcePayload.properties.parameters.skt.raw_value;

  assert.equal(
    normalized.environment.surface_temperature_c,
    rawSkt - 273.15
  );

  assert.equal(
    normalized.environment.surface_temperature_c,
    kelvinToCelsius(rawSkt, "test skt")
  );

  assert.notEqual(
    normalized.environment.surface_temperature_c,
    normalized.environment.air_temperature_c
  );

  const lineage = findLineage(
    normalized,
    "surface_temperature_c"
  );

  assert.equal(lineage.source_variable, "skt");
  assert.equal(lineage.native_value, rawSkt);
  assert.equal(lineage.native_unit, "K");
  assert.equal(
    lineage.normalized_value,
    rawSkt - 273.15
  );
  assert.equal(lineage.normalized_unit, "degC");
  assert.equal(lineage.status, "normalized");
  assert.match(
    lineage.transformation,
    /source field remains skin temperature/
  );
}

function testCoreMissingFieldsOnly() {
  const validPayload = makeSyntheticValidPayload();

  const normalized =
    normalizeECMWFPayload(clone(validPayload));

  assert.deepEqual(
    normalized.quality.missing_fields,
    []
  );

  assert.ok(
    !normalized.quality.missing_fields.includes(
      "environment.relative_humidity_pct"
    )
  );

  assert.ok(
    !normalized.quality.missing_fields.includes(
      "environment.solar_radiation_wm2"
    )
  );

  const missingAirTemperature = clone(validPayload);
  missingAirTemperature.properties.parameters["2t"].raw_value =
    null;

  const airTemperatureResult =
    normalizeECMWFPayload(missingAirTemperature);

  assert.deepEqual(
    airTemperatureResult.quality.missing_fields,
    ["environment.air_temperature_c"]
  );

  const missingDewPoint = clone(validPayload);
  missingDewPoint.properties.parameters["2d"].raw_value =
    null;

  const dewPointResult =
    normalizeECMWFPayload(missingDewPoint);

  assert.deepEqual(
    dewPointResult.quality.missing_fields,
    ["environment.dew_point_c"]
  );

  const missingWindComponent = clone(validPayload);
  missingWindComponent.properties.parameters["10v"].raw_value =
    null;

  const windResult =
    normalizeECMWFPayload(missingWindComponent);

  assert.deepEqual(
    windResult.quality.missing_fields,
    ["environment.wind_speed_ms"]
  );

  for (const result of [
    airTemperatureResult,
    dewPointResult,
    windResult
  ]) {
    assert.ok(
      !result.quality.missing_fields.includes(
        "environment.relative_humidity_pct"
      )
    );

    assert.ok(
      !result.quality.missing_fields.includes(
        "environment.solar_radiation_wm2"
      )
    );
  }
}

function testQualityFlagForCoreAndPendingFields() {
  const validPayload = makeSyntheticValidPayload();

  const normalized =
    normalizeECMWFPayload(validPayload);

  assert.equal(
    normalized.quality.quality_flag,
    "acceptable"
  );

  assert.deepEqual(
    normalized.quality.missing_fields,
    []
  );

  assert.ok(
    normalized.quality.pending_fields.includes(
      "environment.relative_humidity_pct"
    )
  );

  assert.ok(
    normalized.quality.pending_fields.includes(
      "environment.solar_radiation_wm2"
    )
  );

  const missingCore = clone(validPayload);
  missingCore.properties.parameters["2t"].raw_value =
    null;

  const result =
    normalizeECMWFPayload(missingCore);

  assert.equal(
    result.quality.quality_flag,
    "missing"
  );

  assert.ok(
    result.quality.missing_fields.includes(
      "environment.air_temperature_c"
    )
  );

  assert.ok(
    !result.quality.missing_fields.includes(
      "environment.relative_humidity_pct"
    )
  );

  assert.ok(
    !result.quality.missing_fields.includes(
      "environment.solar_radiation_wm2"
    )
  );
}

function testNoThermalCalculations() {
  const normalized = normalizeSourcePayload();

  assert.equal(normalized.htsi, undefined);
  assert.equal(normalized.wbgt, undefined);
  assert.equal(normalized.utci, undefined);
  assert.equal(normalized.heat_index, undefined);
  assert.equal(normalized.fdi, undefined);
  assert.equal(normalized.nri, undefined);
  assert.equal(normalized.ctl, undefined);

  assert.equal(
    Object.prototype.hasOwnProperty.call(
      normalized,
      "thermal"
    ),
    false
  );
}

function testProvenancePreservation() {
  const normalized = normalizeSourcePayload();

  assert.equal(
    normalized.provenance.source_id,
    "ecmwf_opendata"
  );

  assert.equal(
    normalized.provenance.source_name,
    "ECMWF Open Data"
  );

  assert.equal(
    normalized.provenance.data_type,
    "forecast"
  );

  assert.equal(
    normalized.provenance.data_status,
    "forecast"
  );

  assert.equal(
    normalized.time.forecast_initialization_time,
    sourcePayload.properties
      .forecast_initialization_time_utc
  );

  assert.equal(
    normalized.time.forecast_valid_time,
    sourcePayload.properties
      .forecast_valid_time_utc
  );

  assert.equal(
    normalized.time.forecast_step,
    sourcePayload.properties
      .forecast_step_requested
  );

  assert.ok(
    normalized.provenance.variables.some(
      (item) => item.source_variable === "2t"
    )
  );

  assert.ok(
    normalized.provenance.variables.some(
      (item) => item.source_variable === "2d"
    )
  );

  assert.ok(
    normalized.provenance.variables.some(
      (item) => item.source_variable === "10u"
    )
  );

  assert.ok(
    normalized.provenance.variables.some(
      (item) => item.source_variable === "10v"
    )
  );

  assert.ok(
    normalized.provenance.variables.some(
      (item) => item.source_variable === "ssrd"
    )
  );

  assert.ok(
    normalized.provenance.variables.some(
      (item) => item.source_variable === "skt"
    )
  );

  for (const lineage of normalized.provenance.variables) {
    assert.equal(typeof lineage.raw_record_ref, "string");
    assert.ok(lineage.raw_record_ref.length > 0);
  }
}

testKelvinToCelsius();
testDewPointUses2dAsDewPoint();
testWindSpeedMagnitude();
testRelativeHumidityRemainsPending();
testSSRDRemainsRaw();
testSurfaceTemperatureUsesSktOnly();
testCoreMissingFieldsOnly();
testQualityFlagForCoreAndPendingFields();
testNoThermalCalculations();
testProvenancePreservation();

console.log("ECMWF normalization tests passed.");
