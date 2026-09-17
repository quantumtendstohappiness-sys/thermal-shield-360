# Thermal Shield 360 — Research Data Layer

This directory contains normalized research-data snapshots and
source metadata used by the Thermal Shield 360 thermal intelligence engine.

## Research Sources

- IMD — India Meteorological Department
- ISRO / MOSDAC — satellite environmental observations
- NOAA — ENSO and climate indicators
- INCOIS — ocean, SST and climate indicators
- ECMWF — weather forecasts and ensemble information

## Data Categories

### Direct Thermal Inputs
- Air temperature
- Relative humidity
- Wind speed
- Solar radiation
- Land surface temperature

### Forecast Inputs
- Temperature forecasts
- Humidity forecasts
- Wind forecasts
- Radiation forecasts
- Ensemble forecast spread

### Climate Context
- ENSO
- Niño 3.4
- SST anomalies
- IOD-related indicators
- Satellite environmental indicators

## Data Provenance

Every research-data record should preserve:

- source
- variable
- value
- timestamp
- location
- unit
- data type
- quality
- retrieval information

## Data Integrity

Thermal Shield 360 must not represent fabricated or manually invented
values as live institutional observations.

Where a dataset requires registration or authentication, the system
must clearly identify the access method and must not expose credentials
in the public frontend or GitHub repository.

## Processing Pipeline

Research Data
→ Data Ingestion
→ Normalization
→ Quality Control
→ Thermal Data Engine
→ HI / WBGT / UTCI
→ HTSI
→ FDI / NRI / CTL
→ Early Warning
