/**
 * Thermal Shield 360
 * NASA POWER Adapter
 *
 * Public NASA POWER hourly data adapter.
 *
 * Source:
 * NASA Prediction Of Worldwide Energy Resources (POWER)
 *
 * Documentation:
 * https://power.larc.nasa.gov/docs/services/api/temporal/hourly/
 *
 * Parameters:
 * T2M               = air temperature at 2 m
 * RH2M              = relative humidity at 2 m
 * WS10M             = wind speed at 10 m
 * T2MWET            = POWER wet-bulb-related temperature parameter
 * T2MDEW            = dew-point temperature at 2 m
 * ALLSKY_SFC_SW_DWN = all-sky surface shortwave downward irradiance
 *
 * IMPORTANT:
 * T2MWET is retained as a NASA POWER parameter.
 * It must not automatically be represented as a measured
 * natural wet-bulb temperature for official WBGT.
 */

const NASA_POWER_BASE_URL =
  "https://power.larc.nasa.gov/api/temporal/hourly/point";

const NASA_POWER_PARAMETERS = [
  "T2M",
  "RH2M",
  "WS10M",
  "T2MWET",
  "T2MDEW",
  "ALLSKY_SFC_SW_DWN"
];

function buildNASAUrl({
  latitude,
  longitude,
  start,
  end,
  community = "SB"
}) {
  if (!Number.isFinite(latitude)) {
    throw new Error("Invalid latitude.");
  }

  if (!Number.isFinite(longitude)) {
    throw new Error("Invalid longitude.");
  }

  if (!/^\d{8}$/.test(start)) {
    throw new Error("Start date must use YYYYMMDD.");
  }

  if (!/^\d{8}$/.test(end)) {
    throw new Error("End date must use YYYYMMDD.");
  }

  const params = new URLSearchParams({
    parameters: NASA_POWER_PARAMETERS.join(","),
    community,
    longitude: String(longitude),
    latitude: String(latitude),
    start,
    end,
    format: "JSON",
    "time-standard": "UTC"
  });

  return `${NASA_POWER_BASE_URL}?${params.toString()}`;
}
function cleanNASAValue(value) {
  if (value === -999 || value === -999.0) {
    return null;
  }

  return Number.isFinite(value) ? value : null;
}
function parseNASAResponse(data) {
  if (!data || !data.properties) {
    throw new Error(
      "NASA POWER response does not contain expected properties."
    );
  }

  const parameterData =
    data.properties.parameter || {};

  const timestamps = Object.keys(
    parameterData.T2M || {}
  );

  return timestamps.map(timestamp => ({
    location: {
      latitude: data.geometry?.coordinates?.[1] ?? null,
      longitude: data.geometry?.coordinates?.[0] ?? null,
      name: "NASA POWER point"
    },

    time: {
      timestamp,
      timezone: "UTC",
      forecast_lead_hours: null
    },

    environment: {
      air_temperature_c:
       cleanNASAValue(parameterData.T2M?.[timestamp]),

      relative_humidity_pct:
       cleanNASAValue(parameterData.RH2M?.[timestamp]),

      wind_speed_ms:
       cleanNASAValue(parameterData.WS10M?.[timestamp]),

      solar_radiation_wm2:
       cleanNASAValue(
        parameterData.ALLSKY_SFC_SW_DWN?.[timestamp]
        ),

      nasa_wet_bulb_related_c:
       cleanNASAValue(
        parameterData.T2MWET?.[timestamp]
        ),

      dew_point_c:
       cleanNASAValue(
        parameterData.T2MDEW?.[timestamp]
        )
},

    provenance: {
      source_id: "nasa_power",
      source_name:
        "NASA Prediction Of Worldwide Energy Resources (POWER)",
      data_type: "reanalysis",
      variable:
        "T2M,RH2M,WS10M,T2MWET,T2MDEW,ALLSKY_SFC_SW_DWN",
      units:
        "degC, %, m/s, degC, degC, W/m2",
      retrieved_at:
        new Date().toISOString()
    },

    quality: {
      quality_flag: "acceptable",
      missing_fields: [
        ...(parameterData.ALLSKY_SFC_SW_DWN?.[timestamp] === -999
          ? ["environment.solar_radiation_wm2"]
          : [])
      ],
      notes:
        "NASA POWER data. T2MWET is retained as a NASA POWER wet-bulb-related parameter and is not treated as measured natural wet-bulb temperature."
    }
  }));
}

async function fetchNASAWeather({
  latitude,
  longitude,
  start,
  end,
  community = "SB"
}) {
  const url = buildNASAUrl({
    latitude,
    longitude,
    start,
    end,
    community
  });

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `NASA POWER request failed: HTTP ${response.status}`
    );
  }

  const data = await response.json();

  return {
    source: "NASA POWER",
    url,
    records: parseNASAResponse(data)
  };
}

if (typeof window !== "undefined") {
  window.ThermalShieldNASAPower = {
    buildNASAUrl,
    parseNASAResponse,
    fetchNASAWeather
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    buildNASAUrl,
    parseNASAResponse,
    fetchNASAWeather
  };
}
