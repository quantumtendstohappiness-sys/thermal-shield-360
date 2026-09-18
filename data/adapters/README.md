# Thermal Shield 360 — Data Adapters

This directory contains source-specific adapters that convert
public or authorized research datasets into the normalized
Thermal Shield 360 observation/forecast format.

## Data sources

### NASA POWER
Public meteorological and solar/environmental data.

Role:
- Air temperature
- Relative humidity
- Wind
- Radiation/environmental variables
- Wet-bulb-related parameter where methodology is verified

Access:
Public NASA POWER API.

### NOAA
Public NOAA datasets are used for:
- Forecast/model data
- Climate context
- ENSO information

NOAA climate context is not directly multiplied into short-term HTSI
without scientific validation.

### ECMWF Open Data
Public subset of IFS/AIFS forecast data.

Role:
- Forecast variables
- Forecast comparison
- Future Forecast Disagreement Index (FDI)

### INCOIS ERDDAP
Public oceanographic datasets.

Role:
- Sea surface temperature
- SST anomaly
- Ocean/climate context

### IMD
Institutional/API access is being pursued.

Future role:
- AWS/ARG observations
- Forecasts
- District warnings
- Rainfall
- Nowcasts

### ISRO / MOSDAC
Institutional/research access is being pursued.

Future role:
- INSAT satellite observations
- Land Surface Temperature
- Other relevant satellite environmental products

## Adapter rule

Every adapter must preserve:

- source
- variable
- timestamp
- units
- latitude
- longitude
- data type
- retrieval time
- quality status

No value should enter the HTSI engine without provenance.
