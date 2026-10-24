# Spark Kafka Handoff

`batch/batch_cleaner.py` remains the Parquet batch path. `streaming_cleaner.py` is
the separate host-side Structured Streaming entry point for the future Kafka feed.
It reads the raw topic, parses one JSON flight record per Kafka value, applies
position/key validation and watermark-based duplicate suppression, adds projected
`x`/`y` coordinates, applies a per-aircraft stateful constant-velocity Kalman filter, and
archives rows to Parquet under `date=.../hour=...` folders. Output retains raw `x`/`y` and
adds `smoothed_x`, `smoothed_y`, and `kalman_updated`.

## Producer contract

- The collector publishes to `api_events`; Spark defaults to this topic and can be
  configured with `KAFKA_INPUT_TOPIC`.
- Each Kafka value is one JSON object produced from an OpenSky aircraft state. The
  Spark schema also allows optional `source` and `schema_version` fields; the current
  producer does not send them. Unknown JSON fields are ignored.
- The producer uses the UTF-8 `icao24` value as the Kafka key, so records for one
  aircraft share a partition. Spark validates `icao24` in the JSON value but does
  not currently verify that the Kafka key matches it.
- Malformed JSON, records without an aircraft/fix key, and invalid coordinates are
  currently filtered out. A reject/DLQ topic and streaming discard metrics remain
  follow-up work once the producer contract is agreed.
- `collector/worker.py` calls `kafka_setup.prod.producer.publish_event`; the producer
  publishes to Kafka while the collector also writes its Parquet output.

## Host and Kafka settings

The local Compose broker advertises `localhost:9092` to programs running on the
host and `broker:29092` to programs inside the Compose network. Since Spark is run
from the project host, set `KAFKA_BOOTSTRAP_SERVERS=localhost:9092` in `.env`.

`KAFKA_BOOTSTRAP_SERVERS`, `PROJECTION_REFERENCE_LATITUDE`,
`PROJECTION_REFERENCE_LONGITUDE`, and `SPARK_KAFKA_PACKAGE` are required. Other
settings, including the broker security protocol, are in `.env.example`. The
example assumes unauthenticated local `PLAINTEXT`; SASL/SSL credentials and trust
settings require agreement with the Kafka owner before those modes are enabled.
Keep the checkpoint directory between restarts;
deleting it starts a new consumer from `KAFKA_STARTING_OFFSETS` and can replay data.

## Connector and run

The inspected host installation is PySpark/Spark 4.2.0, Scala 2.13.18. The example
connector coordinate therefore uses Spark 4.2.0 and Scala binary 2.13. The script
sets `spark.jars.packages` from `SPARK_KAFKA_PACKAGE`, so Spark resolves the JVM
connector when the session starts; it is not supplied by Docker or by `pip install
pyspark`. If Spark/Scala is upgraded or differs on another machine, update the
coordinate to the matching `spark-sql-kafka-0-10` artifact.

From the project root, start the local Kafka stack and create the producer's topic:

```sh
docker compose -f kafka_setup/docker-compose.yml up -d --build
docker compose -f kafka_setup/docker-compose.yml exec -e KAFKA_OPTS="" broker \
  /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 \
  --create --if-not-exists --topic api_events --partitions 8 --replication-factor 1
cp .env.example .env
# Edit .env: set OpenSky credentials and verify KAFKA_INPUT_TOPIC=api_events.
python -m collector.main
# In another terminal:
spark-submit spark/streaming_cleaner.py
```

To verify consumption, produce a JSON record with valid coordinates to the
configured input topic, then check that a new Parquet file appears under
`CLEANER_OUTPUT_PATH/date=.../hour=...`. For an initial retained-topic backfill,
set `KAFKA_STARTING_OFFSETS=earliest` before the first run. Once a checkpoint exists,
Kafka offsets resume from that checkpoint.

The configuration and topic wiring match the repository's producer and Compose
broker, but a live end-to-end streaming run has not been verified. Confirm that the
broker is healthy, the collector is publishing to `api_events`, and Spark writes
Parquet files before relying on the stream in a run.