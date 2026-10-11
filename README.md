# Sunspot

A sunlight planner on a 3D map. Pick a place, a date and a time window, and
Sunspot shows where building shadows fall during that window, what the weather
forecast says, and whether a spot you click gets direct sun.

It runs entirely in the browser. There is no backend, no API key and no paid
service, so it costs nothing to host.

## What it does

- 3D map with extruded buildings. It opens on your location, or on Athens if
  location access is unavailable. Search for any place, or use the locate button.
- Date and time-window inputs (default: tomorrow, 14:00 to 15:00). A slider
  steps through the window in 5-minute steps and can play as an animation.
- Building shadows drawn on the ground for the slider's time, recomputed for the
  buildings in view whenever the map stops moving. Shadows fade under cloud.
- Weather for the slider's hour: cloud cover, rain chance, direct radiation,
  temperature, a label (Sunny, Partly sunny, Overcast or Rainy) and the sun's
  strength compared with a clear sky.
- Click any spot for a result card with two numbers: **geometric sun** (minutes
  clear of building shadows) and **effective sun** (those minutes weighted by
  how much direct beam the weather lets through). It also shows the sun's
  altitude and bearing at the start and end, the weather label for each hour of
  the window, and a verdict such as "Clear of building shadows for 40 of 60 min,
  but with 80% cloud cover the light is mostly diffuse: only about 12 min of
  direct sun."
- Sunrise, sunset and the sun's height through the day.
- Optional map layers, remembered between visits: a warm **sunlight overlay** on
  sunlit ground, and **3D terrain** with hillshade.
- A sky that follows the time of day, and building light that comes from where
  the sun actually is.

## How it works

