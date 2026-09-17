# Thermal Shield 360 — Human Thermal Stress MVP

This is a **tablet-friendly static prototype** for the Human Thermal Stress Index (HTSI) layer.

## What it does

1. Loads hourly weather from Open-Meteo:
   - 2 m air temperature
   - 2 m relative humidity
   - 10 m wind
   - shortwave solar radiation
2. Calculates NOAA/NWS Heat Index using the Rothfusz regression.
3. Calculates a clearly labelled **WBGT proxy** when globe temperature is unavailable.
4. Accepts UTCI as an optional input. Do not fabricate UTCI.
5. Combines the transparent components using the Thermal Shield 360 HTSI research formula.
6. Displays an ENSO context file separately. ENSO is **not** treated as a deterministic local heatwave trigger.

## Important scientific limits

The HTSI weights and normalization ranges are a prototype design from the Thermal Shield 360 research blueprint. They must be calibrated and validated against Indian historical observations/health outcomes before making operational claims.

The WBGT proxy is NOT official ISO WBGT. Replace it with measured globe temperature or a validated radiation/globe-temperature method before claiming official WBGT.

For production, add:
- authoritative IMD/NCMRWF/NCEP/ECMWF forecast adapters
- validated UTCI implementation
- Indian historical baseline percentile normalization
- forecast ensemble members and Forecast Disagreement Index (FDI)
- Night-time Recovery Index (NRI)
- Cumulative Thermal Load (CTL)
- ward-level GIS/exposure layers
- health/outcome model only after appropriate validation and privacy review.

## Deploy on GitHub Pages

Upload the files to a repository, then:
Repository -> Settings -> Pages -> Deploy from branch -> main -> /(root) -> Save.

GitHub Pages can publish static files directly from a repository.

## Data provenance

Keep source, timestamp, spatial resolution, forecast lead time and quality flag with every value.
