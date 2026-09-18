const $ = id => document.getElementById(id);

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

async function loadWeather() {
  $("status").textContent =
    "Loading synchronized NASA POWER observation…";

  try {
    const r = await fetch(
      "data/live/nasa-power-current.json",
      { cache: "no-store" }
    );

    if (!r.ok) {
      throw new Error(`HTTP ${r.status}`);
    }

    const d = await r.json();

    const coordinates = d.geometry?.coordinates;
    const p = d.properties;
    const e = p?.environment;

    if (
      !Array.isArray(coordinates) ||
      !p ||
      !e ||
      !Number.isFinite(e.air_temperature_c) ||
      !Number.isFinite(e.relative_humidity_pct) ||
      !Number.isFinite(e.wind_speed_ms)
    ) {
      throw new Error(
        "NASA POWER observation is incomplete or invalid."
      );
    }

    const lon = coordinates[0];
    const lat = coordinates[1];

    $("lat").value = lat;
    $("lon").value = lon;

    $("temp").value = e.air_temperature_c;
    $("rh").value = e.relative_humidity_pct;
    $("wind").value = e.wind_speed_ms;

    if (Number.isFinite(e.solar_radiation_wm2)) {
      $("rad").value = e.solar_radiation_wm2;
    } else {
      $("rad").value = "";
    }

    $("status").textContent =
      `Loaded NASA POWER observation ${p.observation_timestamp_utc} UTC. ` +
      `Retrieved ${p.retrieved_at}. ` +
      `Location: ${lat}, ${lon}. ` +
      `Source: NASA POWER.`;

    calculate();

  } catch (e) {
    $("status").textContent =
      `NASA POWER load failed: ${e.message}`;
  }
}

  

function calculate() {

  const args = {
    T: parseFloat($("temp").value),
    RH: parseFloat($("rh").value),
    wind: parseFloat($("wind").value),
    rad: parseFloat($("rad").value),
    utci: parseFloat($("utci").value),
    persistence:
      parseFloat($("persistence").value) || 0,
    downside:
      parseFloat($("downside").value) || 0
  };

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
  `Weather: NASA POWER synchronized observation ` +
  `(T2M, RH2M, WS10M, T2MWET, T2MDEW, ALLSKY_SFC_SW_DWN).`;
  
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

$("loadBtn").addEventListener(
  "click",
  loadWeather
);

$("calcBtn").addEventListener(
  "click",
  calculate
);

loadENSO();
