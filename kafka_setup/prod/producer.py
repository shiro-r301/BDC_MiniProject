# kafka_setup/producer.py
import json
import logging
from confluent_kafka import Producer

log = logging.getLogger(__name__)

# 1. Initialize ONE global producer. 
# confluent-kafka Producers are thread-safe and designed to be shared.
producer = Producer({
    'bootstrap.servers': 'localhost:9092',  # Or your Docker/Redpanda address
    'client.id': 'opensky-kafka-producer',
    'linger.ms': 10,          # Wait up to 10ms to batch messages from different workers
    'batch.size': 65536,      # Batch up to 64KB before sending
    'compression.type': 'lz4' # Fast compression to save network bandwidth
})

# Optional: Map indices to names to match your PyArrow schema exactly
COLUMNS = [
    ("icao24", 0), ("callsign", 1), ("origin_country", 2), ("time_position", 3), 
    ("last_contact", 4), ("longitude", 5), ("latitude", 6), ("baro_altitude", 7), 
    ("on_ground", 8), ("velocity", 9), ("true_track", 10), ("vertical_rate", 11), 
    ("geo_altitude", 13), ("squawk", 14), ("spi", 15), ("position_source", 16), 
    ("category", 17)
]

def delivery_report(err, msg):
    if err is not None:
        log.error(f"Kafka delivery failed: {err}")

def publish_event(api_data: dict):
    """
    Takes the full OpenSky API response, flattens it, and sends 
    one Kafka message per aircraft, partitioned by icao24.
    """
    states = api_data.get('states')
    if not states:
        return

    api_time = api_data.get('time')
    
    for state_list in states:
        icao24 = state_list[0]
        if not icao24:
            continue
            
        # Build dictionary matching your PyArrow logic
        state_dict = {}
        for name, idx in COLUMNS:
            v = state_list[idx] if idx < len(state_list) else None
            # Match your PyArrow callsign stripping logic
            if name == "callsign" and isinstance(v, str):
                v = v.strip() or None
            state_dict[name] = v
            
        state_dict['snapshot_time'] = api_time
        
        # Serialize to bytes. (Pro-tip: `import orjson` and use orjson.dumps(state_dict) 
        # for a 3x speedup if you have 10k+ records per fetch).
        value_bytes = json.dumps(state_dict, separators=(',', ':')).encode('utf-8')
        
        try:
            producer.produce(
                topic='api_events',
                key=icao24.encode('utf-8'),  # <-- THIS guarantees partitioning by aircraft
                value=value_bytes,
                callback=delivery_report
            )
        except BufferError:
            # If the local C-library queue is full, poll to free up space, then retry
            producer.poll(0)
            producer.produce(
                topic='api_events',
                key=icao24.encode('utf-8'),
                value=value_bytes,
                callback=delivery_report
            )

    # Drive the delivery callbacks and free up queue memory. 
    # This is non-blocking and takes < 1 millisecond.
    producer.poll(0)