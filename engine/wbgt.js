/**
 * Thermal Shield 360
 * WBGT Engine
 *
 * Outdoor WBGT:
 *
 * WBGT = 0.7 * Natural Wet-Bulb Temperature
 *      + 0.2 * Globe Temperature
 *      + 0.1 * Air Temperature
 *
 * Temperatures are supplied in Celsius.
 *
 * IMPORTANT:
 * This module does not estimate globe temperature or
 * natural wet-bulb temperature from incomplete weather data.
 * If the required measurements are unavailable, the result
 * is explicitly marked as unavailable.
 *
 * WBGT is an environmental heat-stress indicator.
 * It is not a medical diagnosis or medical threshold.
 */

function calculateOutdoorWBGT({
  airTemperatureC,
  naturalWetBulbTemperatureC,
  globeTemperatureC
}) {
  const values = [
    airTemperatureC,
    naturalWetBulbTemperatureC,
    globeTemperatureC
  ];

  if (values.some((value) => !Number.isFinite(value))) {
    return {
      value_c: null,
      status: "unavailable",
      message:
        "WBGT requires air temperature, natural wet-bulb temperature, and globe temperature."
    };
  }

  const wbgtC =
    0.7 * naturalWetBulbTemperatureC +
    0.2 * globeTemperatureC +
    0.1 * airTemperatureC;

  return {
    value_c: Number(wbgtC.toFixed(2)),
    status: "calculated",
    method: "outdoor_wbgt",
    message: "Outdoor WBGT calculated successfully."
  };
}


/*
 * Browser access
 */
if (typeof window !== "undefined") {
  window.ThermalShieldWBGT = {
    calculateOutdoorWBGT
  };
}


/*
 * Node.js access
 */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    calculateOutdoorWBGT
  };
}
