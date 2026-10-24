"""Publish Spark's committed Parquet output to the flight-tracker WebSocket."""
import asyncio
import json
import logging
import math
import os
from contextlib import asynccontextmanager, suppress
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pyarrow.parquet as parquet
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

PROJECT_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(PROJECT_ROOT / ".env")

OUTPUT_PATH = Path(
    os.environ.get("CLEANER_OUTPUT_PATH", "Data/cleaned-kalman-stream")
).expanduser()
if not OUTPUT_PATH.is_absolute():
    OUTPUT_PATH = PROJECT_ROOT / OUTPUT_PATH

POLL_INTERVAL_SECONDS = float(os.environ.get("FLIGHT_WS_POLL_INTERVAL", "1"))
PORT = int(os.environ.get("FLIGHT_WS_PORT", "8765"))
EARTH_RADIUS_METERS = 6_371_000.0
LATITUDE_FIELDS = (
    "icao24",
    "callsign",
    "time_position",
    "latitude",
    "longitude",
    "smoothed_latitude",
    "smoothed_longitude",
    "smoothed_x",
    "smoothed_y",
    "kalman_updated",
    "geo_altitude",
    "baro_altitude",
    "velocity",
    "true_track",
    "vertical_rate",
    "squawk",
    "on_ground",
)

log = logging.getLogger("flight_ws_bridge")
clients: set[WebSocket] = set()
latest_flights: dict[str, dict[str, Any]] = {}
seen_files: set[Path] = set()


def _utc_timestamp(epoch_seconds: int | float) -> str:
    return datetime.fromtimestamp(epoch_seconds, timezone.utc).isoformat().replace(
        "+00:00", "Z"
    )


def _optional_scaled(value: Any, scale: float) -> float | None:
    if value is None:
        return None
    return float(value) * scale


def build_flight_payload(record: dict[str, Any]) -> dict[str, Any] | None:
    """Map one cleaned row to the frontend's LiveFlight contract."""
    icao24 = record.get("icao24")
    time_position = record.get("time_position")
    raw_latitude = record.get("latitude")
    raw_longitude = record.get("longitude")
    if not icao24 or time_position is None or raw_latitude is None or raw_longitude is None:
        return None

    smoothed_latitude = record.get("smoothed_latitude")
    smoothed_longitude = record.get("smoothed_longitude")
    kalman_value = record.get("kalman_updated")
    kalman_updated = bool(kalman_value) if kalman_value is not None else None
    latitude = (
        float(smoothed_latitude)
        if kalman_updated is True and smoothed_latitude is not None
        else float(raw_latitude)
    )
    longitude = (
        float(smoothed_longitude)
        if kalman_updated is True and smoothed_longitude is not None
        else float(raw_longitude)
    )

    altitude_meters = record.get("geo_altitude")
    if altitude_meters is None:
        altitude_meters = record.get("baro_altitude")

    flight = {
        "id": str(icao24),
        "icao24": str(icao24),
        "callsign": record.get("callsign"),
        "latitude": latitude,
        "longitude": longitude,
        "rawLatitude": float(raw_latitude),
        "rawLongitude": float(raw_longitude),
        "positionTimestamp": _utc_timestamp(time_position),
        "updatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "altitude": _optional_scaled(altitude_meters, 3.28084),
        "speed": _optional_scaled(record.get("velocity"), 1.943844),
        "heading": record.get("true_track"),
        "verticalRate": _optional_scaled(record.get("vertical_rate"), 196.8504),
        "squawk": record.get("squawk"),
        "status": (
            "unknown"
            if record.get("on_ground") is None
            else "landed"
            if record["on_ground"]
            else "airborne"
        ),
    }
    if kalman_updated is not None:
        flight.update(
            {
                "smoothedLatitude": (
                    float(smoothed_latitude) if smoothed_latitude is not None else None
                ),
                "smoothedLongitude": (
                    float(smoothed_longitude) if smoothed_longitude is not None else None
                ),
                "smoothedX": record.get("smoothed_x"),
                "smoothedY": record.get("smoothed_y"),
                "kalmanUpdated": kalman_updated,
            }
        )
    return flight


