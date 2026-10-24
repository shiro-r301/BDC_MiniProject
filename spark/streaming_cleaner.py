"""Consume raw flight JSON from Kafka and archive cleaned fixes as Parquet."""
import logging
import os, sys
print("SPARK PYTHON EXECUTABLE:", sys.executable, flush=True)
print("SPARK PYTHON VERSION:", sys.version, flush=True)

from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv
from pyspark.sql import DataFrame, SparkSession
from pyspark.sql import functions as F
from pyspark.sql.types import (
    BooleanType,
    ByteType,
    DoubleType,
    IntegerType,
    LongType,
    StringType,
    StructField,
    StructType,
)

PROJECT_ROOT = Path(__file__).resolve().parents[1]
EARTH_RADIUS_METERS = 6_371_000
log = logging.getLogger("flight_stream_cleaner")

RAW_SCHEMA = StructType(
    [
        StructField("icao24", StringType()),
        StructField("callsign", StringType()),
        StructField("origin_country", StringType()),
        StructField("time_position", LongType()),
        StructField("last_contact", LongType()),
        StructField("longitude", DoubleType()),
        StructField("latitude", DoubleType()),
        StructField("baro_altitude", DoubleType()),
        StructField("on_ground", BooleanType()),
        StructField("velocity", DoubleType()),
        StructField("true_track", DoubleType()),
        StructField("vertical_rate", DoubleType()),
        StructField("geo_altitude", DoubleType()),
        StructField("squawk", StringType()),
        StructField("spi", BooleanType()),
        StructField("position_source", ByteType()),
        StructField("category", ByteType()),
        StructField("snapshot_time", LongType()),
        StructField("region", StringType()),
        StructField("fetched_at", LongType()),
        StructField("source", StringType()),
        StructField("schema_version", IntegerType()),
        StructField("_corrupt_record", StringType()),
    ]
)
RAW_FIELDS = [field.name for field in RAW_SCHEMA.fields if not field.name.startswith("_")]


@dataclass(frozen=True)
class StreamingConfig:
    bootstrap_servers: str
    security_protocol: str
    input_topic: str
    output_path: Path
    checkpoint_path: Path
    reference_latitude: float
    reference_longitude: float
    starting_offsets: str
    watermark_delay: str
    trigger_interval: str
    kafka_package: str
    max_offsets_per_trigger: int | None
    fail_on_data_loss: bool


def _required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise ValueError(
            f"Missing required environment variable {name}; "
            "set the Kafka host-accessible listener in .env"
        )
    return value


def _path_from_env(name: str, default: str) -> Path:
    path = Path(os.environ.get(name, default)).expanduser()
    return path if path.is_absolute() else PROJECT_ROOT / path


def load_config() -> StreamingConfig:
    load_dotenv(PROJECT_ROOT / ".env")
    bootstrap_servers = _required("KAFKA_BOOTSTRAP_SERVERS")
    kafka_package = _required("SPARK_KAFKA_PACKAGE")
    security_protocol = os.environ.get("KAFKA_SECURITY_PROTOCOL", "PLAINTEXT").strip().upper()
    if security_protocol not in {"PLAINTEXT", "SSL", "SASL_PLAINTEXT", "SASL_SSL"}:
        raise ValueError(
            "KAFKA_SECURITY_PROTOCOL must be PLAINTEXT, SSL, SASL_PLAINTEXT, or SASL_SSL"
        )
    input_topic = os.environ.get("KAFKA_INPUT_TOPIC", "api_events").strip()
    if not input_topic:
        raise ValueError("KAFKA_INPUT_TOPIC must not be empty")

    starting_offsets = os.environ.get("KAFKA_STARTING_OFFSETS", "latest").strip()
    if starting_offsets not in {"earliest", "latest"}:
        raise ValueError("KAFKA_STARTING_OFFSETS must be 'earliest' or 'latest'")

    try:
        reference_latitude = float(_required("PROJECTION_REFERENCE_LATITUDE"))
        reference_longitude = float(_required("PROJECTION_REFERENCE_LONGITUDE"))
    except ValueError as error:
        raise ValueError(f"Invalid projection reference: {error}") from error
    if not -90 <= reference_latitude <= 90:
        raise ValueError("PROJECTION_REFERENCE_LATITUDE must be between -90 and 90")
    if not -180 <= reference_longitude <= 180:
        raise ValueError("PROJECTION_REFERENCE_LONGITUDE must be between -180 and 180")

    max_offsets_raw = os.environ.get("KAFKA_MAX_OFFSETS_PER_TRIGGER", "").strip()
    try:
        max_offsets = int(max_offsets_raw) if max_offsets_raw else None
    except ValueError as error:
        raise ValueError("KAFKA_MAX_OFFSETS_PER_TRIGGER must be a positive integer") from error
    if max_offsets is not None and max_offsets <= 0:
        raise ValueError("KAFKA_MAX_OFFSETS_PER_TRIGGER must be a positive integer")

    fail_on_data_loss = os.environ.get("KAFKA_FAIL_ON_DATA_LOSS", "true").strip().lower()
    if fail_on_data_loss not in {"true", "false"}:
        raise ValueError("KAFKA_FAIL_ON_DATA_LOSS must be 'true' or 'false'")

    return StreamingConfig(
        bootstrap_servers=bootstrap_servers,
        security_protocol=security_protocol,
        input_topic=input_topic,
        output_path=_path_from_env("CLEANER_OUTPUT_PATH", "Data/cleaned-stream"),
        checkpoint_path=_path_from_env(
            "SPARK_CHECKPOINT_PATH", "Data/checkpoints/flight-cleaner"
        ),
        reference_latitude=reference_latitude,
        reference_longitude=reference_longitude,
        starting_offsets=starting_offsets,
        watermark_delay=os.environ.get("CLEANER_WATERMARK_DELAY", "10 minutes").strip(),
        trigger_interval=os.environ.get("SPARK_TRIGGER_INTERVAL", "5 seconds").strip(),
        kafka_package=kafka_package,
        max_offsets_per_trigger=max_offsets,
        fail_on_data_loss=fail_on_data_loss == "true",
    )


