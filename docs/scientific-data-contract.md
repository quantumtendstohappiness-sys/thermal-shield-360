# Thermal Shield 360 Scientific Data Contract

**Status:** Documentation-only contract  
**Scope:** Future multi-source scientific data pipeline  
**Implementation status:** Not implemented by this document

## 1. Purpose and scope

This contract defines how Thermal Shield 360 will describe, preserve, normalize, quality-control, align, compare, and eventually consume scientific data from multiple sources.

The initial sources covered here are:

- NASA Prediction Of Worldwide Energy Resources (NASA POWER)
- ECMWF Open Data

This contract is intentionally limited to data semantics and architecture. It does not implement data retrieval, normalization, quality control, source agreement, thermal-index calculations, or HTSI integration.

The contract is based on the repository's existing source-adapter and provenance architecture. Every value must remain traceable to its source variable, native unit, timestamp, location, and quality status.

NASA POWER and ECMWF values must not be represented as local ground observations unless the source actually provides a validated local ground observation. A point or grid value retrieved for requested coordinates is not automatically a station observation.

---

## 2. Source roles

### NASA POWER

NASA POWER provides public environmental and meteorological data products accessed through the NASA POWER API.

Within this contract, NASA POWER may provide:

- Air temperature through `T2M`
- Dew-point temperature through `T2MDEW`
- Relative humidity through `RH2M`
- Wind speed through `WS10M`
- Surface shortwave radiation through `ALLSKY_SFC_SW_DWN`
- A wet-bulb-related parameter through `T2MWET`

NASA POWER data must be described according to the product's actual provenance and metadata. It must not be described as a local ground-station observation solely because it is requested for a latitude and longitude.

The repository currently treats NASA POWER as environmental data and preserves source, timestamp, coordinates, retrieval information, and quality status.

### ECMWF Open Data

ECMWF Open Data provides forecast/model data from ECMWF forecast systems, including fields represented in GRIB messages.

Within this contract, ECMWF Open Data may provide:

- Forecast air temperature through `2t`
- Forecast dew-point temperature through `2d`
- Forecast wind components through `10u` and `10v`
- Accumulated surface solar radiation through `ssrd`
- Surface temperature-related fields such as `skt`, where explicitly retained with their source meaning

ECMWF values are forecast/model-derived values. They are not local station observations. The contract requires preservation of forecast initialization time, forecast valid time, forecast step, grid location, and relevant GRIB metadata.

### Environmental/model-derived data versus forecast data

The pipeline must distinguish at least these source roles:

| Role | Meaning |
|---|---|
| Environmental/model-derived data | A source environmental product whose provenance, processing, spatial representation, and temporal meaning must be retained from the source documentation. NASA POWER values belong in this category unless the source metadata establishes another status. |
| Forecast data | A model prediction associated with a forecast initialization time, valid time, forecast step, and model grid. ECMWF Open Data belongs in this category. |

Neither category should be relabeled as a local ground observation without an actual validated observation source and appropriate station metadata.

---

## 3. Variable mapping table

