"""One Worker = one bounding box = one thread.

Each worker polls /states/all for its box at a fixed rate, converts every
response to an Arrow table, buffers the tables in memory, and writes the
buffer to its own folder as a Parquet file once it reaches the size limit.
"""
import logging
import math
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
import pprint
import pyarrow as pa
import pyarrow.parquet as pq
import requests
from kafka_setup.prod.producer import publish_event
from collector.config import BBox
from collector.tokens import NoAvailableAccount, TokenManager

log = logging.getLogger(__name__)

STATES_URL = "https://opensky-network.org/api/states/all"

# (column, arrow type, index in the API's state-vector array).
# Index 12 (sensors) is skipped: it is always null unless filtering by sensor.
COLUMNS = [
    ("icao24", pa.string(), 0),
    ("callsign", pa.string(), 1),
    ("origin_country", pa.string(), 2),
    ("time_position", pa.int64(), 3),
    ("last_contact", pa.int64(), 4),
    ("longitude", pa.float64(), 5),
    ("latitude", pa.float64(), 6),
    ("baro_altitude", pa.float64(), 7),
    ("on_ground", pa.bool_(), 8),
    ("velocity", pa.float64(), 9),
    ("true_track", pa.float64(), 10),
    ("vertical_rate", pa.float64(), 11),
    ("geo_altitude", pa.float64(), 13),
    ("squawk", pa.string(), 14),
    ("spi", pa.bool_(), 15),
    ("position_source", pa.int8(), 16),
    ("category", pa.int8(), 17),  # only present because we send extended=1
]
SCHEMA = pa.schema(
    [(n, t) for n, t, _ in COLUMNS]
    + [
        ("snapshot_time", pa.int64()),  # API "time" for the whole response
        ("region", pa.string()),        # bbox name
        ("fetched_at", pa.int64()),     # our local UTC epoch seconds
    ]
)


class RateLimited(Exception):
    def __init__(self, retry_after: float):
        super().__init__(f"429, retry after {retry_after:.0f}s")
        self.retry_after = retry_after


