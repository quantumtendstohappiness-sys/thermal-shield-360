const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";

function finite(v) {
  return Number.isFinite(Number(v)) ? Number(v) : null;
}

async function fetchOpenMeteo(latitude, longitude) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: "temperature_2m,relative_humidity_2m,dew_point_2m,wind_speed_10m,shortwave_radiation,direct_normal_irradiance,diffuse_radiation",
    hourly: "temperature_2m,relative_humidity_2m,dew_point_2m,wind_speed_10m,shortwave_radiation,direct_normal_irradiance,diffuse_radiation",
    forecast_days: "2",
    timezone: "UTC"
  });

  const response = await fetch(`${OPEN_METEO_URL}?${params}`);
  if (!response.ok) throw new Error(`Open-Meteo HTTP ${response.status}`);

  const data = await response.json();

  return {
    source: "Open-Meteo",
    source_id: "open_meteo",
    model: data.current?.model || null,
    requested_coordinates: {
      latitude: finite(latitude),
      longitude: finite(longitude)
    },
    retrieved_at: new Date().toISOString(),
    current: {
      timestamp: data.current?.time || null,
      air_temperature_c: finite(data.current?.temperature_2m),
      relative_humidity_pct: finite(data.current?.relative_humidity_2m),
      dew_point_c: finite(data.current?.dew_point_2m),
      wind_speed_ms: finite(data.current?.wind_speed_10m),
      shortwave_radiation_wm2: finite(data.current?.shortwave_radiation),
      direct_normal_irradiance_wm2: finite(data.current?.direct_normal_irradiance),
      diffuse_radiation_wm2: finite(data.current?.diffuse_radiation)
    },
    hourly: data.hourly || null,
    provenance: {
      endpoint: OPEN_METEO_URL,
      timezone: data.timezone || "UTC",
      latitude: data.latitude,
      longitude: data.longitude
    }
  };
}

if (typeof window !== "undefined") { window.fetchOpenMeteo = fetchOpenMeteo; }

if (typeof module !== "undefined") {
  module.exports = { fetchOpenMeteo };
}
