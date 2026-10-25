"""FastAPI WebSocket server.

Consumes the compacted `flights_live` Kafka topic, keeps the latest state per
aircraft in memory, and pushes snapshots/updates/removals to browser clients.

Run:  uvicorn flight_ws_server:app --port 8000
"""
import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Set

from aiokafka import AIOKafkaConsumer
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

KAFKA_BOOTSTRAP = os.environ.get("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
LIVE_TOPIC = os.environ.get("KAFKA_OUTPUT_TOPIC", "flights_live")
STALE_SECONDS = int(os.environ.get("FLIGHT_STALE_SECONDS", "300"))
CLEANUP_INTERVAL = int(os.environ.get("FLIGHT_CLEANUP_INTERVAL", "30"))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("Flight_WS_Server")


def _age_seconds(iso_ts: Optional[str]) -> Optional[float]:
    """Seconds since an ISO timestamp like 2026-01-01T12:00:00Z, or None if unparseable."""
    if not iso_ts:
        return None
    try:
        ts = datetime.strptime(iso_ts, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return None
    return (datetime.now(timezone.utc) - ts).total_seconds()


class WebSocketHandler:
    def __init__(self) -> None:
        self.active_connections: Set[WebSocket] = set()
        self.total_messages_sent: int = 0
        self.flights: Dict[str, Dict[str, Any]] = {}  # the state variable

    # ---- connections -------------------------------------------------
    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active_connections.add(websocket)
        logger.info("Client CONNECTED. Total active: %d", len(self.active_connections))
        # New clients get the current state as a snapshot
        await websocket.send_text(
            json.dumps({"type": "snapshot", "flights": list(self.flights.values())})
        )

    def disconnect(self, websocket: WebSocket) -> None:
        self.active_connections.discard(websocket)
        logger.info("Client DISCONNECTED. Total active: %d", len(self.active_connections))

    async def broadcast(self, message: str) -> None:
        self.total_messages_sent += 1
        dead = []
        for conn in list(self.active_connections):
            try:
                await conn.send_text(message)
            except Exception:
                dead.append(conn)
        for conn in dead:
            self.active_connections.discard(conn)

    # ---- state -------------------------------------------------------
    async def update_flights(self, flights: list[dict]) -> None:
        fresh = []
        for f in flights:
            fid = f.get("id")
            if not isinstance(fid, str):
                continue
            age = _age_seconds(f.get("positionTimestamp"))
            if age is not None and age > STALE_SECONDS:
                continue  # skip old fixes (e.g. during compacted-topic replay)
            self.flights[fid] = {**self.flights.get(fid, {}), **f}  # merge, same as frontend
            fresh.append(f)
        if fresh and self.active_connections:
            await self.broadcast(json.dumps({"type": "flight.update", "flights": fresh}))

    async def remove_stale(self) -> None:
        stale_ids = []
        for fid, f in self.flights.items():
            age = _age_seconds(f.get("positionTimestamp"))
            if age is not None and age > STALE_SECONDS:
                stale_ids.append(fid)
        for fid in stale_ids:
            del self.flights[fid]
            await self.broadcast(json.dumps({"type": "flight.remove", "id": fid}))
        if stale_ids:
            logger.info("Removed %d stale flights", len(stale_ids))


ws_handler = WebSocketHandler()


# ---- background tasks ------------------------------------------------
async def consume_flights() -> None:
    while True:  # retry loop so the server survives Kafka being down at start
        consumer = AIOKafkaConsumer(
            LIVE_TOPIC,
            bootstrap_servers=KAFKA_BOOTSTRAP,
            group_id=None,                 # no committed offsets: every start rebuilds state
            auto_offset_reset="earliest",  # replay the compacted topic to restore state
        )
        try:
            await consumer.start()
            logger.info("Kafka consumer started on %s (%s)", KAFKA_BOOTSTRAP, LIVE_TOPIC)
            while True:
                batches = await consumer.getmany(timeout_ms=500)
                flights = []
                for msgs in batches.values():
                    for m in msgs:
                        try:
                            flights.append(json.loads(m.value))
                        except (TypeError, ValueError):
                            logger.warning("Skipping invalid message at offset %s", m.offset)
                if flights:
                    await ws_handler.update_flights(flights)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            logger.error("Kafka consumer error: %s; retrying in 5s", error)
            await asyncio.sleep(5)
        finally:
            try:
                await consumer.stop()
            except Exception:
                pass


async def cleanup_loop() -> None:
    while True:
        await asyncio.sleep(CLEANUP_INTERVAL)
        try:
            await ws_handler.remove_stale()
        except Exception as error:
            logger.error("Cleanup error: %s", error)


@asynccontextmanager
async def lifespan(app: FastAPI):
    tasks = [asyncio.create_task(consume_flights()), asyncio.create_task(cleanup_loop())]
    logger.info("Flight WebSocket Server started and listening...")
    yield
    for t in tasks:
        t.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)


app = FastAPI(lifespan=lifespan)


@app.get("/health")
async def health():
    return {
        "ok": True,
        "flights": len(ws_handler.flights),
        "clients": len(ws_handler.active_connections),
    }


@app.websocket("/ws/flights")
async def flight_websocket_endpoint(websocket: WebSocket):
    await ws_handler.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_handler.disconnect(websocket)