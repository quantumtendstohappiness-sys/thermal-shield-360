/**
 * Thermal Shield 360
 * UTCI Engine
 *
 * UTCI requires:
 *   - Air temperature (Ta)
 *   - Mean radiant temperature (Tmrt)
 *   - Wind speed at the UTCI reference condition
 *   - Water vapour pressure
 *
 * This module intentionally does NOT estimate missing Tmrt.
 * Missing research inputs result in an explicit "unavailable"
 * status rather than a fabricated UTCI value.
 *
 * UTCI polynomial approximation applicability:
 * wind speed approximately 0.5–17 m/s.
 *
 * Source:
 * UTCI / COST Action 730
 * https://utci.org/
 */

function calculateUTCI({
  airTemperatureC,
  meanRadiantTemperatureC,
  windSpeedMs,
  waterVapourPressureHpa
}) {
  const inputs = [
    airTemperatureC,
    meanRadiantTemperatureC,
    windSpeedMs,
    waterVapourPressureHpa
  ];

  if (inputs.some((value) => !Number.isFinite(value))) {
    return {
      value_c: null,
      status: "unavailable",
      message:
        "UTCI requires air temperature, mean radiant temperature, wind speed and water vapour pressure."
    };
  }

  if (windSpeedMs < 0.5 || windSpeedMs > 17) {
    return {
      value_c: null,
      status: "outside_standard_range",
      message:
        "Wind speed is outside the documented UTCI polynomial approximation range of 0.5–17 m/s."
    };
  }

  if (waterVapourPressureHpa < 0) {
    return {
      value_c: null,
      status: "invalid",
      message: "Water vapour pressure cannot be negative."
    };
  }

  const deltaTmrt =
    meanRadiantTemperatureC - airTemperatureC;

  /*
   * At this stage we deliberately do not reproduce the
   * complete UTCI regression polynomial inside the project.
   *
   * The module is therefore an input-validation boundary
   * until the official UTCI approximation implementation
   * is incorporated and verified against reference values.
   */

  return {
    value_c: null,
    status: "pending_reference_implementation",
    inputs: {
      air_temperature_c: airTemperatureC,
      mean_radiant_temperature_c: meanRadiantTemperatureC,
      wind_speed_ms: windSpeedMs,
      water_vapour_pressure_hpa: waterVapourPressureHpa,
      delta_tmrt_c: Number(deltaTmrt.toFixed(2))
    },
    message:
      "Required UTCI inputs are valid. Reference UTCI polynomial implementation is pending verification."
  };
}


/*
 * Browser access
 */
if (typeof window !== "undefined") {
  window.ThermalShieldUTCI = {
    calculateUTCI
  };
}


/*
 * Node.js access
 */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    calculateUTCI
  };
}