| Canonical variable | NASA POWER variable | ECMWF variable(s) | Native unit | Future normalized unit | Scientific transformation required | Data type / role | Important caveats |
|---|---|---|---|---|---|---|---|
| `air_temperature` | `T2M` | `2t` | NASA POWER: source-reported temperature unit, currently represented by the adapter as °C; ECMWF: K | °C | NASA POWER and ECMWF normalization must use source metadata and preserve raw values first. ECMWF Kelvin-to-Celsius conversion belongs only in normalization. | Environmental/model-derived or forecast scalar | Do not treat either value as an exact local station observation. Preserve native value and unit. |
| `dew_point_temperature` | `T2MDEW` | `2d` | NASA POWER: source-reported temperature unit, currently represented by the adapter as °C; ECMWF: K | °C | Future normalization to °C; preserve raw values first. | Environmental/model-derived or forecast scalar | ECMWF `2d` is dew-point temperature, not natural wet-bulb temperature. |
| `relative_humidity` | `RH2M` | No raw ECMWF RH field in this contract; derive later from `2t` and `2d` | NASA POWER: %; ECMWF inputs: K | % | NASA POWER RH is retained as supplied. ECMWF RH is derived later in the normalization layer using a saturation-vapour-pressure relationship. | Environmental/model-derived or normalized forecast derivative | Do not invent or add an ECMWF RH field in the raw source layer. |
| `wind_speed` | `WS10M` | Derived later from `10u` and `10v` | NASA POWER: source-reported speed unit, currently represented by the adapter as m/s; ECMWF components: m/s | m/s | Future derivation: `sqrt(10u² + 10v²)`. | Environmental/model-derived scalar or normalized forecast derivative | Preserve ECMWF `10u` and `10v` as raw values. |
| `wind_u` | Not provided by the current NASA POWER mapping | `10u` | m/s | m/s | No transformation required to preserve the raw component. | Raw forecast vector component | Must not be replaced with wind speed. |
| `wind_v` | Not provided by the current NASA POWER mapping | `10v` | m/s | m/s | No transformation required to preserve the raw component. | Raw forecast vector component | Must not be replaced with wind speed. |
| `solar_radiation` | `ALLSKY_SFC_SW_DWN` | `ssrd` | NASA POWER: source-reported radiation unit, currently represented by the adapter as W/m²; ECMWF: J/m² accumulated energy | W/m² for a future rate representation | ECMWF `ssrd` may be converted to an average W/m² only after the exact accumulation duration is known from metadata and `stepRange`. | Environmental/model-derived or accumulated forecast energy | Never blindly divide ECMWF `ssrd` by 3600. Preserve raw `ssrd` and `stepRange`. Missing radiation remains missing. |
| `surface_temperature` | No required NASA POWER mapping in this contract | `skt` where available | ECMWF source-reported unit, commonly K | °C | Future normalization only after confirming the source parameter definition and unit. | Forecast surface/model field | Do not confuse surface temperature with 2 m air temperature or local measured surface temperature. |
| `wet_bulb_related` | `T2MWET` | No ECMWF natural-wet-bulb field in this contract; `2d` remains dew point | NASA POWER: source-reported temperature unit, currently represented by the adapter as °C; ECMWF `2d`: K | °C for the retained NASA POWER parameter; no wet-bulb normalization for ECMWF `2d` | Preserve NASA POWER `T2MWET` as source-specific wet-bulb-related information. No conversion of ECMWF `2d` into wet-bulb temperature. | Source-specific environmental/model-derived parameter | `T2MWET` is not measured natural wet-bulb temperature and is not a validated natural-wet-bulb input for official WBGT. |

Native units in this table describe the current repository mapping and the source semantics that must be verified against source metadata at ingestion time. Raw source values and raw unit strings remain authoritative for auditability.

---

## 4. Temperature contract

The canonical temperature variable is `air_temperature`.

### NASA POWER

- Source variable: `T2M`
- Meaning: NASA POWER air temperature at the source-defined 2 m level
- Preserve the native source value first.
- Preserve the native source unit and source metadata.
- Future normalization may produce degrees Celsius.

### ECMWF

- Source variable: `2t`
- Meaning: ECMWF 2 m air temperature forecast field
- Preserve the native ECMWF value first.
- Preserve the native ECMWF unit, normally Kelvin for this field.
- Future normalization may convert the value to degrees Celsius.

Raw source data must never be altered in place. A normalized Celsius value must be stored as a separate representation linked to the original value and provenance.

---

## 5. Dew-point contract

The canonical dew-point variable is `dew_point_temperature`.

### NASA POWER

- Source variable: `T2MDEW`
- Preserve the native value first.
- Preserve the native source unit and metadata.
- Future normalization may produce degrees Celsius.

### ECMWF

- Source variable: `2d`
- Preserve the native ECMWF value first.
- Preserve the native ECMWF unit, normally Kelvin for this field.
- Future normalization may produce degrees Celsius.

ECMWF `2d` must remain identified as dew-point temperature. It must not be relabeled as natural wet-bulb temperature.

---

## 6. Relative-humidity contract

### NASA POWER

- Source variable: `RH2M`
- Preserve the NASA POWER value and native source metadata.
- The value may be normalized to a canonical percentage representation in a later normalization stage.

### ECMWF

ECMWF relative humidity is not a raw field in this contract.

Relative humidity will be derived later from:

- `2t`, air temperature
- `2d`, dew-point temperature

The derivation belongs in the **normalization layer**, after raw ECMWF parsing and before quality-controlled thermal calculations.

The raw ECMWF adapter must:

- Preserve raw `2t`
- Preserve raw `2d`
- Preserve native units
- Preserve timestamps and forecast metadata
- Preserve source/grid coordinates
- Avoid calculating relative humidity
- Avoid inventing an ECMWF `relative_humidity` field

Any future derived ECMWF relative-humidity value must retain provenance linking it to both source variables and the exact scientific relationship used.

---

## 7. Wind contract

