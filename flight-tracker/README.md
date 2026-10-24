# Skytrace — Flight Operations

Responsive aviation command-center frontend for scanning live aircraft and inspecting recorded journeys. Built with React, TypeScript, Vite, MapLibre GL JS, TanStack Query, Wouter and Tailwind CSS.

## Run

1. Install workspace dependencies, including `maplibre-gl`.
2. Copy `.env.example` values into your local environment and configure the live WebSocket and REST service.
3. Start the Vite dev server with the workspace workflow.

`VITE_FLIGHT_WS_URL` and `VITE_FLIGHT_API_BASE_URL` are optional at boot; with either absent, the corresponding surface displays a clear disconnected/configuration state. The application does not silently show sample data when a service is unavailable.

To intentionally inspect the UI without a backend, set `VITE_ENABLE_MOCK_DATA=true`. All simulated aircraft, positions and sample journeys are visibly labeled as simulation data. The default is `false`.

The map uses the OpenStreetMap raster tile service and displays OpenStreetMap attribution. A MapLibre-compatible style URL may be supplied with `VITE_MAP_STYLE_URL`; use a style provider and tile usage policy appropriate for your deployment.

## Frontend modules

- `src/lib/types.ts`: shared flight, airport and position contracts plus validation helpers.
- `src/lib/live-socket.ts`: reconnecting WebSocket client and message validation.
- `src/lib/api.ts`: REST request module and response validation.
- `src/hooks/use-live-flights.ts`: incremental live flight state and freshness reporting.
- `src/components/flight-map.tsx`: MapLibre map, clustered aircraft, heading symbols, selection, route line, and controls.
- `src/pages/live.tsx`: live traffic map/list/detail synchronization.
- `src/pages/history.tsx`: filterable/paginated archive search and journey playback.
- `docs/API_CONTRACT.md`: proposed backend integration contract. It is a proposal, not an existing service specification.

No backend, database, ingestion or flight-processing algorithms are included.