| Part | Source |
| --- | --- |
| Map rendering | [MapLibre GL JS](https://maplibre.org/) |
| Tiles and style | [OpenFreeMap](https://openfreemap.org/) "liberty" style, OpenMapTiles schema, data from OpenStreetMap |
| Sun position | [suncalc](https://github.com/mourner/suncalc) |
| Terrain (optional) | [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/), Mapzen terrarium elevation tiles |
| Forecast | [Open-Meteo forecast API](https://open-meteo.com/en/docs) |
| Place search | [Open-Meteo geocoding API](https://open-meteo.com/en/docs/geocoding-api) |
| Geometry | [turf](https://turfjs.org/) (union, point-in-polygon) |

### Shadow maths

Shadows are computed in the app (`src/lib/sun.ts`, `src/lib/shadow.ts`); no
shadow plugin is involved. Buildings are treated as flat-roofed prisms standing
on flat ground.

1. **Sun direction.** SunCalc 1.x reports azimuth measured from **south**,
   positive toward the west, in radians. A compass bearing starts at north and
   runs clockwise, so

   ```
   sunBearing = (azimuth in degrees + 180) mod 360
   ```

   suncalc is pinned to 1.9.0 because 2.x changed this convention (north-based
   degrees). A unit test checks the conversion, and another checks that the
   Athens sun is in the east in the morning and the south at noon.

2. **Shadow length.**

   ```
   length = height / tan(altitude)
   ```

   capped at 300 m when the sun is very low. If the altitude is zero or
   negative, there is no shadow.

3. **Shadow direction.** Directly away from the sun:
   `shadowBearing = sunBearing + 180`. The tip of the shadow is displaced
   `length * sin(shadowBearing)` metres east and `length * cos(shadowBearing)`
   metres north, converted to degrees with a local flat-earth approximation.

4. **Shadow polygon.** The shadow of a prism is its footprint swept along that
   displacement. That equals the footprint plus one quad per *leading* wall (a
   wall facing the way the shadow falls), swept along the displacement. Trailing
   walls and the translated roof outline add nothing, because any shaded point
   outside the footprint is reached through a leading wall. For convex
   footprints the convex hull of the footprint and its translated copy gives the
   same shape and is used as a fast path; concave footprints use the turf union
   of the pieces.

5. **Building height.** `render_height` or `height` from the tiles, else
   `levels * 3 m`, else a 12 m fallback (`FALLBACK_BUILDING_HEIGHT_M`).

6. **Point in shade.** A point is shaded if it is inside any building's shadow
   polygon, ignoring the building the point itself stands in. The click analysis
   samples the window every 5 minutes; each sample is direct sun, building shade,
   or sun below the horizon (counted as no sun).

### Drawing the shadows

Merging every shadow in view with a polygon union takes a second or more per
frame in a dense city, which is too slow for the slider. So the map layer draws
the un-merged shadow pieces as a **zero-height `fill-extrusion` layer** instead
of a plain `fill` layer: MapLibre paints each pixel of a translucent extrusion
layer once, so overlapping shadows do not stack into darker patches. The result
looks like a flat fill. Exact per-building polygons (with the union) are still
used for the click analysis, where only nearby buildings matter.

Shadows are drawn from zoom 15 up, for at most 2,000 buildings nearest the map
centre. Which buildings those are is worked out once per map move, not per
slider step. On a desktop GPU a slider step takes about 35 to 50 ms in a dense
city view, with every layer switched on.

### Cloud-aware sunlight (sunFactor)

Being clear of building shadows is not the same as being in the sun, so each
forecast hour gets a **sunFactor** between 0 and 1 (`src/lib/sunFactor.ts`):

```
sunFactor = forecast direct_radiation / clear-sky direct radiation
```

clamped to 0..1. The clear-sky value is an estimate for the sun's height at the
middle of that hour (Meinel model):

```
airMass      = 1 / sin(altitude)
directNormal = 1361 W/m2 * 0.7 ^ (airMass ^ 0.678)
clearSky     = directNormal * sin(altitude)      (on a horizontal surface)
```

If the forecast has no direct radiation, or the clear-sky value is under
30 W/m2 (sun below about 3 degrees, where the ratio is noise), the fallback is

```
sunFactor = 1 - cloud_cover / 100
```

sunFactor is used in three places:

- **Effective sun minutes.** Each 5-minute sample counts `5 * sunFactor` if it
  is clear of shadows and 0 otherwise. Forty unshaded minutes at sunFactor 0.3
  are 12 effective minutes.
- **Shadow darkness.** Shadow opacity scales with sunFactor (never below a
  quarter of full strength, so the geometry stays readable under cloud).
- **Sunlight overlay.** Its opacity scales with sunFactor too.

Open-Meteo reports radiation, precipitation and rain chance for the hour that
*ends* at each timestamp, and cloud cover as a snapshot. The app reads the
backward-looking values from the next row and averages cloud cover across the
hour, so every number shown for "14:00" describes 14:00 to 15:00.

### Map layers and look

- **Sunlight overlay** (off by default). One warm, translucent polygon over the
  whole map, placed just below the shadow layer. Shadows cover it, so only
  sunlit ground looks tinted. No polygon union is involved.
- **3D terrain** (off by default). Elevation tiles drive both the terrain mesh
  and a hillshade layer lit from the sun's bearing. The tiles are requested only
  once the layer is switched on. Shadows are still computed for flat ground and
  are lifted 1.5 m so the terrain does not hide them.
- **Sky and light.** The sky colours switch between day, golden hour and night,
  and buildings are lit from the sun's real bearing and height.
- The map renders at the screen's `devicePixelRatio`, and the camera can pitch
  up to 85 degrees.

Both toggles are stored in `localStorage` (`sunspot:sunlight-overlay`,
`sunspot:terrain`).

The base style stays OpenFreeMap "liberty": it is already the most detailed of
the OpenFreeMap styles (landuse, points of interest, transit, 3D buildings).

### Weather label thresholds

Defined and documented in `src/lib/weatherLabel.ts`, checked in this order:

| Label | Rule |
| --- | --- |
| Rainy | precipitation >= 0.2 mm in the hour, or rain chance >= 60% |
| Overcast | cloud cover >= 80%, or in daylight under 15% of solar radiation is a direct beam |
| Sunny | cloud cover <= 25% and, in daylight, at least half of solar radiation is a direct beam |
| Partly sunny | everything else |

"In daylight" means total shortwave radiation of at least 20 W/m².

### Time zones

Dates and times are wall-clock values in the selected place's timezone (default
Europe/Athens). The timezone comes from the search result, or from Open-Meteo
for a location or clicked point. The forecast is requested with
`timezone=auto`, so its hours are already local. Local times are converted to
UTC instants only for the sun calculations (`src/lib/time.ts`).

### Caching

Forecast responses are cached in memory per (latitude, longitude, date), with
coordinates rounded to 0.01 degrees. The cache lasts until the page reloads.

## Setup

Requires Node.js 20 or newer.

```bash
npm install
npm run dev
```

Then open the URL Vite prints (http://localhost:5173 by default).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Type-check and build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Run the unit tests once (Vitest) |
| `npm run test:watch` | Run the tests in watch mode |
| `npm run typecheck` | Type-check only |
| `npm run lint` | Lint with oxlint |

The tests cover the azimuth conversion, shadow length and direction, shadow
polygons, the point-in-shade test, the weather label rules, sunFactor and the
clear-sky estimate, effective sun minutes, the verdict wording, timezone
handling and the click analysis.

## Deployment to GitHub Pages

`.github/workflows/deploy.yml` tests, builds and deploys on every push to
`main`.

1. Push the repository to GitHub.
2. In the repository, open **Settings > Pages** and set **Source** to
   **GitHub Actions**.
3. Push to `main` (or run the workflow by hand from the **Actions** tab).

The site appears at `https://<user>.github.io/<repo>/`. The workflow passes the
repository name to Vite as `BASE_PATH`, which `vite.config.ts` uses for `base`,
so asset URLs are correct under that sub-path without editing any file. For a
custom domain or a user page served from `/`, remove the `BASE_PATH` line.

GitHub Pages is free for public repositories. For a private repository it needs
a paid GitHub plan.

## Known limitations

- **Heights are approximate.** OpenStreetMap building heights are incomplete.
  Where a height is missing, the tiles supply a default or an estimate from the
  number of levels, so shadow lengths are approximate.
- **Only buildings cast shadows.** Trees, terrain (hills) and roof shapes are
  not modelled. Every building is a flat-roofed box on flat ground, and
  courtyards are treated as filled.
- **Roofs and upper floors.** Shade is computed at ground level. A marker placed
  on a building ignores that building.
- **sunFactor is an estimate.** The clear-sky model assumes clean air, and the
  forecast radiation is an hourly mean, so effective sun minutes are a guide,
  not a measurement.
- **Terrain is visual.** Hills do not cast shadows, and with 3D terrain on,
  building shadows on steep slopes can be partly clipped by the ground.
- **Tile edges.** A building cut by a tile boundary arrives in pieces. This does
  not change the drawn shadows but can slightly affect the click analysis at the
  seam.
- **The forecast is hourly and uncertain.** It covers 16 days, and cloud cover
  several days ahead is a rough guide. Shadows work for any date; weather does
  not.
- **Zoom.** Shadows and the click analysis need building outlines, which load
  from zoom 15. Very busy views shade only the nearest 2,000 buildings.

## Attribution

Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright)
contributors. Tiles and style by [OpenFreeMap](https://openfreemap.org/)
(© OpenMapTiles). Weather and geocoding by [Open-Meteo](https://open-meteo.com/).
Terrain from [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/)
(Mapzen), built from the sources listed in the
[Tilezen Joerd attribution](https://github.com/tilezen/joerd/blob/master/docs/attribution.md).