### NASA POWER

- Source variable: `WS10M`
- Preserve the native source value first.
- Future normalization produces wind speed in m/s after source-unit verification.

### ECMWF

- Source variables: `10u` and `10v`
- Preserve both raw components exactly as received.
- Preserve their native units and forecast metadata.
- Do not replace either component with a derived speed in the raw source layer.

Future wind-speed derivation is:

```text
wind_speed = sqrt(10u² + 10v²)
```

The derived value belongs in the normalization layer and must be marked as derived from `10u` and `10v`.

The future normalized wind-speed unit is m/s.

---

## 8. Solar-radiation contract

### NASA POWER

- Source variable: `ALLSKY_SFC_SW_DWN`
- Preserve the native source value and unit first.
- The current repository mapping represents the value as a radiation rate in W/m², subject to verification against the source metadata for the requested product and temporal mode.

### ECMWF

- Source variable: `ssrd`
- `ssrd` is accumulated surface solar radiation downward.
- The native ECMWF quantity is accumulated energy in J/m².
- The raw value must be preserved unchanged.
- The raw `stepRange` must be preserved unchanged.

ECMWF `ssrd` must **not** be blindly divided by 3600.

Conversion to W/m² is allowed only after the exact accumulation interval is known from ECMWF metadata, including the actual `stepRange` and any associated accumulation semantics. The calculation must use the verified duration of that accumulation interval, not an assumed one-hour interval.

The pipeline must preserve:

- Raw `ssrd`
- Raw native units
- `stepRange`
- Forecast initialization time
- Forecast valid time
- Forecast step
- Any available accumulation start and end metadata

Missing radiation must remain missing. It must never be replaced with zero or fabricated data.

---

## 9. Wet-bulb contract

NASA POWER `T2MWET` may be retained as wet-bulb-related information.

It must not be represented as:

- Measured natural wet-bulb temperature
- A local wet-bulb observation
- A scientifically validated natural-wet-bulb input for official WBGT

ECMWF `2d` is dew-point temperature, not natural wet-bulb temperature.

This contract does not define an official WBGT natural-wet-bulb or globe-temperature input. The repository's existing scientific limitation remains applicable: a proxy must not be presented as official WBGT without measured globe temperature or a validated radiation/globe-temperature method.

---

## 10. Spatial contract

Every record must preserve the requested coordinates:

- Requested latitude
- Requested longitude

Where available, every record must also preserve source spatial metadata:

- Source grid latitude
- Source grid longitude
- Grid identifier or resolution
- Nearest-grid selection metadata
- Distance or selection information if supplied by the source adapter
- Any source-specific spatial reference

For ECMWF, nearest-grid metadata must be retained, including the selected grid latitude and longitude and any available grid index or equivalent identifier.

A coarse model-grid value must never be described as an exact local station observation. Requested coordinates identify the retrieval request; they do not necessarily identify the source's physical grid cell or a measuring station.

Spatial alignment and any future interpolation or remapping must occur after raw ingestion and must be explicitly recorded. No interpolation is authorized by this documentation step.

---

## 11. Temporal contract

The pipeline must preserve source temporal semantics without silently changing timestamps.

Every record must preserve the source timestamp where available.

For ECMWF, every forecast record must preserve:

- Forecast initialization time
- Forecast valid time
- Forecast step
- Actual radiation accumulation `stepRange`
- Any source-provided accumulation start and end information

For NASA POWER, the source timestamp and requested time standard must be preserved. The current repository adapter requests UTC and must retain the source timestamp as received.

Retrieval time is distinct from source observation time, forecast initialization time, and forecast valid time. These timestamps must not be substituted for one another.

No adapter may silently:

- Convert a forecast valid time into a retrieval time
- Replace a source timestamp with the browser clock
- Infer an accumulation interval from a forecast step alone
- Discard `stepRange`
- Change the source time zone or time standard without recording the conversion

---

## 12. Source/provenance contract

Every normalized value must eventually retain, directly or through an immutable link to its raw record:

- Source ID
- Source name
- Source variable
- Native unit
- Native value
- Source timestamp
- Retrieval time where available
- Requested latitude and longitude
- Source/grid latitude and longitude where available
- Forecast/reference status
- Quality status

For derived values, provenance must additionally identify:

- Input source variables
- Input record identifiers
- Scientific transformation
- Transformation version or implementation identifier
- Normalized unit
- Derivation timestamp where appropriate

The existing repository adapter expectations for source, variable, timestamp, units, coordinates, data type, retrieval time, and quality status remain part of this contract.

