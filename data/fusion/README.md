# Multi-Source Environmental Data Fusion

This directory defines the initial source-agnostic contract for combining
normalized environmental records in Thermal Shield 360. It is a data contract
only; it does not connect fusion to HTSI, prescribe scientific thresholds, or
assign weights to sources.

## Contract scope

`fusion-schema.json` describes:

- a fusion input containing normalized records from sources such as NASA
  POWER and ECMWF;
- source provenance, variable identity, units, timestamps, location, data
  type, quality, retrieval time, forecast timing, and source-grid information;
- a fusion output with one result for each canonical environmental variable;
- source-level values and provenance, alignment metadata, quality assessment,
  disagreement and confidence information, methodology, and explicit
  missing/unavailable fields.

Values may be unavailable. A source may be listed in `registered_sources`
without contributing a record or value, and a record may carry a `null` value.
Registration alone never makes a value required.

## Interpretation rules

Fusion is variable-specific. Observation, reanalysis, forecast, satellite,
and derived data are not interchangeable. They must not be combined or
compared without explicit variable, temporal, spatial, unit, and data-type
alignment rules. The contract records those alignment decisions and their
status but does not define the scientific rules or thresholds.

The schema intentionally does not define arbitrary source weights or require
averaging. A producer must describe any selected, transformed, or otherwise
combined value in `methodology` and retain the contributing `source_values`.
