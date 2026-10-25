import logging
import json
import datetime
import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from typing import Set, Dict, Any

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)-7s | %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger("Flight_WS_Server")

class WebSocketHandler:
    def __init__(self):
        self.active_connections: Set[WebSocket] = set()
        self.total_messages_sent: int = 0

    def _generate_initial_flight_data(self) -> Dict[str, Any]:
        """Generates a mock LiveFlight object matching the TypeScript interface."""
        now = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
        
        return {"flight":{
                "id": "FL-98234",
                "icao24": "A8F1B2",
                "callsign": "DAL456",
                "flightNumber": "DL456",
                "registration": "N821DN",
                "aircraftType": "B763",
                "aircraftModel": "Boeing 767-300ER",
                "operator": "Delta Air Lines",
                "latitude": 40.6413,
                "longitude": -73.7781,
                "altitude": 38000,
                "speed": 485,
                "heading": 95,
                "verticalRate": 0,
                "squawk": "4521",
                "origin": {
                    "icao": "KJFK",
                    "name": "John F. Kennedy International Airport",
                    "city": "New York"
                },
                "destination": {
                    "icao": "EGLL",
                    "name": "London Heathrow Airport",
                    "city": "London"
                },
                "status": "En Route",
                "positionTimestamp": now,
                "updatedAt": now
                }
        }

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.add(websocket)
        logger.info(f"✅ Flight client CONNECTED. Total active: {len(self.active_connections)}")
        
        initial_data = self._generate_initial_flight_data()
        await websocket.send_text(json.dumps(initial_data))
        logger.info("📤 Sent initial LiveFlight data to new client.")

    def disconnect(self, websocket: WebSocket):
        self.active_connections.discard(websocket)
        logger.info(f"❌ Flight client DISCONNECTED. Total active: {len(self.active_connections)}")

    async def broadcast(self, message: str):
        self.total_messages_sent += 1
        for connection in self.active_connections:
            await connection.send_text(message)

ws_handler = WebSocketHandler()

app = FastAPI()

@app.on_event("startup")
async def startup_event():
    logger.info("🚀 Flight WebSocket Server started and listening...")

@app.websocket("/ws/flights")
async def flight_websocket_endpoint(websocket: WebSocket):
    await ws_handler.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            logger.info(f"📩 Received from frontend: '{data}'")
            await ws_handler.broadcast(f"Server received: {data}")
            
    except WebSocketDisconnect:
        ws_handler.disconnect(websocket)