def _distance_meters(
    latitude_a: float,
    longitude_a: float,
    latitude_b: float,
    longitude_b: float,
) -> float:
    latitude_a_radians = math.radians(latitude_a)
    latitude_b_radians = math.radians(latitude_b)
    latitude_delta = latitude_b_radians - latitude_a_radians
    longitude_delta = math.radians(longitude_b - longitude_a)
    haversine = (
        math.sin(latitude_delta / 2) ** 2
        + math.cos(latitude_a_radians)
        * math.cos(latitude_b_radians)
        * math.sin(longitude_delta / 2) ** 2
    )
    return 2 * EARTH_RADIUS_METERS * math.asin(math.sqrt(haversine))


def _print_kalman_result(record: dict[str, Any], flight: dict[str, Any]) -> None:
    raw_latitude = flight["rawLatitude"]
    raw_longitude = flight["rawLongitude"]
    used_latitude = flight["latitude"]
    used_longitude = flight["longitude"]
    displacement = _distance_meters(
        raw_latitude,
        raw_longitude,
        used_latitude,
        used_longitude,
    )
    result = "UPDATED" if flight["kalmanUpdated"] else "LATE - RAW POSITION"
    print(
        f"[Kalman {result}] {flight['icao24']} "
        f"{flight['positionTimestamp']} | "
        f"raw=({raw_latitude:.5f}, {raw_longitude:.5f}) | "
        f"map=({used_latitude:.5f}, {used_longitude:.5f}) | "
        f"adjustment={displacement:.1f} m",
        flush=True,
    )


def _read_parquet_file(path: Path) -> list[dict[str, Any]]:
    schema_names = set(parquet.ParquetFile(path).schema_arrow.names)
    columns = [name for name in LATITUDE_FIELDS if name in schema_names]
    return parquet.read_table(path, columns=columns).to_pylist()


async def _broadcast(payload: dict[str, Any]) -> None:
    expired_clients = []
    message = json.dumps(payload, separators=(",", ":"))
    for client in tuple(clients):
        try:
            await client.send_text(message)
        except Exception:
            expired_clients.append(client)
    for client in expired_clients:
        clients.discard(client)


async def _publish_new_files(show_updates: bool) -> None:
    if not OUTPUT_PATH.exists():
        return

    for path in sorted(OUTPUT_PATH.rglob("*.parquet"), key=lambda item: item.stat().st_mtime_ns):
        if path in seen_files:
            continue
        try:
            records = await asyncio.to_thread(_read_parquet_file, path)
        except Exception:
            log.exception("Could not read committed Parquet file %s", path)
            continue

        seen_files.add(path)
        for record in records:
            flight = build_flight_payload(record)
            if flight is None:
                continue

            previous = latest_flights.get(flight["id"])
            if previous:
                previous_time = previous["positionTimestamp"]
                if flight["positionTimestamp"] < previous_time:
                    continue

            latest_flights[flight["id"]] = flight
            if show_updates:
                _print_kalman_result(record, flight)
                await _broadcast({"type": "flight.upsert", "flight": flight})


async def _watch_output() -> None:
    log.info("Watching Spark Parquet output at %s", OUTPUT_PATH)
    while True:
        await _publish_new_files(show_updates=True)
        await asyncio.sleep(POLL_INTERVAL_SECONDS)


@asynccontextmanager
async def lifespan(_: FastAPI):
    await _publish_new_files(show_updates=False)
    task = asyncio.create_task(_watch_output())
    try:
        yield
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


app = FastAPI(title="Spark Flight WebSocket Bridge", lifespan=lifespan)


@app.websocket("/ws/flights")
async def flight_updates(websocket: WebSocket) -> None:
    await websocket.accept()
    clients.add(websocket)
    try:
        await websocket.send_json(
            {"type": "snapshot", "flights": list(latest_flights.values())}
        )
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        clients.discard(websocket)


def main() -> None:
    import uvicorn

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    print("Kalman display bridge: reading Spark output and publishing map updates.", flush=True)
    uvicorn.run(app, host=os.environ.get("FLIGHT_WS_HOST", "127.0.0.1"), port=PORT)


if __name__ == "__main__":
    main()