# Data Quality Control (QC)

The Thermal Shield 360 QC layer validates normalized environmental data before it enters the thermal-index and HTSI calculation pipeline.

## Validation checks

### Temperature
- Must be a numeric value when available.
- Physically unreasonable values are flagged.

### Relative Humidity
- Must be between 0% and 100%.

### Wind Speed
- Must be zero or greater.
- Unit must be standardized to m/s.

### Solar Radiation
- Must be zero or greater when provided.
- Unit must be standardized to W/m².

### Location
- Latitude must be between -90 and 90 degrees.
- Longitude must be between -180 and 180 degrees.

### Time
- Timestamp must be valid ISO-8601.
- Forecast lead time must not be negative.

### Provenance
Every accepted record should retain:
- source ID
- source name
- variable
- units
- timestamp
- location
- data type
- retrieval time

## Quality flags

- `good` — data passes validation.
- `acceptable` — minor issue but usable with caution.
- `poor` — significant quality issue.
- `missing` — required information is unavailable.

## Principle

Invalid or incomplete environmental observations must not silently enter the HTSI calculation.
