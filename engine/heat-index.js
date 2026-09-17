/**
 * Thermal Shield 360
 * Heat Index Engine
 *
 * Calculates the NOAA/NWS-style Heat Index using
 * air temperature and relative humidity.
 *
 * Input:
 *   temperatureC - air temperature in Celsius
 *   relativeHumidity - relative humidity in percent
 *
 * Output:
 *   Heat Index in Celsius
 *
 * Note:
 * Heat Index is an environmental heat-stress indicator.
 * It is not a medical diagnosis or medical threshold.
 */

function celsiusToFahrenheit(celsius) {
  return (celsius * 9) / 5 + 32;
}

function fahrenheitToCelsius(fahrenheit) {
  return ((fahrenheit - 32) * 5) / 9;
}

function calculateHeatIndex(temperatureC, relativeHumidity) {
  if (
    !Number.isFinite(temperatureC) ||
    !Number.isFinite(relativeHumidity)
  ) {
    return {
      value_c: null,
      status: "invalid",
      message: "Temperature and relative humidity must be numeric."
    };
  }

  if (relativeHumidity < 0 || relativeHumidity > 100) {
    return {
      value_c: null,
      status: "invalid",
      message: "Relative humidity must be between 0% and 100%."
    };
  }

  const temperatureF = celsiusToFahrenheit(temperatureC);

  /*
   * For temperatures below 80°F, the standard Rothfusz
   * heat-index equation is not applied.
   */
  if (temperatureF < 80) {
    return {
      value_c: temperatureC,
      status: "outside_standard_range",
      message:
        "Temperature is below the standard Heat Index calculation range."
    };
  }

  /*
   * Rothfusz regression used by NOAA/NWS for the
   * standard Heat Index calculation.
   */
  let heatIndexF =
    -42.379 +
    2.04901523 * temperatureF +
    10.14333127 * relativeHumidity -
    0.22475541 * temperatureF * relativeHumidity -
    0.00683783 * temperatureF * temperatureF -
    0.05481717 * relativeHumidity * relativeHumidity +
    0.00122874 * temperatureF * temperatureF * relativeHumidity +
    0.00085282 * temperatureF * relativeHumidity * relativeHumidity -
    0.00000199 *
      temperatureF *
      temperatureF *
      relativeHumidity *
      relativeHumidity;

  /*
   * Low-humidity adjustment.
   */
  if (
    relativeHumidity < 13 &&
    temperatureF >= 80 &&
    temperatureF <= 112
  ) {
    const adjustment =
      ((13 - relativeHumidity) / 4) *
      Math.sqrt((17 - Math.abs(temperatureF - 95)) / 17);

    heatIndexF -= adjustment;
  }

  /*
   * High-humidity adjustment.
   */
  if (
    relativeHumidity > 85 &&
    temperatureF >= 80 &&
    temperatureF <= 87
  ) {
    const adjustment =
      ((relativeHumidity - 85) / 10) *
      ((87 - temperatureF) / 5);

    heatIndexF += adjustment;
  }

  const heatIndexC = fahrenheitToCelsius(heatIndexF);

  return {
    value_c: Number(heatIndexC.toFixed(2)),
    status: "calculated",
    message: "Heat Index calculated successfully."
  };
}


/*
 * Browser access
 */
if (typeof window !== "undefined") {
  window.ThermalShieldHeatIndex = {
    calculateHeatIndex
  };
}


/*
 * Node.js access
 */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    calculateHeatIndex
  };
}
