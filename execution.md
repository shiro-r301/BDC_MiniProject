# Kafka Shell

cd kafka_setup

docker compose up -d --build

docker compose exec -e KAFKA_OPTS="" broker /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --create --if-not-exists --topic api_events --partitions 8 --replication-factor 1

docker compose exec -e KAFKA_OPTS="" broker /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --create --if-not-exists --topic flights_live --partitions 4 --replication-factor 1

docker compose exec -e KAFKA_OPTS="" broker /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --describe --topic flights_live

docker compose exec -e KAFKA_OPTS="" broker /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --describe --topic api_events


# Python Server Shell

uvicorn flight-tracker.python_server.server:app --port 8000


# Collector Shell

python -m collector.main


# Test Consumer Shell

python -m kafka_setup.prod.consumer


# Frontend Shell

pnpm --dir "C:/BDC-MP/flight-tracker/" run dev


# Spark Shell

$env:PYSPARK_PYTHON = "C:\Users\vanir\miniconda3\envs\BDC\python.exe"

$env:PYSPARK_DRIVER_PYTHON = "C:\Users\vanir\miniconda3\envs\BDC\python.exe"

spark-submit --packages org.apache.spark:spark-sql-kafka-0-10_2.13:4.2.0 spark/streaming_cleaner.py