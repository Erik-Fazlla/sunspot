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
  the window, and a verdict such as "Clear of shadows for 40 of 60 min, but
  cloud cuts the sun to 28% of clear-sky strength, so the light is mostly
  diffuse: only about 11 min of direct sun."
- Sunrise, sunset and the sun's height through the day.
- A **Map / Satellite** switch. Map is a quiet drawn basemap with no shop or
  restaurant icons. Satellite puts a real aerial photo under the computed
  shadows, with an opacity slider so the shadows stay readable.
- A **sun direction indicator**: a sun icon on the side of the map the light
  comes from, with beams pointing across it and a label such as "Sun from SW,
  25° up, 48% strength". It turns with the map and moves with the slider.
- Optional map layers, remembered between visits: a warm **sunlight overlay** on
  sunlit ground, and **3D terrain** with hillshade.
- A sky that follows the time of day, and building light that comes from where
  the sun actually is.

| Map | Satellite |
| --- | --- |
| ![Drawn basemap with sun direction indicator](docs/screenshots/map-omonia.jpg) | ![Satellite basemap with computed shadows](docs/screenshots/satellite-omonia.jpg) |

Omonia, Athens, same view and time in both basemaps.

## How it works

| Part | Source |
| --- | --- |
| Map rendering | [MapLibre GL JS](https://maplibre.org/) |
| Tiles and style | [OpenFreeMap](https://openfreemap.org/) "liberty" style, OpenMapTiles schema, data from OpenStreetMap |
| Sun position | [suncalc](https://github.com/mourner/suncalc) |
| Satellite imagery (optional) | [Esri World Imagery](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9) |
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
   polygon, ignoring the building the point itself stands in. In code this is
   tested without building the polygon: the point is shaded when a line from it
   toward the sun, as long as the shadow, touches the footprint. A test checks
   that both give the same answer. The click analysis
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

Shadows are drawn from zoom 15 up, for at most 1,500 buildings nearest the map
centre. Which ones those are is worked out once per map move, not per slider
step. Measured on a desktop GPU (RTX 2060, 1686 x 960 window) in central
Athens: about 28 ms per slider step on the drawn map and 34 ms on satellite.

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

sunFactor is used in five places:

- **Sun direction label.** The "48% strength" in the indicator is the sunFactor
  of the slider's hour.

- **Weather label.** Sunny, Partly sunny or Overcast by sunFactor alone (see the
  thresholds above).

- **Effective sun minutes.** Each 5-minute sample counts `5 * sunFactor` if it
  is clear of shadows and 0 otherwise. Forty unshaded minutes at sunFactor 0.3
  are 12 effective minutes.
- **Shadow darkness.** Shadow opacity scales with sunFactor (never below a
  quarter of full strength, so the geometry stays readable under cloud).
- **Sunlight overlay.** Its opacity scales with sunFactor too.

### Which forecast row each number comes from

Open-Meteo's hourly variables use two conventions, and `parseHourly` in
`src/lib/openMeteo.ts` reads each one so that it describes the hour starting at
the timestamp:

| Variable | Open-Meteo convention | Row read for the hour starting at row i |
| --- | --- | --- |
| `cloud_cover` | instantaneous at the timestamp | i |
| `temperature_2m` | instantaneous at the timestamp | i |
| `direct_radiation` | mean of the preceding hour | i + 1 |
| `shortwave_radiation` | mean of the preceding hour | i + 1 |
| `precipitation` | sum of the preceding hour | i + 1 |
| `precipitation_probability` | chance in the preceding hour | i + 1 |

So for "14:00" the radiation and rain figures cover 14:00 to 15:00, while cloud
cover and temperature are the values at 14:00. A unit test with a fixture pins
every variable to its row. The 23:00 hour has no following row on a one-day
request, so its radiation and rain are unknown and its sunFactor falls back to
cloud cover.

### Map layers and look

**Basemap switch** (Map is the default; the choice is remembered).

- **Map.** The OpenFreeMap "liberty" style, restyled after it loads
  (`src/lib/basemap.ts`) so that shadows and sunlight are the visual focus:
  every point-of-interest layer (shops, restaurants, offices) is hidden, along
  with one-way arrows, road shields and airport icons; bus stops are hidden,
  rail and metro stations stay, small and pale; street names stay, small and
  low-contrast; land, water, roads and rail are recoloured to light neutrals.
- **Satellite.** Esri World Imagery as a raster layer above the drawn land and
  roads and below the sunlight tint, the shadows, the buildings and the labels.
  The 3D buildings turn into faint glass boxes so the real roofs show, and the
  labels switch to white with a dark halo. A **photo opacity** slider (30% to
  100%, default 85%) lets the drawn map show through and keeps the computed
  shadows readable. The imagery tiles are only requested once Satellite is
  switched on.

**Toggles.**

- **Sun direction** (on by default). A sun icon is placed on an ellipse inside
  the free part of the map, in the screen direction the sunlight comes from.
  That direction is found by projecting a point 300 m toward the sun's bearing
  onto the screen, so it stays right when the map is rotated or tilted. Beams
  run from the icon across the map, the way the light travels. The label gives
  compass direction, height above the horizon and sunFactor
  (`src/lib/sunIndicator.ts`). It is hidden when the sun is down.
- **Sunlight overlay** (off by default). One warm yellow, translucent polygon
  over the whole map, placed just below the shadow layer. Shadows cover it, so
  only sunlit ground looks tinted. It shows *how much* ground is lit, not where
  the light comes from; that is the indicator's job. Its opacity
  (`src/lib/overlay.ts`) is 0 when the sun is down, 0.12 when the sun is up
  under full cloud, and rises in a straight line to 0.35 at sunFactor 1.
- **3D terrain** (off by default). Elevation tiles drive both the terrain mesh,
  at true scale, and a hillshade layer lit from the sun's bearing. The tiles are
  requested only once the layer is switched on. Shadows are still computed for
  flat ground and are lifted 1.5 m so the terrain does not hide them. See the
  accuracy note under Known limitations.

Other details: the sky colours switch between day, golden hour and night,
buildings are lit from the sun's real bearing and height, the map renders at
the screen's `devicePixelRatio`, and the camera can pitch up to 85 degrees.

Settings are stored in `localStorage`: `sunspot:basemap`,
`sunspot:imagery-opacity`, `sunspot:sun-direction`, `sunspot:sunlight-overlay`
and `sunspot:terrain`.

### Satellite imagery and the Esri key

The Satellite basemap uses Esri World Imagery (`src/lib/imagery.ts`).

- **Without a key** (the default) tiles come from
  `server.arcgisonline.com`. This works out of the box and is meant for local
  development and personal use.
- **With a key**, set `VITE_ESRI_KEY` and every tile request goes to
  `ibasemaps-api.arcgis.com` with `?token=<key>` appended. Esri's terms expect
  public sites to use an ArcGIS account, so do this before publishing a site
  that offers the Satellite basemap.

To set the key locally, copy `.env.example` to `.env.local` and fill it in:

```
VITE_ESRI_KEY=your-key-here
```

For the GitHub Pages build, add a repository secret named `VITE_ESRI_KEY`
(**Settings > Secrets and variables > Actions**); the deploy workflow passes it
to the build, and builds without the secret simply stay keyless.

Getting a key: create a free account at
[developers.arcgis.com](https://developers.arcgis.com/), create an API key with
the basemap (location services) privilege, and **restrict it to your site's
address as an allowed referrer**. The key is compiled into the public site, so
anyone can read it; the referrer restriction is what stops others from using it.

### Weather label thresholds

The label is derived from two numbers only: the hour's sunFactor (below) and its
rain chance. The thresholds are constants in `src/lib/weatherLabel.ts`, checked
in this order:

| Label | Rule |
| --- | --- |
| Rainy | rain chance >= 60% |
| Sunny | sunFactor >= 0.7 |
| Partly sunny | sunFactor >= 0.3 |
| Overcast | anything lower |

Because the label and the "sun strength" figure come from the same sunFactor,
they cannot disagree. Thin high cloud that covers the sky but lets most of the
beam through counts as sunny, and the cloud cover percentage is shown separately.

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
  courtyards are treated as filled. On the Satellite basemap you can see the
  trees, but they do not shade anything in the calculation.
- **A satellite photo has its own shadows.** The photo was taken at one moment
  on one day, and the real shadows from that moment are part of the picture.
  The computed shadows for your chosen time are drawn on top, so in places you
  will see both. Lower the photo opacity to tell them apart. The photo can also
  be several years old.
- **Terrain is coarse.** The free elevation data is a grid of about 30 m.
  Checked against known heights in Athens: Lycabettus summit reads 244 to 258 m
  (real 277 m), the Acropolis 137 to 146 m (real 156 m), Philopappou 97 to
  112 m (real 147 m), and flat Omonia about 85 m (real about 75 m). Summits are
  shaved by 20 to 50 m and flat ground sits about 10 m high. It is drawn at
  true scale and is a visual aid only.
- **Roofs and upper floors.** Shade is computed at ground level. A marker placed
  on a building ignores that building.
- **sunFactor is an estimate.** The clear-sky model assumes clean air, and the
  forecast radiation is an hourly mean, so effective sun minutes are a guide,
  not a measurement.
- **Shadows assume flat ground, even with 3D terrain on.** The terrain layer
  only changes how the map is drawn. Shadow length and direction are still
  computed as if every building stood on a level plane at its own base, so on a
  slope a real shadow would be shorter (uphill) or longer (downhill) than the
  one shown. Hills themselves cast no shadow. The drawn shadows are flat sheets
  lifted 1.5 m above the terrain, so on steep ground parts of them can sink
  into, or float above, the surface. The spot check uses the same flat-ground
  maths whether terrain is on or off.
- **Tile edges.** A building cut by a tile boundary arrives in pieces. This does
  not change the drawn shadows but can slightly affect the click analysis at the
  seam.
- **The forecast is hourly and uncertain.** It covers 16 days, and cloud cover
  several days ahead is a rough guide. Shadows work for any date; weather does
  not.
- **Zoom.** Shadows and the click analysis need building outlines, which load
  from zoom 15. Very busy views shade only the nearest 1,500 buildings.

## Attribution

Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright)
contributors, available under the
[Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/).
Tiles and style by [OpenFreeMap](https://openfreemap.org/)
(© OpenMapTiles). Weather and geocoding by [Open-Meteo](https://open-meteo.com/).
Terrain from [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/)
(Mapzen), built from the sources listed in the
[Tilezen Joerd attribution](https://github.com/tilezen/joerd/blob/master/docs/attribution.md).
Satellite imagery: Powered by [Esri](https://www.esri.com). Sources: Esri,
Maxar, Earthstar Geographics, and the GIS User Community.
