# Spark Flight Cleaner

This directory contains the batch and Structured Streaming cleaners for the flight-tracking
project. The streaming path consumes the collector's Kafka topic, validates and deduplicates
flight fixes, adds projected coordinates, applies a per-aircraft Kalman filter, and archives
the result as Parquet. A local bridge publishes the cleaned positions to the flight-tracker
frontend over WebSocket.

## Current Run Status (2026-10-25)

- Kafka's local Docker stack was running and `api_events` existed at the last check.
- The Spark streaming query has **not** been started in the current run.
- The frontend and WebSocket bridge are stopped; start them with the commands below.
- The existing `Data/cleaned-stream` files predate the Kalman columns. They are legacy raw
  cleaned rows, not Kalman output. The new defaults below use separate output and checkpoint
  paths so the old files/state are left untouched.
- Python filter checks, the bridge's synthetic Parquet mapping, and a frontend build/typecheck
  passed before the latest status-text edit. The current files have clean editor diagnostics,
  but a live Kafka-to-Spark-to-frontend run is still unverified.

```text
OpenSky -> collector -> Kafka: api_events -> Spark validation/projection/Kalman -> Parquet
                                                                  -> WebSocket bridge -> frontend
```

The frontend does not read Kafka or Parquet directly. `flight_ws_bridge.py` reads committed
Spark Parquet files and serves the frontend's WebSocket contract. See
`../flight-tracker/docs/API_CONTRACT.md` for the frontend event shape.

## Kafka Handoff

This section is the contract for whoever operates or changes the Kafka side.

### Broker and topic

| Setting | Current local setup |
|---|---|
| Topic | `api_events` |
| Value format | UTF-8 JSON, one aircraft state per message |
| Kafka key | UTF-8 `icao24`; keep it equal to the JSON `icao24` |
| Partitions | 8 in the local Compose setup |
| Replication factor | 1 locally; use the Kafka operator's production policy elsewhere |
| Security | `PLAINTEXT` locally; no credentials or TLS are configured by this project |
| Host listener | `localhost:9092` for processes on the Kafka host |
| Compose listener | `broker:29092` for containers on the Compose network |

The collector producer in `kafka_setup/prod/producer.py` currently hardcodes
`localhost:9092` and publishes to `api_events`. Spark reads the bootstrap address from
`KAFKA_BOOTSTRAP_SERVERS` and defaults to `api_events`. The topic is not auto-created by
the local broker, so create it before starting the collector.

**Remote broker warning:** `localhost` always means the machine running the client. The
current Compose advertised listener and producer work when the collector and Spark run on
the same machine as Kafka. If they run on another machine, the Kafka operator must provide
a reachable advertised listener, and the producer's hardcoded broker address must be
changed as well. Set Spark's `KAFKA_BOOTSTRAP_SERVERS` to that reachable address. Do not
use `broker:29092` from a host process.

### Message contract

The current producer emits the following JSON properties. Nullable properties may be JSON
`null`; the four required fields must be present and valid for Spark to keep the record.

| Field | Type | Required by cleaner | Notes |
|---|---|---:|---|
| `icao24` | string | Yes | Non-empty aircraft/transponder identifier; also the Kafka key |
| `callsign` | string or null | No | Whitespace is trimmed by producer and cleaner |
| `origin_country` | string or null | No | |
| `time_position` | integer or null | Yes | Unix epoch seconds for the position fix; used for event time and deduplication |
| `last_contact` | integer or null | No | Unix epoch seconds |
| `longitude` | number or null | Yes | Degrees, inclusive range -180 to 180 |
| `latitude` | number or null | Yes | Degrees, inclusive range -90 to 90 |
| `baro_altitude` | number or null | No | Metres |
| `on_ground` | boolean or null | No | |
| `velocity` | number or null | No | Metres per second |
| `true_track` | number or null | No | Degrees |
| `vertical_rate` | number or null | No | Metres per second |
| `geo_altitude` | number or null | No | Metres |
| `squawk` | string or null | No | |
| `spi` | boolean or null | No | |
| `position_source` | integer or null | No | Must fit a signed byte in the Spark schema |
| `category` | integer or null | No | Must fit a signed byte in the Spark schema |
| `snapshot_time` | integer or null | No | Unix epoch seconds for the OpenSky response |

Spark also accepts optional `region`, `fetched_at`, `source`, and `schema_version`; the
current Kafka producer does not send them. Unknown JSON fields are ignored. Keep field
names and types compatible with `RAW_SCHEMA` in `streaming_cleaner.py` when changing the
producer. A malformed message or a record missing a required field/valid coordinate is
filtered out; there is currently no dead-letter topic or reject-count output.

Example message (illustrative values):

```json
{"icao24":"4ca8e2","callsign":"SAS842","origin_country":"Sweden","time_position":1792863660,"last_contact":1792863660,"longitude":6.4,"latitude":46.5,"baro_altitude":10000.0,"on_ground":false,"velocity":220.0,"true_track":145.0,"vertical_rate":0.0,"geo_altitude":10200.0,"squawk":"1234","spi":false,"position_source":0,"category":0,"snapshot_time":1792863660}
```

