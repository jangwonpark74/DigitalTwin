# Product design review and open 3D map proposal

Reviewed and implemented on October 1, 2026.

## Assessment

The original interface exposed migration terminology, treated configuration forms as the main experience, and combined dark feature styles with a light application shell. Several planner headings became nearly invisible on white panels. The city explorer offered repetitive generated towers on an empty ellipsoid; real buildings required a token. That made the scene hard to recognize and difficult to trust.

The commercial direction is a spatial planning workbench: consistent navigation and project context, a map as the visual focal point, a compact inspector, and a clear distinction between delivered geometry, planning assumptions, and simulation evidence.

## Implemented design

- Full-height forest navigation, warm neutral workspaces, one primary action color, shared typography, consistent borders, and restrained shadows.
- Clear project context and breadcrumbs, a compact planning status, and task-oriented mission control cards. The migration banner is removed from the product interface.
- Collapsible mobile navigation that closes after selecting a workspace, keyboard access, focus indicators, a skip link, and reduced-motion camera transitions.
- A prominent **City map → Explore 3D city** entry point. The Silicon Valley map pairs a large viewport with location, layer, building, and source inspectors. Project editing remains in the project view.
- Real building footprints, height-based shading, street labels, metric scale, 3D/2D camera views, reset, building selection/highlighting, and keyboard-accessible building inspection.
- Loading, tile-error, retry, and unavailable-WebGL states. A “connected” state requires delivered building geometry; an empty canvas does not prove success.
- Light-theme corrections for site planning, project cards, and artifact browsing.

## Recommended rendering architecture

| Purpose | Renderer and data | Decision |
| --- | --- | --- |
| City exploration and urban context | MapLibre GL + OpenFreeMap / OpenMapTiles / OpenStreetMap vector tiles | Implemented as the primary city explorer. No token required. |
| Project RF geometry and solver paths | CesiumJS + validated local WGS84 geometry and provenance-labelled path results | Retained as the project view. City browsing never changes these inputs. |
| Survey-grade or photorealistic scenes | Cesium 3D Tiles from licensed photogrammetry, LiDAR, or a validated city model | Future data pipeline; requires a defined accuracy target and source coverage. |

[MapLibre's official 3D example](https://maplibre.org/maplibre-gl-js/docs/examples/display-buildings-in-3d/) uses extruded building geometry with OpenFreeMap. [OpenFreeMap](https://openfreemap.org/) supports commercial use, requires attribution, and does not require registration or an API key. Its public service provides no SLA; a production deployment should use a contracted provider or self-hosted, versioned tiles when uptime is a requirement.

The implemented scene is an **extruded vector map (2.5D)**. It does not reproduce roof shapes, façades, surveyed heights, or calibrated RF materials. Height values come from the tile pipeline and may be estimated; missing values use a disclosed 6 m display fallback. Tile feature IDs are not guaranteed to be OSM object IDs. The count deduplicates polygon parts returned by the renderer, including parts from merged features. Tile clipping can split a building into several parts, so this is not a unique building count. Picking isolates one footprint from a merged feature.

The real sample locations are downtown Palo Alto (University Avenue), Mountain View (Castro Street), and San Jose (Santa Clara Street). These are explicit public example coordinates. The explorer does not attach the user's radio sites, project coordinates, or credentials to map requests. Basemap source attribution stays visible.

## Validation

The live browser test uses actual public vector tiles, with no map response stubs. It checks successful geometry responses, nonempty rendered building geometry, a full-size WebGL canvas, actual building picking, 3D/2D controls, layer visibility, all three locations, mobile overflow, clean page errors, and zero project API writes. Screenshots cover each city and the 390 px mobile layout.

Separate tests cover blocked tile requests, retry and renderer disposal, delayed imports after unmount, unavailable WebGL, keyboard inspection, independent camera/layer state, and mobile navigation. The existing project persistence, planning-only semantics, and Cesium city tests remain in the regression suite.

The visual tour covers 18 workspaces at 1440 px, checks visible heading contrast and horizontal overflow, and saves each screen. The local Python server now accepts a larger burst of pending asset connections so Chromium can load split bundles without the observed connection resets.

Visual evidence: [mission control](design-review/overview-desktop.png), [site and cell planning](design-review/planner-desktop.png), [Palo Alto](design-review/palo-alto-3d.png), [Mountain View](design-review/mountain-view-3d.png), [San Jose](design-review/san-jose-3d.png), and [390 px mobile](design-review/silicon-valley-mobile.png).

Final validation on October 1, 2026:

| Check | Result |
| --- | --- |
| JavaScript domain and presenter tests | 89 passed |
| Python storage and server tests | 24 passed |
| React and TypeScript component contracts | 207 passed across 62 files |
| API proxy and production server integration | 2 passed |
| Full Chromium browser regression suite | 29 passed in 60.0 seconds |
| Strict TypeScript, production build, and diff whitespace | Passed |

On the default-project Chromium fixture at 1280 × 577, median route switching was 74.2 ms, first local Cesium view was 2.33 seconds, and typing to the next frame was 6.5 ms. Five repeated scene-navigation cycles left one Cesium viewer and a lower post-GC JavaScript heap. These are local fixture observations, not a production performance guarantee or proof that every allocation is leak-free.

Run the full verification with:

```bash
make check
PLAYWRIGHT_PORT=5175 npm run test:e2e
```

MapLibre is loaded on demand when the city explorer opens. Its renderer is approximately 1 MB minified before compression, so Vite reports a large-chunk advisory; the renderer is split from the initial application bundle. Public map tests need network access and WebGL. Rendered source heights are visual context, not engineering validation.
