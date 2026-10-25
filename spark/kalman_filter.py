"""Per-aircraft constant-velocity Kalman smoothing for Spark streams."""
import math
from collections.abc import Iterator

import numpy as np
import pandas as pd
from pyspark.sql import DataFrame
from pyspark.sql.streaming.state import GroupState, GroupStateTimeout
from pyspark.sql.types import (
	ArrayType,
	BooleanType,
	DoubleType,
	LongType,
	StructField,
	StructType,
	StringType
)

import json

POSITION_STD_METERS = 75.0
VELOCITY_STD_METERS_PER_SECOND = 8.0
ACCELERATION_STD_METERS_PER_SECOND_SQUARED = 3.0
STATE_TIMEOUT_MS = 60 * 60 * 1000

STATE_SCHEMA = StructType(
	[
		StructField("last_time_position", LongType(), nullable=False),
		StructField("kalman_json", StringType(), nullable=False),
	]
)

def _as_finite_float(value: object) -> float | None:
	if value is None or pd.isna(value):
		return None
	result = float(value)
	return result if math.isfinite(result) else None


def _velocity_components(record: dict[str, object]) -> tuple[float, float] | None:
	speed = _as_finite_float(record.get("velocity"))
	track = _as_finite_float(record.get("true_track"))
	if speed is None or track is None or speed < 0 or not 0 <= track <= 360:
		return None

	track_radians = math.radians(track)
	return (
		speed * math.sin(track_radians),
		speed * math.cos(track_radians),
	)


def _predict(
	state_vector: np.ndarray,
	covariance: np.ndarray,
	elapsed_seconds: float,
) -> tuple[np.ndarray, np.ndarray]:
	transition = np.eye(4)
	transition[0, 2] = elapsed_seconds
	transition[1, 3] = elapsed_seconds

	elapsed_squared = elapsed_seconds**2
	elapsed_cubed = elapsed_seconds**3
	elapsed_fourth = elapsed_seconds**4
	acceleration_variance = ACCELERATION_STD_METERS_PER_SECOND_SQUARED**2
	process_noise = acceleration_variance * np.array(
		[
			[elapsed_fourth / 4, 0, elapsed_cubed / 2, 0],
			[0, elapsed_fourth / 4, 0, elapsed_cubed / 2],
			[elapsed_cubed / 2, 0, elapsed_squared, 0],
			[0, elapsed_cubed / 2, 0, elapsed_squared],
		],
		dtype=float,
	)

	predicted_state = transition @ state_vector
	predicted_covariance = transition @ covariance @ transition.T + process_noise
	return predicted_state, predicted_covariance


def _update(
	predicted_state: np.ndarray,
	predicted_covariance: np.ndarray,
	record: dict[str, object],
) -> tuple[np.ndarray, np.ndarray]:
	measurement = [
		_as_finite_float(record.get("x")),
		_as_finite_float(record.get("y")),
	]
	observation_rows = [
		[1.0, 0.0, 0.0, 0.0],
		[0.0, 1.0, 0.0, 0.0],
	]
	measurement_variances = [POSITION_STD_METERS**2] * 2

	velocity = _velocity_components(record)
	if velocity is not None:
		measurement.extend(velocity)
		observation_rows.extend(
			[
				[0.0, 0.0, 1.0, 0.0],
				[0.0, 0.0, 0.0, 1.0],
			]
		)
		measurement_variances.extend(
			[VELOCITY_STD_METERS_PER_SECOND**2] * 2
		)

	observation = np.asarray(measurement, dtype=float)
	observation_matrix = np.asarray(observation_rows, dtype=float)
	measurement_noise = np.diag(measurement_variances)
	innovation = observation - observation_matrix @ predicted_state
	innovation_covariance = (
		observation_matrix @ predicted_covariance @ observation_matrix.T
		+ measurement_noise
	)
	kalman_gain = np.linalg.solve(
		innovation_covariance,
		observation_matrix @ predicted_covariance,
	).T

	updated_state = predicted_state + kalman_gain @ innovation
	residual_matrix = np.eye(4) - kalman_gain @ observation_matrix
	updated_covariance = (
		residual_matrix @ predicted_covariance @ residual_matrix.T
		+ kalman_gain @ measurement_noise @ kalman_gain.T
	)
	updated_covariance = (updated_covariance + updated_covariance.T) / 2
	return updated_state, updated_covariance