---

## 13. Missing-value contract

### NASA POWER

NASA POWER `-999` and equivalent fill values must become `null` during parsing.

NASA POWER fill values must never enter:

- Thermal calculations
- Normalization formulas
- Source-agreement calculations
- Quality-controlled derived values

A null value must remain explicitly missing.

### ECMWF

Unavailable or missing ECMWF values must remain missing.

Missing values must not be:

- Replaced by zero
- Replaced by a value from another source without explicit source labeling
- Silently interpolated
- Silently forward-filled
- Fabricated or estimated without a separately documented scientific method

Later calculations may use validated available components only where the scientific calculation explicitly permits it. For example, a wind-speed derivation requires both valid `10u` and `10v`; if either required component is missing, the derived speed must remain missing.

Quality status must identify missing required fields and must not describe a record as complete when required source inputs are unavailable.

---

## 14. Raw versus normalized architecture

The future pipeline is:

```text
RAW SOURCE DATA
        ↓
NORMALIZATION
        ↓
QUALITY CONTROL
        ↓
TEMPORAL/SPATIAL ALIGNMENT
        ↓
SOURCE AGREEMENT
        ↓
THERMAL INDEX ENGINE
        ↓
HTSI
```

### RAW SOURCE DATA

Raw source data contains values and metadata as received from the source, including native units, source variable names, timestamps, coordinates, forecast metadata, and source-specific fields such as `stepRange`.

Raw adapters must remain source-specific and must not calculate HTSI, WBGT, UTCI, heat index, source agreement, or other thermal indicators.

### NORMALIZATION

Normalization creates separate canonical representations. It may perform scientifically justified unit conversion or derivation after preserving raw values and metadata.

Examples include:

- Kelvin to degrees Celsius
- ECMWF wind components to wind speed
- ECMWF air temperature and dew point to derived relative humidity
- Accumulated radiation to average W/m² when the exact accumulation duration is known

### QUALITY CONTROL

Quality control evaluates completeness, validity, source status, missing values, metadata consistency, and scientific usability. It must not conceal missing data.

### TEMPORAL/SPATIAL ALIGNMENT

Alignment may associate records from different sources only after preserving each source's original temporal and spatial metadata. Alignment must not imply that sources are identical observations.

### SOURCE AGREEMENT

Source agreement or disagreement is a later analysis step. It must preserve the source identity and must not overwrite source-specific values.

### THERMAL INDEX ENGINE and HTSI

Only validated, appropriately normalized, quality-controlled inputs may be passed to thermal-index calculations and eventually to HTSI.

Raw source data must never be overwritten by normalized values.

---

## 15. HTSI boundary

This contract does not calculate HTSI.

At this stage:

- ECMWF must not be connected directly to HTSI.
- NASA POWER must not be silently replaced by ECMWF.
- NASA POWER and ECMWF values must not simply be averaged.
- Source agreement and disagreement will be handled later.
- No thermal-index value may be calculated from this documentation step.
- No forecast value may be presented as an observation.
- No environmental/model-derived value may be presented as a local station observation.

This document defines the future data boundary only. It does not authorize changes to the existing HTSI engine or thermal-index modules.

---

## 16. Scientific limitations

The future multi-source pipeline must document at least these limitations:

### Model and grid differences

NASA POWER and ECMWF may represent different products, models, grids, processing systems, spatial resolutions, and temporal aggregations. Values for the same nominal variable are not necessarily interchangeable.

### Forecast versus environmental-data differences

ECMWF Open Data is forecast/model data associated with initialization and valid times. NASA POWER values have their own product and processing semantics. A forecast value and an environmental-data value must not be assumed to be simultaneous observations or equivalent measurements.

### Temporal differences

Sources may differ in timestamp convention, temporal aggregation, forecast step, accumulation period, latency, and retrieval time. These differences must remain visible in provenance.

### Spatial differences

A requested latitude and longitude may map to different source grids or products. A nearest ECMWF grid value is not an exact local station observation. Spatial resolution and grid-selection metadata must be retained.

### Solar-radiation accumulation semantics

ECMWF `ssrd` is accumulated energy in J/m². Its conversion to an average rate requires the exact accumulation duration and must use the actual source metadata, including `stepRange`. A fixed or assumed one-hour conversion is not scientifically valid for all records.

### Wet-bulb and globe-temperature limitations