def clean_kafka_records(
    kafka_records: DataFrame,
    reference_latitude: float,
    reference_longitude: float,
    watermark_delay: str,
) -> DataFrame:
    parsed = kafka_records.select(
        F.from_json(
            F.col("value").cast("string"),
            RAW_SCHEMA,
            {"mode": "PERMISSIVE", "columnNameOfCorruptRecord": "_corrupt_record"},
        ).alias("record")
    ).select("record.*")

    valid_position = (
        F.col("latitude").between(-90, 90)
        & F.col("longitude").between(-180, 180)
    )
    valid_key = (
        F.col("icao24").isNotNull()
        & (F.trim(F.col("icao24")) != "")
        & F.col("time_position").isNotNull()
    )
    valid = parsed.filter(
        F.coalesce(
            valid_position & valid_key & F.col("_corrupt_record").isNull(),
            F.lit(False),
        )
    )
    if "callsign" in valid.columns:
        valid = valid.withColumn("callsign", F.nullif(F.trim("callsign"), F.lit("")))

    fix_time = F.to_timestamp(F.from_unixtime(F.col("time_position")))
    deduplicated = (
        valid.withColumn("_fix_time", fix_time)
        .withWatermark("_fix_time", watermark_delay)
        .dropDuplicatesWithinWatermark(["icao24", "time_position"])
        .drop("_fix_time", "_corrupt_record")
    )

    reference_latitude_rad = F.radians(F.lit(reference_latitude))
    return (
        deduplicated
        .withColumn(
            "x",
            F.lit(EARTH_RADIUS_METERS)
            * F.cos(reference_latitude_rad)
            * F.radians(F.col("longitude") - F.lit(reference_longitude)),
        )
        .withColumn(
            "y",
            F.lit(EARTH_RADIUS_METERS)
            * F.radians(F.col("latitude") - F.lit(reference_latitude)),
        )
        .withColumn("date", F.date_format(F.from_unixtime("time_position"), "yyyy-MM-dd"))
        .withColumn("hour", F.date_format(F.from_unixtime("time_position"), "HH"))
    )


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        config = load_config()
    except ValueError as error:
        raise SystemExit(f"Configuration error: {error}") from error

    builder = (
        SparkSession.builder
        .appName("FlightTracking-KafkaCleaner")
        .config("spark.jars.packages", config.kafka_package)
        .config("spark.sql.session.timeZone", "UTC")
        .config("spark.sql.shuffle.partitions", "8")
    )
    spark = builder.getOrCreate()
    try:
        kafka_options = {
            "kafka.bootstrap.servers": config.bootstrap_servers,
            "kafka.security.protocol": config.security_protocol,
            "subscribe": config.input_topic,
            "startingOffsets": config.starting_offsets,
            "failOnDataLoss": str(config.fail_on_data_loss).lower(),
        }
        if config.max_offsets_per_trigger is not None:
            kafka_options["maxOffsetsPerTrigger"] = str(config.max_offsets_per_trigger)

        kafka_records = spark.readStream.format("kafka").options(**kafka_options).load()
        cleaned = clean_kafka_records(
            kafka_records,
            config.reference_latitude,
            config.reference_longitude,
            config.watermark_delay,
        )
        query = (
            cleaned.writeStream
            .format("parquet")
            .outputMode("append")
            .option("path", str(config.output_path))
            .option("checkpointLocation", str(config.checkpoint_path))
            .partitionBy("date", "hour")
            .trigger(processingTime=config.trigger_interval)
            .start()
        )
        log.info(
            "Consuming topic %s from %s; output=%s",
            config.input_topic,
            config.bootstrap_servers,
            config.output_path,
        )
        query.awaitTermination()
    finally:
        spark.stop()


if __name__ == "__main__":
    main()