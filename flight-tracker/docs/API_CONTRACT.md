# Proposed flight API contract

This document proposes an integration contract for the frontend. **It does not describe an existing backend and does not imply that any endpoint or WebSocket service currently exists.** Align implementation on both sides before deployment. All timestamps are ISO 8601 UTC strings. Optional/unavailable metadata should be omitted or `null`; clients display it as unavailable and never infer missing flight data.

## REST

Configure the origin with `VITE_FLIGHT_API_BASE_URL`.

### `GET /flights/history`

Query parameters: `q`, `aircraftType`, `status`, `from`, `to`, `page` (1-based), `pageSize`.

Proposed response:

```json
{
  "items": [
    {
      "id": "opaque-record-id",
      "icao24": "4ca8e2",
      "callsign": "SAS842",
      "flightNumber": "SK842",
      "registration": "SE-RSD",
      "aircraftType": "commercial",
      "aircraftModel": "Airframe model",
      "operator": "Operator name",
      "origin": { "icao": "EGLL", "iata": "LHR", "name": "Airport", "latitude": 51.47, "longitude": -0.45 },
      "destination": { "icao": "ESSA", "iata": "ARN", "name": "Airport", "latitude": 59.65, "longitude": 17.92 },
      "status": "landed",
      "departureTime": "2025-02-08T10:00:00Z",
      "arrivalTime": "2025-02-08T12:00:00Z",
      "firstSeen": "2025-02-08T10:03:00Z",
      "lastSeen": "2025-02-08T11:58:00Z"
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 8
}
```

Each record may include available flight/airport/status/timestamp metadata; coordinates and telemetry are optional. `total`, `page` and `pageSize` are required for pagination.

### `GET /flights/{id}`

Returns one `HistoricalFlight` object using the same available metadata fields as a history item, including its `id`.

### `GET /flights/{id}/positions`

Returns an array ordered oldest to newest:

```json
[
  { "timestamp": "2025-02-08T10:03:00Z", "latitude": 51.47, "longitude": -0.45, "altitude": 12000, "speed": 280, "heading": 91, "verticalRate": 900 }
]
```

Position records require timestamp, latitude and longitude. Telemetry fields are optional.

## WebSocket

Configure the URL with `VITE_FLIGHT_WS_URL`. Reconnection uses bounded exponential backoff. The client accepts incremental updates without requiring a full refresh and ignores malformed records. On connect, the proposed service should send a snapshot so a newly connected browser can hydrate its map.

Proposed envelope variants:

```json
{ "type": "snapshot", "flights": [ { "id": "opaque-live-id", "icao24": "4ca8e2", "latitude": 51.31, "longitude": 4.92, "heading": 145, "positionTimestamp": "2025-02-08T10:04:00Z" } ] }
{ "type": "flight.upsert", "flight": { "id": "opaque-live-id", "latitude": 51.32, "longitude": 4.93, "updatedAt": "2025-02-08T10:04:03Z" } }
{ "type": "flight.remove", "id": "opaque-live-id" }
```

Each live record should have a stable string `id`; the frontend validates latitude/longitude ranges and merges updates by ID. A snapshot replaces the local live set, a `flight` update is merged by ID, and a remove envelope deletes that ID. Flight fields follow the `LiveFlight` TypeScript contract in `src/lib/types.ts`. The full proposed contract remains subject to backend agreement.

## Freshness, errors and security

- The UI indicates connected/reconnecting/disconnected/error states and marks the view stale after 30 seconds without a valid live update.
- REST callers surface HTTP and response-shape errors; the archive can be retried.
- Set CORS, authentication, and transport security at the service boundary. Use `wss://` and HTTPS in production.
- Do not put credentials in Vite variables intended for public clients.
