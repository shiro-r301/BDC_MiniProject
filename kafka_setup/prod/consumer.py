import json
from confluent_kafka import Consumer, TopicPartition

c = Consumer({
    "bootstrap.servers": "localhost:9092",
    "group.id": "verify-partitions",     # keep this stable: lag is tracked per group
    "auto.offset.reset": "earliest",
    "enable.auto.commit": True,
})

c.subscribe(["api_events"])
print("Waiting for messages... Ctrl+C to stop")

try:
    while True:
        msg = c.poll(1.0)
        if msg is None:
            continue
        if msg.error():
            print("ERROR:", msg.error())
            continue

        print(f"partition={msg.partition()} offset={msg.offset()} "
              f"key={msg.key().decode()} "
              f"id={json.loads(msg.value())['icao24']}"
              f"id={json.loads(msg.value())['time_position']}")
finally:
    c.close()