Produce it with Kafka key `4ca8e2` (UTF-8). The cleaner uses `time_position` as event time
in UTC, deduplicating on `(icao24, time_position)` within the configured watermark.

### Information the Kafka operator must provide

For a non-local or managed Kafka cluster, provide the project owner with:

- A bootstrap address reachable from both the collector and the Spark host.
- The advertised listener/address clients should use; a bootstrap address alone is not enough
  if Kafka advertises an unreachable hostname after connection.
- The topic name (or confirm `api_events`), partition count, retention policy, and whether the
  topic already exists. The producer and Spark must use the same topic.
- Security protocol and any authentication/TLS requirements. The current project only wires
  the local PLAINTEXT setup; secured Kafka requires adding the relevant Spark and producer
  client properties before it can connect.
- Any network/firewall or ACL requirements for producing and consuming.

## Requirements

- Apache Spark and PySpark **4.2.0**, built for Scala 2.13. The Spark Kafka connector must
  match both versions; the configured coordinate is
  `org.apache.spark:spark-sql-kafka-0-10_2.13:4.2.0`.
- Java **17, 21, or 25** for Spark 4.2.0. Use the same supported Spark/Python environment for
  the driver and workers.
- Python packages: `python -m pip install -r requirements.txt` installs the Spark, collector,
  Parquet, and WebSocket bridge dependencies.
- Internet access on the first Spark launch may be required for Ivy/Maven to download the
  Kafka connector specified by `spark.jars.packages`.
- A running Kafka broker and an OpenSky account/configuration for the collector.

Check the runtime before starting:

```sh
java -version
spark-submit --version
python -c 'import pyspark; print(pyspark.__version__)'
```

## Local End-to-End Run

Run these commands from the project root. Use separate terminals for the Spark cleaner and
collector; both are long-running processes.

1. Start the local Kafka stack:

   ```sh
   docker compose -f kafka_setup/docker-compose.yml up -d --build
   docker compose -f kafka_setup/docker-compose.yml ps
   ```

   Wait for the `broker` health check to pass. Kafka UI is available at `http://localhost:8080`.

2. Create the topic once (the local broker has auto-creation disabled):

   ```sh
   docker compose -f kafka_setup/docker-compose.yml exec -e KAFKA_OPTS="" broker \
     /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 \
     --create --if-not-exists --topic api_events --partitions 8 --replication-factor 1
   ```

3. Create `.env` from `.env.example` if needed. Keep real credentials in `.env` only; do not
   commit it. Set valid OpenSky credentials and verify these Spark/Kafka values:

   ```dotenv
   KAFKA_BOOTSTRAP_SERVERS=localhost:9092
   KAFKA_INPUT_TOPIC=api_events
   KAFKA_STARTING_OFFSETS=earliest
   KAFKA_SECURITY_PROTOCOL=PLAINTEXT
   SPARK_KAFKA_PACKAGE=org.apache.spark:spark-sql-kafka-0-10_2.13:4.2.0
  PROJECTION_REFERENCE_LATITUDE=46.477
  PROJECTION_REFERENCE_LONGITUDE=6.425
  CLEANER_OUTPUT_PATH=Data/cleaned-kalman-stream
  SPARK_CHECKPOINT_PATH=Data/checkpoints/flight-cleaner-kalman
   ```

   Configure the collector's `OPENSKY_ACCOUNTS` (or legacy client ID/secret) and `BBOXES`
   in the same `.env`; the supplied example contains placeholders/sample settings.

4. Start Spark in a terminal:

   ```sh
  spark-submit --packages org.apache.spark:spark-sql-kafka-0-10_2.13:4.2.0 \
    spark/streaming_cleaner.py
   ```

5. In a second terminal, start the collector:

   ```sh
   python -m collector.main
   ```

6. In a third terminal, start the Parquet-to-WebSocket bridge:

  ```sh
  python -m spark.flight_ws_bridge
  ```

  It listens at `ws://127.0.0.1:8765/ws/flights`. For each newly committed Parquet row,
  its terminal prints a `[Kalman UPDATED]` line showing the raw fix, map position, and
  adjustment in meters. The initial archive scan is quiet; subsequent stream output is
  printed as it arrives.

7. Configure and run the frontend in another terminal:

  ```sh
  cd flight-tracker
  cp .env.example .env
  pnpm install
  pnpm dev
  ```

  Open the URL printed by Vite. The map markers use the smoothed coordinates; selecting an
  aircraft shows the raw fix, map position, and whether the Kalman state was updated.

The collector also writes its own raw Parquet output. Spark's Kalman-enabled output is separate
and appears under `Data/cleaned-kalman-stream/date=YYYY-MM-DD/hour=HH/` after records arrive
and a micro-batch completes. No output file is expected while the topic is empty.

