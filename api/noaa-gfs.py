import json
import math
import os
import tempfile
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta

NOMADS = "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl"
SFLUX = "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_sflux.pl"
SFLUX = "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_sflux.pl"


def _get(url):
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "ThermaShield360/1.0"}
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def _find_cycle(now, lat, lon):
    now = now.astimezone(timezone.utc)
    cycle_hour = (now.hour // 6) * 6
    base = now.replace(
        hour=cycle_hour,
        minute=0,
        second=0,
        microsecond=0,
    )

    for back in range(0, 8):
        t = base - timedelta(hours=6 * back)
        cycle = t.strftime("%H")
        date_text = t.strftime("%Y%m%d")

        test_url = (
            f"{NOMADS}?file=gfs.t{cycle}z.pgrb2.0p25.f003"
            f"&var_TMP=on"
            f"&lev_2_m_above_ground=on"
            f"&leftlon={lon - 0.5}"
            f"&rightlon={lon + 0.5}"
            f"&toplat={lat + 0.5}"
            f"&bottomlat={lat - 0.5}"
            f"&dir=%2Fgfs.{date_text}%2F{cycle}%2Fatmos"
        )

        try:
            _get(test_url)
            return date_text, int(cycle)
        except Exception:
            continue

    raise RuntimeError(
        "No current GFS 0.25 degree forecast file is available."
    )


def _parse_grib(blob, requested_lat, requested_lon):
    from eccodes import (
        codes_grib_new_from_file,
        codes_get,
        codes_get_array,
        codes_release,
    )

    temp_path = None

    try:
        with tempfile.NamedTemporaryFile(
            mode="wb",
            suffix=".grib2",
            delete=False
        ) as temp:
            temp.write(blob)
            temp.flush()
            temp_path = temp.name

        records = {}

        with open(temp_path, "rb") as f:
            while True:
                handle = codes_grib_new_from_file(f)

                if handle is None:
                    break

                try:
                    short_name = str(
                        codes_get(handle, "shortName")
                    ).strip().lower()

                    level = codes_get(handle, "level")

                    values = codes_get_array(
                        handle,
                        "values"
                    )

                    latitudes = codes_get_array(
                        handle,
                        "latitudes"
                    )

                    longitudes = codes_get_array(
                        handle,
                        "longitudes"
                    )

                    wanted_level = (
                        (short_name in ("2t", "2d", "2r")
                         and level == 2)
                        or
                        (short_name in ("10u", "10v")
                         and level == 10)
                        or
                        (short_name == "dswrf")
                    )

                    if not wanted_level:
                        continue

                    best = min(
                        range(len(values)),
                        key=lambda i:
                            (
                                (float(latitudes[i]) - requested_lat) ** 2
                                +
                                (float(longitudes[i]) - requested_lon) ** 2
                            )
                    )

                    records[short_name] = {
                        "value": float(values[best]),
                        "units": codes_get(handle, "units"),
                        "latitude": float(latitudes[best]),
                        "longitude": float(longitudes[best]),
                        "end_step": codes_get(handle, "endStep"),
                        "validity_date": codes_get(
                            handle,
                            "validityDate"
                        ),
                        "validity_time": codes_get(
                            handle,
                            "validityTime"
                        ),
                    }

                finally:
                    codes_release(handle)

        return records

    finally:
        if temp_path and os.path.exists(temp_path):
            os.unlink(temp_path)


def _fetch_sflux_dswrf(date_text, cycle, lat, lon, forecast_step):
    try:
        step = int(forecast_step)

        query = {
            "file": (
                f"gfs.t{cycle:02d}z."
                f"sfluxgrbf{step:03d}.grib2"
            ),
            "leftlon": lon - 0.5,
            "rightlon": lon + 0.5,
            "toplat": lat + 0.5,
            "bottomlat": lat - 0.5,
            "dir": f"/gfs.{date_text}/{cycle:02d}/atmos",
        }

        url = (
            SFLUX
            + "?"
            + urllib.parse.urlencode(query)
        )

        blob = _get(url)

        records = _parse_grib(
            blob,
            lat,
            lon
        )

        return records.get("dswrf")

    except Exception:
        return None


def _fetch_sflux_dswrf(date_text, cycle, lat, lon, forecast_step=3):
    query = {
        "file": f"gfs.t{cycle:02d}z.sfluxgrbf{forecast_step:03d}.grib2",
        "var_DSWRF": "on",
        "lev_surface": "on",
        "leftlon": lon - 0.5,
        "rightlon": lon + 0.5,
        "toplat": lat + 0.5,
        "bottomlat": lat - 0.5,
        "dir": f"/gfs.{date_text}/{cycle:02d}/atmos",
    }
    url = SFLUX + "?" + urllib.parse.urlencode(query)
    return _parse_grib(_get(url), lat, lon)

def _gfs_handler(request):
    try:
        params = getattr(request, "args", {}) or {}

        lat = float(params.get("latitude"))
        lon = float(params.get("longitude"))

        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            raise ValueError(
                "Invalid latitude/longitude."
            )

        now = datetime.now(timezone.utc)

        date_text, cycle = _find_cycle(
            now,
            lat,
            lon
        )

        query = {
            "file": (
                f"gfs.t{cycle:02d}z."
                f"pgrb2.0p25.f003"
            ),
            "var_TMP": "on",
            "var_DPT": "on",
            "var_UGRD": "on",
            "var_VGRD": "on",
            "var_RH": "on",
            "lev_2_m_above_ground": "on",
            "lev_10_m_above_ground": "on",
            "leftlon": lon - 0.5,
            "rightlon": lon + 0.5,
            "toplat": lat + 0.5,
            "bottomlat": lat - 0.5,
            "dir": (
                f"/gfs.{date_text}/"
                f"{cycle:02d}/atmos"
            ),
        }

        url = (
            NOMADS
            + "?"
            + urllib.parse.urlencode(query)
        )

        blob = _get(url)

        records = _parse_grib(
            blob,
            lat,
            lon
        )

        if not records:
            raise RuntimeError(
                "GFS response contained no usable "
                "requested variables."
            )

        first_key = next(iter(records))

        forecast_step = records[
            first_key
        ]["end_step"]

        dswrf = _fetch_sflux_dswrf(
            date_text,
            cycle,
            lat,
            lon,
            forecast_step
        )

        if dswrf is not None:
            records["dswrf"] = dswrf

        def celsius(key):
            if key not in records:
                return None

            return (
                records[key]["value"]
                - 273.15
            )

        u = records.get(
            "10u",
            {}
        ).get("value")

        v = records.get(
            "10v",
            {}
        ).get("value")

        wind = (
            math.hypot(u, v)
            if u is not None and v is not None
            else None
        )

        rh = records.get(
            "2r",
            {}
        ).get("value")

        solar = records.get(
            "dswrf",
            {}
        ).get("value")

        grid_lat = records[
            first_key
        ]["latitude"]

        grid_lon = records[
            first_key
        ]["longitude"]

        valid_time = datetime.strptime(
            (
                f"{records[first_key]['validity_date']}"
                f"{records[first_key]['validity_time']:04d}"
            ),
            "%Y%m%d%H%M"
        ).replace(
            tzinfo=timezone.utc
        ).isoformat().replace(
            "+00:00",
            "Z"
        )

        result = {
            "source": "NOAA GFS",
            "source_id": "noaa_gfs_0p25",
            "data_type": "forecast",
            "model": "GFS",
            "resolution": "0.25 degree",

            "requested_coordinates": {
                "latitude": lat,
                "longitude": lon,
            },

            "grid_coordinates": {
                "latitude": grid_lat,
                "longitude": grid_lon,
            },

            "forecast_initialization_time_utc": (
                f"{date_text[:4]}-"
                f"{date_text[4:6]}-"
                f"{date_text[6:]}T"
                f"{cycle:02d}:00:00Z"
            ),

            "valid_time_utc": valid_time,

            "forecast_step_hours": forecast_step,

            "environment": {
                "air_temperature_c": celsius("2t"),
                "dew_point_c": celsius("2d"),
                "wind_u_ms": u,
                "wind_v_ms": v,
                "wind_speed_ms": wind,
                "relative_humidity_pct": rh,
                "solar_radiation_wm2": solar,
            },

            "provenance": {
                "provider": "NOAA / NCEP",
                "endpoint": NOMADS,
                "sflux_endpoint": SFLUX,
                "sflux_endpoint": SFLUX,
                "variables": sorted(
                    records.keys()
                ),
                "retrieved_at": (
                    now.isoformat()
                    .replace("+00:00", "Z")
                ),
            },

            "quality": {
                "status": "raw_grib_nearest_grid_point",

                "missing_fields": [
                    key
                    for key, value in {
                        "air_temperature_c":
                            celsius("2t"),
                        "dew_point_c":
                            celsius("2d"),
                        "wind_u_ms":
                            u,
                        "wind_v_ms":
                            v,
                        "wind_speed_ms":
                            wind,
                        "relative_humidity_pct":
                            rh,
                        "solar_radiation_wm2":
                            solar,
                    }.items()
                    if value is None
                ],
            },
        }

        body = json.dumps(result)

        return {
            "statusCode": 200,
            "headers": {
                "Content-Type":
                    "application/json",
                "Cache-Control":
                    "no-store, no-cache, must-revalidate",
            },
            "body": body,
        }

    except Exception as exc:
        body = json.dumps({
            "source": "NOAA GFS",
            "source_id": "noaa_gfs_0p25",
            "status": "error",
            "error": str(exc),
        })

        return {
            "statusCode": 502,
            "headers": {
                "Content-Type":
                    "application/json",
                "Cache-Control":
                    "no-store",
            },
            "body": body,
        }


from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs


class handler(BaseHTTPRequestHandler):

    def do_GET(self):
        params = {
            k: v[0]
            for k, v in parse_qs(
                urlparse(self.path).query
            ).items()
        }

        request = type(
            "Request",
            (),
            {"args": params}
        )()

        result = _gfs_handler(request)

        status = (
            result.get("statusCode", 200)
            if isinstance(result, dict)
            else 200
        )

        body = (
            result.get("body", "")
            if isinstance(result, dict)
            else str(result)
        )

        self.send_response(status)

        self.send_header(
            "Content-Type",
            "application/json"
        )

        self.send_header(
            "Access-Control-Allow-Origin",
            "*"
        )

        self.send_header(
            "Cache-Control",
            "no-store, no-cache, must-revalidate"
        )

        self.end_headers()

        self.wfile.write(
            body.encode("utf-8")
            if isinstance(body, str)
            else body
        )
