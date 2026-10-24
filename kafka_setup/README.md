# Kafka development stack

This folder contains the Docker Compose setup for the local Kafka stack used by
the BDC MiniProject. It includes a single-node Kafka broker, Kafka UI, Kafka
Exporter, Prometheus, and Grafana.

## Prerequisites

- Docker Desktop installed and running.
- Run commands below from the `kafka_setup` directory unless a command says
  otherwise:

  ```powershell
  cd .\kafka_setup
  ```

## Start the stack

Build the broker image and start all services in the background:

```powershell
docker compose up -d --build
```

Check service status and health:

```powershell
docker compose ps
```

The broker has a health check. Kafka UI and Kafka Exporter wait for the broker
to become healthy before starting. To follow broker startup and runtime logs:

```powershell
docker logs -f broker
```

Press `Ctrl+C` to stop following the log stream; this does not stop the
container.

## Kafka UI and service endpoints

| Service | URL | Notes |
| --- | --- | --- |
| Kafka UI | <http://localhost:8080> | Browse the `local` cluster, topics, partitions, and messages. |
| Prometheus | <http://localhost:9090> | Metrics and query interface. |
| Grafana | <http://localhost:3000> | Login: `admin` / `admin` for local development. |
| Kafka broker | `localhost:9092` | Address for producer/consumer applications running on the host. |
| Kafka JMX metrics | `localhost:9404` | Broker metrics endpoint. |
| Kafka Exporter metrics | `localhost:9308` | Kafka consumer-group and broker metrics. |

The Compose network uses `broker:29092` for Kafka UI and Kafka Exporter. Host
applications use `localhost:9092`. These addresses are intentionally
different: Kafka advertises `localhost:9092` to host clients and `broker:29092`
to containers on the Compose network.

## Create and inspect the topic

Automatic topic creation is disabled. Create `api_events` once after the
broker is up; it is the topic used by the collector. This local stack is
configured for eight partitions and a replication factor of one:

```powershell
docker compose exec -e KAFKA_OPTS="" broker /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --create --if-not-exists --topic api_events --partitions 8 --replication-factor 1
```

List topics:

```powershell
docker compose exec -e KAFKA_OPTS="" broker /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --list
```

Describe the topic and its partitions:

```powershell
docker compose exec -e KAFKA_OPTS="" broker /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --describe --topic api_events
```

The `-e KAFKA_OPTS=""` override prevents the broker's JMX Java-agent setting
from being passed to the one-off Kafka CLI process.

## Run the collector and verify messages

Start Kafka first and make sure `api_events` exists. From the repository root,
create a `.env` file with `OPENSKY_CLIENT_ID`, `OPENSKY_CLIENT_SECRET`, and
`BBOXES` (a JSON list of bounding boxes). For example:

```dotenv
OPENSKY_CLIENT_ID=your-client-id
OPENSKY_CLIENT_SECRET=your-client-secret
BBOXES=[{"name":"sample","lamin":40,"lomin":-75,"lamax":41,"lomax":-74,"interval":90}]
```

Keep real credentials out of source control. The collector also supports
multiple accounts through `OPENSKY_ACCOUNTS`; see
`collector/config.py` for validation and optional settings. Then run:

```powershell
python -m collector.main
```

The collector publishes aircraft state events to Kafka while also writing its
Parquet output. It connects to the broker at `localhost:9092`.

To read events with the included sample consumer, use a second terminal from
the repository root:

```powershell
python -m kafka_setup.prod.consumer
```

The sample consumer uses the stable group ID `verify-partitions` and starts
from the earliest available offsets. Stop it with `Ctrl+C`.

## Regular operations

Restart or apply Compose configuration/image changes:

```powershell
docker compose up -d --build
```

Check all service states:

```powershell
docker compose ps
```

Follow logs for all Compose services:

```powershell
docker compose logs -f
```

Follow only broker logs:

```powershell
docker logs -f broker
```

Stop and remove the containers and Compose network:

```powershell
docker compose down
```

The Kafka data is stored in the named `kafka-data` volume and is retained by
`docker compose down`. **Do not use `docker compose down -v` unless you
intentionally want to delete the persisted Kafka data and topics.**

## Troubleshooting

- **Kafka UI stays on loading:** Check `docker compose ps` and broker logs.
  Ensure the UI and exporter bootstrap address is `broker:29092` within
  Compose; host applications should use `localhost:9092`.
- **`api_events` is missing:** Create it with the topic command above.
  `KAFKA_AUTO_CREATE_TOPICS_ENABLE` is disabled.
- **Topic has no messages:** Confirm the collector is running, its OpenSky
  configuration is valid, and `docker logs -f broker` shows no broker errors.
  Use the sample consumer or Kafka UI to check the topic.
- **Broker is unhealthy or not ready:** Inspect `docker compose ps` and
  `docker logs -f broker`, then allow the health check time to complete.
- **Port already in use:** Stop the other service using the relevant host port
  (`9092`, `8080`, `9090`, `3000`, `9308`, or `9404`) or change the port
  mapping in `docker-compose.yml`.