The sources covered by this contract do not establish validated natural wet-bulb and globe-temperature inputs for official WBGT. NASA POWER `T2MWET` is wet-bulb-related information, not measured natural wet-bulb temperature. ECMWF `2d` is dew point, not natural wet-bulb temperature.

Therefore, this contract does not establish official WBGT capability.

---

## 17. Future normalization formulas

Only the following scientifically justified future formulas are defined here.

### Wind speed from ECMWF components

```text
wind_speed = sqrt(u² + v²)
```

For this contract:

```text
wind_speed = sqrt(10u² + 10v²)
```

The result is a derived normalized value. Raw `10u` and `10v` must remain available.

### ECMWF relative humidity

ECMWF relative humidity may be derived later from air temperature and dew point using a documented saturation-vapour-pressure relationship.

The implementation must:

- Use normalized or consistently converted temperature units
- Identify the exact saturation-vapour-pressure relationship
- Preserve the source inputs `2t` and `2d`
- Record the derivation and resulting unit
- Remain in the normalization layer, not the raw ECMWF adapter

No particular approximation or numerical threshold is established by this contract.

### Accumulated radiation to average W/m²

Accumulated radiation may be converted to an average rate only when the exact accumulation duration is known:

```text
average_radiation_W_per_m2 =
    accumulated_energy_J_per_m2 / accumulation_duration_seconds
```

The accumulation duration must be established from the actual ECMWF metadata and `stepRange`. It must not be assumed from the requested forecast step.

These formulas are documentation only. They must not be implemented in JavaScript or Python as part of this step.

---

## 18. Implementation boundary

This step:

- Defines the scientific data contract.
- Documents NASA POWER and ECMWF source roles.
- Defines canonical variables and source mappings.
- Defines raw-value preservation requirements.
- Defines future normalization responsibilities.
- Defines provenance, missing-value, temporal, and spatial requirements.
- Defines the boundary between raw data, normalization, quality control, source agreement, thermal-index calculation, and HTSI.
- Adds no data.
- Adds no calculations.
- Adds no synthetic or placeholder values.

This step does not:

- Modify existing source code.
- Modify `app.js`.
- Modify `index.html`.
- Modify `style.css`.
- Modify any thermal-engine module.
- Modify `data/adapters/nasa-power.js`.
- Modify `data/adapters/ecmwf.py`.
- Modify `data/adapters/ecmwf_adapter.py`.
- Modify `api/ecmwf.py`.
- Modify `requirements.txt`.
- Add `pyproject.toml`.
- Modify GitHub Actions workflows.
- Modify Vercel configuration.
- Deploy anything.
- Connect ECMWF to HTSI.
- Calculate or invent thermal-index values.
- Add fake, placeholder, synthetic, or hard-coded weather data.
- Overwrite raw source data with normalized values.
- Add an ECMWF raw relative-humidity field.
- Treat NASA POWER or ECMWF as local ground observations without an appropriate observation source.

---

## 19. Source references

### NASA POWER

- NASA POWER documentation:  
  https://power.larc.nasa.gov/docs/

- NASA POWER Data Access Viewer:  
  https://power.larc.nasa.gov/data-access-viewer/

- NASA POWER API documentation:  
  https://power.larc.nasa.gov/docs/services/api/

- NASA POWER hourly temporal API documentation:  
  https://power.larc.nasa.gov/docs/services/api/temporal/hourly/

### ECMWF

- ECMWF Open Data:  
  https://www.ecmwf.int/en/forecasts/datasets/open-data

- ECMWF public dataset access documentation:  
  https://confluence.ecmwf.int/display/WEBAPI/Access+ECMWF+Public+Datasets

- ECMWF GRIB parameter database:  
  https://codes.ecmwf.int/grib/param-db/

- ECMWF GRIB parameter `2t`:  
  https://codes.ecmwf.int/grib/param-db/?id=167

- ECMWF GRIB parameter `2d`:  
  https://codes.ecmwf.int/grib/param-db/?id=168

- ECMWF GRIB parameter `10u`:  
  https://codes.ecmwf.int/grib/param-db/?id=165

- ECMWF GRIB parameter `10v`:  
  https://codes.ecmwf.int/grib/param-db/?id=166

- ECMWF GRIB parameter `ssrd`:  
  https://codes.ecmwf.int/grib/param-db/?id=169

- ECMWF GRIB `stepRange` metadata documentation:  
  https://confluence.ecmwf.int/display/UDOC/GRIB+API+keywords#GRIBAPIkeywords-stepRange

- ECMWF GRIB documentation:  
  https://confluence.ecmwf.int/display/GRIB/Home
