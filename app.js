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
    "Loading NASA POWER data for your selected location…";

  try {
    const latitude = Number($("lat").value);
    const longitude = Number($("lon").value);

    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    ) {
      throw new Error(
        "Please select your location first."
      );
    }

    void loadECMWF(latitude, longitude);

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

    const parameterData =
      data.properties?.parameter;

    if (
      !parameterData ||
      !parameterData.T2M ||
      !parameterData.RH2M ||
      !parameterData.WS10M
    ) {
      throw new Error(
        "NASA POWER returned incomplete weather data."
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

    $("lat").value = latitude;
    $("lon").value = longitude;

    $("temp").value = temperature;
    $("rh").value = humidity;
    $("wind").value = wind;

    if (Number.isFinite(solarRadiation)) {
      $("rad").value = solarRadiation;
    } else {
      $("rad").value = "";
    }

    $("status").textContent =
      `Loaded NASA POWER observation ` +
      `${latestTimestamp} UTC. ` +
      `Location: ${latitude}, ${longitude}. ` +
      `Source: NASA POWER. ` +
      `Solar radiation: ` +
      `${Number.isFinite(solarRadiation) ? "available" : "unavailable"}.`;

    calculate();

  } catch (e) {
    $("status").textContent =
      `NASA POWER load failed: ${e.message}`;
  }
}

function displayValue(value) {
  if (value === null || value === undefined) {
    return "Missing (not supplied)";
  }

  return String(value);
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

function renderECMWF(data) {
  const properties = data.properties || {};
  const provenance = data.provenance || {};
  const quality = data.quality || {};
  const summary = $("ecmwfSummary");
  const parametersBox = $("ecmwfParameters");

  summary.replaceChildren();
  parametersBox.replaceChildren();

  addECMWFField(summary, "Source", properties.source);
  addECMWFField(summary, "Model", properties.model);
  addECMWFField(summary, "Resolution", properties.resolution);
  addECMWFField(summary, "Status", properties.status);
  addECMWFField(
    summary,
    "Requested coordinate",
    properties.requested_coordinate
      ? `${displayValue(properties.requested_coordinate.latitude)}, ${displayValue(properties.requested_coordinate.longitude)}`
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

async function loadECMWF(latitude, longitude) {
  const status = $("ecmwfStatus");
  status.textContent =
    `Loading ECMWF research data for ${latitude}, ${longitude}…`;
  $("ecmwfSummary").hidden = true;
  $("ecmwfRawDetails").hidden = true;
  $("ecmwfParameters").replaceChildren();

  try {
    const ecmwfUrl =
      "https://thermal-shield-360.vercel.app/api/ecmwf" +
      `?latitude=${encodeURIComponent(latitude)}` +
      `&longitude=${encodeURIComponent(longitude)}`;
    const response = await fetch(ecmwfUrl);

    if (!response.ok) {
      throw new Error(`ECMWF HTTP ${response.status}`);
    }

    const data = await response.json();
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

    renderECMWF(data);
    status.textContent =
      "Loaded ECMWF Open Data forecast. Values remain raw and separate from HTSI.";
  } catch (error) {
    status.textContent =
      `ECMWF research-data load failed: ${error.message}`;
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
    `Weather: NASA POWER synchronized observation
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

      $("lat").value = latitude;
      $("lon").value = longitude;

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

  $("selectedLocation").textContent =
    `📍 ${readableLocation}`;

} catch (error) {

  $("selectedLocation").textContent =
    "📍 Location detected";

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
      "&limit=5" +
      "&countrycodes=in";

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

        $("lat").value = latitude;
        $("lon").value = longitude;

        $("selectedLocation").textContent =
          `📍 ${place.display_name}`;

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
