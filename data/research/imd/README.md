# IMD Data Connector

This module is responsible for obtaining authorized data from the
official India Meteorological Department API.

## Purpose

The IMD connector provides Indian meteorological observations,
forecasts and warnings for Thermal Shield 360.

## Intended variables

- Air temperature
- Relative humidity
- Wind speed
- Rainfall
- Forecast temperature
- Forecast humidity
- Forecast wind
- Heatwave/weather warnings

## Data flow

IMD API
→ ingestion
→ normalization
→ quality control
→ Thermal Shield 360 data layer

## Security

IMD API credentials must never be stored in frontend JavaScript,
HTML, CSS or public JSON files.

Credentials must be supplied through secure environment variables
or GitHub Actions Secrets.

## Provenance

Each imported record must preserve:

- source
- variable
- timestamp
- location
- value
- unit
- data type
- quality
- retrieval time
