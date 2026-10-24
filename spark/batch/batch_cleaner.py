
from pathlib import Path

from pyspark.sql import SparkSession
from pyspark.sql import functions as F
from pyspark.sql.window import Window

PROJECT_ROOT = Path(__file__).resolve().parents[2]
INPUT_PATH = PROJECT_ROOT / "Data" / "test-1"
OUTPUT_PATH = PROJECT_ROOT / "Data" / "cleaned" / "test-1"
EARTH_RADIUS_METERS = 6_371_000


def clean_records(df_raw):
    required_columns = {"icao24", "time_position", "latitude", "longitude"}
    missing_columns = required_columns.difference(df_raw.columns)
    if missing_columns:
        raise ValueError(f"Input is missing required columns: {sorted(missing_columns)}")

    valid_position = (
        F.col("latitude").between(-90, 90)
        & F.col("longitude").between(-180, 180)
    )
    valid_key = (
        F.col("icao24").isNotNull()
        & (F.trim(F.col("icao24")) != "")
        & F.col("time_position").isNotNull()
    )

    position_rejects = df_raw.filter(~F.coalesce(valid_position, F.lit(False)))
    key_rejects = df_raw.filter(~F.coalesce(valid_key, F.lit(False)))
    candidates = df_raw.filter(
        F.coalesce(valid_position & valid_key, F.lit(False))
    )

    dedup_order = Window.partitionBy("icao24", "time_position").orderBy(
        F.col("fetched_at").desc_nulls_last()
        if "fetched_at" in df_raw.columns
        else F.col("time_position").desc(),
        F.col("last_contact").desc_nulls_last()
        if "last_contact" in df_raw.columns
        else F.col("time_position").desc(),
    )
    deduplicated = (
        candidates.withColumn("_fix_rank", F.row_number().over(dedup_order))
        .filter(F.col("_fix_rank") == 1)
        .drop("_fix_rank")
    )

    bounds = deduplicated.agg(
        F.min("latitude").alias("min_lat"),
        F.max("latitude").alias("max_lat"),
        F.min("longitude").alias("min_lon"),
        F.max("longitude").alias("max_lon"),
    ).first()
    if bounds.min_lat is None:
        reference_latitude = 0.0
        reference_longitude = 0.0
    else:
        reference_latitude = (bounds.min_lat + bounds.max_lat) / 2
        reference_longitude = (bounds.min_lon + bounds.max_lon) / 2

    reference_latitude_rad = F.radians(F.lit(reference_latitude))
    cleaned = (
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
    )

    return (
        cleaned,
        position_rejects,
        key_rejects,
        candidates,
        reference_latitude,
        reference_longitude,
    )


def main():
    spark = (
        SparkSession.builder
        .appName("FlightTracking-BatchCleaner")
        .getOrCreate()
    )

    try:
        df_raw = spark.read.parquet(str(INPUT_PATH))
        raw_count = df_raw.count()
        (
            cleaned,
            position_rejects,
            key_rejects,
            candidates,
            reference_latitude,
            reference_longitude,
        ) = clean_records(df_raw)
        position_reject_count = position_rejects.count()
        key_reject_count = key_rejects.count()
        candidate_count = candidates.count()
        cleaned_count = cleaned.count()
        duplicate_count = candidate_count - cleaned_count

        OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        cleaned.write.mode("overwrite").parquet(str(OUTPUT_PATH))

        print("=== CLEANING SUMMARY ===")
        print(f"Input rows: {raw_count}")
        print(f"Rejected missing/invalid positions: {position_reject_count}")
        print(f"Rejected missing aircraft/fix key: {key_reject_count}")
        print(f"Removed duplicate aircraft/fix rows: {duplicate_count}")
        print(f"Total rows discarded: {raw_count - cleaned_count}")
        print(f"Clean rows: {cleaned_count}")
        print(
            "Projection reference (latitude, longitude): "
            f"({reference_latitude:.6f}, {reference_longitude:.6f})"
        )
        print(f"Output: {OUTPUT_PATH}")
        cleaned.printSchema()

    finally:
        spark.stop()


if __name__ == "__main__":
    main()