class Worker:
    def __init__(
        self,
        bbox: BBox,
        token: TokenManager,
        out_path: Path,
        flush_bytes: int,
        stop: threading.Event,
        start_delay: float = 0.0,
        flush_max_age: float = 0.0,
        compression: str = "zstd",
    ):
        self.bbox = bbox
        self.name = bbox.name
        self.token = token
        self.out_dir = Path(out_path) / bbox.name
        self.flush_bytes = flush_bytes
        self.flush_max_age = flush_max_age
        self.compression = compression
        self.stop = stop
        self.start_delay = start_delay

        self.out_dir.mkdir(parents=True, exist_ok=True)
        self._session = requests.Session()
        self._buf = []
        self._buf_bytes = 0
        self._buf_started = 0.0
        self._seq = 0

    # ------------------------------------------------------------------ loop
    def run(self):
        if self.stop.wait(self.start_delay): 
            return
        interval = self.bbox.interval
        next_t = time.monotonic()
        failures = 0
        log.info("started: %s every %gs", self.bbox, interval)
        try:
            while not self.stop.is_set():
                try:
                    self._poll_once()
                    failures = 0
                except RateLimited as e:
                    log.warning("rate limited, sleeping %.0fs", e.retry_after)
                    if e.retry_after > 300:
                        self._flush("long rate-limit wait")  # don't sit on data for hours
                    self.stop.wait(e.retry_after)
                    next_t = time.monotonic()
                    continue
                except requests.RequestException as e:
                    failures += 1
                    wait = min(300, 5 * 2 ** (failures - 1))
                    log.warning("request failed (%s); retry in %ds", e, wait)
                    self.stop.wait(wait)
                    next_t = time.monotonic()
                    continue
                except Exception:
                    log.exception("unexpected error in poll; continuing")

                self._maybe_flush()

                # fixed-rate schedule: poll times don't drift with request latency
                next_t += interval
                delay = next_t - time.monotonic()
                if delay < 0:
                    log.warning("running %.1fs behind schedule", -delay)
                    next_t = time.monotonic()
                    delay = 0
                self.stop.wait(delay)
        finally:
            self._flush("shutdown")
            log.info("stopped")

    # ----------------------------------------------------------------- fetch
    def _fetch(self) -> dict:
        b = self.bbox
        params = {
            "lamin": b.lamin, "lomin": b.lomin,
            "lamax": b.lamax, "lomax": b.lomax,
            "extended": 1,
        }
        rate_limited_accounts = set()
        while True:
            try:
                account_index, tok = self.token.get_token(rate_limited_accounts)
            except NoAvailableAccount as e:
                raise RateLimited(e.retry_after) from e

            for auth_attempt in (1, 2):
                r = self._session.get(
                    STATES_URL,
                    params=params,
                    headers={"Authorization": f"Bearer {tok}"},
                    timeout=30,
                )
                if r.status_code != 401 or auth_attempt == 2:
                    break
                self.token.invalidate(account_index, tok)
                try:
                    account_index, tok = self.token.get_token(
                        excluded=rate_limited_accounts
                    )
                except NoAvailableAccount as e:
                    raise RateLimited(e.retry_after) from e

            if r.status_code != 429:
                break

            try:
                retry_after = float(
                    r.headers.get("X-Rate-Limit-Retry-After-Seconds", 300)
                )
            except (TypeError, ValueError):
                retry_after = 300.0
            if not math.isfinite(retry_after):
                retry_after = 300.0
            self.token.mark_rate_limited(account_index, max(1.0, retry_after))
            rate_limited_accounts.add(account_index)

        r.raise_for_status()
        self._last_remaining = r.headers.get("X-Rate-Limit-Remaining", "?")
        publish_event(r.json())
        return r.json()

    def _poll_once(self):
        payload = self._fetch()
        table = self._to_table(payload)
        n = 0 if table is None else table.num_rows
        if table is not None:
            if not self._buf:
                self._buf_started = time.monotonic()
            self._buf.append(table)
            self._buf_bytes += table.nbytes
        log.info(
            "rows=%d buffer=%.2f/%.2f MB credits_left=%s",
            n, self._buf_bytes / 2**20, self.flush_bytes / 2**20, self._last_remaining,
        )

    def _to_table(self, payload: dict):
        states = payload.get("states") or []  # API returns null when the box is empty
        if not states:
            return None
        cols = {name: [] for name, _, _ in COLUMNS}
        for row in states:
            for name, _, idx in COLUMNS:
                v = row[idx] if idx < len(row) else None
                if name == "callsign" and isinstance(v, str):
                    v = v.strip() or None
                cols[name].append(v)
        n = len(states)
        cols["snapshot_time"] = [payload.get("time")] * n
        cols["region"] = [self.name] * n
        cols["fetched_at"] = [int(time.time())] * n
        return pa.Table.from_pydict(cols, schema=SCHEMA)

    # ----------------------------------------------------------------- flush
    def _maybe_flush(self):
        if not self._buf:
            return
        if self._buf_bytes >= self.flush_bytes:
            self._flush("size limit")
        elif self.flush_max_age and time.monotonic() - self._buf_started >= self.flush_max_age:
            self._flush("max age")

    def _flush(self, reason: str):
        if not self._buf:
            return
        table = pa.concat_tables(self._buf)
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        final = self.out_dir / f"{self.name}_{ts}_{self._seq:05d}.parquet"
        # Write to a hidden temp name, then rename: readers (e.g. Spark, which
        # ignores dot-files) never see a half-written Parquet file.
        tmp = self.out_dir / f".{final.name}.tmp"
        try:
            pq.write_table(table, tmp, compression=self.compression)
            os.replace(tmp, final)
        except OSError:
            log.exception("could not write %s; keeping buffer and retrying later", final.name)
            return
        log.info(
            "flushed %d rows -> %s (%.2f MB on disk, reason: %s)",
            table.num_rows, final.name, final.stat().st_size / 2**20, reason,
        )
        self._seq += 1
        self._buf, self._buf_bytes = [], 0