def _filter_aircraft(
	key: tuple[object, ...],
	pdf_iterator: Iterator[pd.DataFrame],
	state: GroupState,
) -> Iterator[pd.DataFrame]:
	if state.hasTimedOut:
		state.remove()
		return

	batches = [batch for batch in pdf_iterator if not batch.empty]
	if not batches:
		return

	records = pd.concat(batches, ignore_index=True).sort_values(
		"time_position", kind="stable"
	)
	if state.exists:
		last_time_position, kalman_json = state.get
		stored = json.loads(kalman_json)
		state_vector = np.asarray(stored["x"], dtype=float)
		covariance = np.asarray(stored["P"], dtype=float).reshape(4, 4)
	else:
		last_time_position = None
		state_vector = None
		covariance = None

	smoothed_x: list[float] = []
	smoothed_y: list[float] = []
	kalman_updated: list[bool] = []

	for record in records.to_dict(orient="records"):
		time_position = int(record["time_position"])
		observed_x = _as_finite_float(record.get("x"))
		observed_y = _as_finite_float(record.get("y"))
		if observed_x is None or observed_y is None:
			continue

		velocity = _velocity_components(record)
		if last_time_position is None:
			initial_velocity = velocity or (0.0, 0.0)
			state_vector = np.asarray(
				[observed_x, observed_y, *initial_velocity], dtype=float
			)
			covariance = np.diag(
				[
					POSITION_STD_METERS**2,
					POSITION_STD_METERS**2,
					VELOCITY_STD_METERS_PER_SECOND**2,
					VELOCITY_STD_METERS_PER_SECOND**2,
				]
			)
		elif time_position <= last_time_position:
			smoothed_x.append(observed_x)
			smoothed_y.append(observed_y)
			kalman_updated.append(False)
			continue
		else:
			elapsed_seconds = float(time_position - last_time_position)
			predicted_state, predicted_covariance = _predict(
				state_vector, covariance, elapsed_seconds
			)
			state_vector, covariance = _update(
				predicted_state, predicted_covariance, record
			)

		last_time_position = time_position
		smoothed_x.append(float(state_vector[0]))
		smoothed_y.append(float(state_vector[1]))
		kalman_updated.append(True)

	if last_time_position is None:
		return

	state.update(
		(
			last_time_position,
			json.dumps(
				{
					"x": state_vector.tolist(),
					"P": covariance.ravel().tolist(),
				}
			),
		)
	)
	state.setTimeoutDuration(STATE_TIMEOUT_MS)

	records = records.loc[records["x"].map(_as_finite_float).notna()]
	records = records.loc[records["y"].map(_as_finite_float).notna()].copy()
	records["smoothed_x"] = smoothed_x
	records["smoothed_y"] = smoothed_y
	records["kalman_updated"] = kalman_updated
	yield records


def smooth_flight_positions(dataframe: DataFrame) -> DataFrame:
    """Add stateful smoothed coordinates, keeping raw x/y for comparison."""
    output_schema = StructType(
        list(dataframe.schema.fields)
        + [
            StructField("smoothed_x", DoubleType(), nullable=True),
            StructField("smoothed_y", DoubleType(), nullable=True),
            StructField("kalman_updated", BooleanType(), nullable=False),
        ]
    )

    return dataframe.groupBy("icao24").applyInPandasWithState(
        _filter_aircraft,
        outputStructType=output_schema,
        stateStructType=STATE_SCHEMA,
        outputMode="Append",
        timeoutConf=GroupStateTimeout.ProcessingTimeTimeout,
    )