## Kalman Filter Output

The streaming query groups fixes by `icao24` and processes each aircraft's fixes in
`time_position` order within a micro-batch. The constant-velocity state tracks projected
position (`x`, `y`) and velocity (`vx`, `vy`); position observations come from projected
coordinates, and velocity observations are derived from `velocity` and `true_track` when
both are available. The current noise assumptions are 75 m position standard deviation,
8 m/s velocity standard deviation, and 3 m/s^2 acceleration standard deviation.

The raw `x` and `y` columns and raw `latitude`/`longitude` are retained. The output adds
`smoothed_x`, `smoothed_y`, `smoothed_latitude`, `smoothed_longitude`, and `kalman_updated`.
A fix older than the last fix already processed for that aircraft is kept with raw coordinates
in the smoothed columns and `kalman_updated=false`; it does not rewind filter state.
Per-aircraft state is checkpointed and expires after one hour with no fixes for that aircraft.

## Verify the Pipeline

- In Kafka UI, inspect the `api_events` topic and confirm new JSON messages arrive.
- Or run the sample consumer in another terminal: `python -m kafka_setup.prod.consumer`.
- In Spark logs, confirm it reports consuming `api_events` from the expected bootstrap host.
- Check for Parquet parts under `Data/cleaned-kalman-stream/date=*/hour=*`.
- A message can be present in Kafka but absent from output if it is malformed, has a null/blank
  `icao24`, null `time_position`, invalid coordinates, or is a duplicate within the watermark.

The bridge maps Spark's `smoothed_latitude` and `smoothed_longitude` into the `latitude` and
`longitude` fields used by the map. It also sends raw and smoothed coordinates plus the
`kalmanUpdated` flag so the inspector can compare the observation to the filtered position.

## Configuration

All cleaner settings are read from the project-root `.env` file. Existing environment
variables take precedence over values in `.env`.

| Variable | Default | Meaning |
|---|---|---|
| `KAFKA_BOOTSTRAP_SERVERS` | Required | Host-reachable broker address |
| `KAFKA_INPUT_TOPIC` | `api_events` | Topic to consume |
| `KAFKA_SECURITY_PROTOCOL` | `PLAINTEXT` | Current local setup; secured Kafka needs extra client configuration |
| `SPARK_KAFKA_PACKAGE` | Required | Spark/Scala-matched Kafka connector coordinate |
| `KAFKA_STARTING_OFFSETS` | `latest` | `earliest` reads retained records on a new query/checkpoint |
| `KAFKA_MAX_OFFSETS_PER_TRIGGER` | unlimited | Optional per-micro-batch source limit |
| `KAFKA_FAIL_ON_DATA_LOSS` | `true` | Fail if Kafka reports consumed data is unavailable |
| `PROJECTION_REFERENCE_LATITUDE` | Required | Projection origin latitude in degrees |
| `PROJECTION_REFERENCE_LONGITUDE` | Required | Projection origin longitude in degrees |
| `CLEANER_WATERMARK_DELAY` | `10 minutes` | Late-arrival window used by streaming deduplication |
| `SPARK_TRIGGER_INTERVAL` | `5 seconds` | Processing-time micro-batch interval |
| `CLEANER_OUTPUT_PATH` | `Data/cleaned-kalman-stream` | Kalman-enabled Parquet output root |
| `SPARK_CHECKPOINT_PATH` | `Data/checkpoints/flight-cleaner-kalman` | Offsets and Kalman state for recovery |
| `FLIGHT_WS_HOST` | `127.0.0.1` | Interface for the local WebSocket bridge |
| `FLIGHT_WS_PORT` | `8765` | Port for the local WebSocket bridge |
| `FLIGHT_WS_POLL_INTERVAL` | `1` | Seconds between committed-Parquet scans |

## Offsets and Checkpoints

Keep the checkpoint path between normal restarts. Spark resumes from offsets and state stored
there; changing `KAFKA_STARTING_OFFSETS` does not rewind an existing checkpoint. For an
intentional replay, stop the query and use a new checkpoint path, taking care not to overwrite
or mix output from an earlier run. Deleting a checkpoint loses progress/state and may cause
reprocessing depending on the starting offset and retained Kafka data.

The watermark bounds duplicate state and how late data is handled; records outside the
watermark may not be deduplicated against older fixes. `earliest` only applies when Spark is
starting without an existing checkpoint and reads from the beginning of the topic's retained
data, not necessarily all historical messages ever produced.

## Current Limitations

- Invalid records are filtered silently; there is no reject/DLQ topic or streaming reject count.
- On-ground aircraft are retained.
- The filter is causal (it does not revise earlier outputs when later fixes arrive), and its
  noise assumptions are currently constants in `kalman_filter.py`.
- The stream has not been verified end to end against a running broker in this repository.
- The included Compose broker is a single local development node, not a production Kafka
  deployment.

See `KAFKA_HANDOFF.md` for the shorter producer/broker handoff summary.
