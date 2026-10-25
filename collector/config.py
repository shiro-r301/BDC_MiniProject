"""Reads and validates configuration from environment variables (.env)."""
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path

NAME_RE = re.compile(r"^[A-Za-z0-9_-]+$")
MIN_INTERVAL_SEC = 5  # authenticated OpenSky time resolution is 5 s


class ConfigError(Exception):
    pass


@dataclass(frozen=True)
class BBox:
    name: str
    lamin: float
    lomin: float
    lamax: float
    lomax: float
    interval: float  # seconds between polls

    @property
    def area(self) -> float:
        return (self.lamax - self.lamin) * (self.lomax - self.lomin)

    @property
    def credits_per_call(self) -> int:
        # OpenSky /states/all cost by bounding-box area (sq. degrees)
        a = self.area
        if a <= 25:
            return 1
        if a <= 100:
            return 2
        if a <= 400:
            return 3
        return 4

    @property
    def credits_per_day(self) -> float:
        return self.credits_per_call * 86400 / self.interval


@dataclass(frozen=True)
class Config:
    accounts: list[tuple[str, str]]
    bboxes: list
    out_dir: Path
    flush_bytes: int
    flush_max_age_sec: float  # 0 = disabled
    compression: str
    daily_credit_budget: int


def _require(name: str) -> str:
    v = os.environ.get(name, "").strip()
    if not v:
        raise ConfigError(f"Missing required environment variable {name}")
    return v


def _load_accounts() -> list[tuple[str, str]]:
    raw = os.environ.get("OPENSKY_ACCOUNTS", "").strip()
    if not raw:
        return [
            (
                _require("OPENSKY_CLIENT_ID"),
                _require("OPENSKY_CLIENT_SECRET"),
            )
        ]

    try:
        items = json.loads(raw)
        
    except json.JSONDecodeError as e:
        raise ConfigError(f"OPENSKY_ACCOUNTS is not valid JSON: {e}")
    if not isinstance(items, list) or not items:
        raise ConfigError("OPENSKY_ACCOUNTS must be a non-empty JSON list")

    accounts = []
    seen = set()
    for i, item in enumerate(items):
        if not isinstance(item, dict):
            raise ConfigError(f"OPENSKY_ACCOUNTS[{i}] must be an object")
        client_id = item.get("client_id")
        client_secret = item.get("client_secret")
        if not isinstance(client_id, str) or not client_id.strip():
            raise ConfigError(f"OPENSKY_ACCOUNTS[{i}] needs a non-empty client_id")
        if not isinstance(client_secret, str) or not client_secret.strip():
            raise ConfigError(f"OPENSKY_ACCOUNTS[{i}] needs a non-empty client_secret")
        client_id = client_id.strip()
        if client_id in seen:
            raise ConfigError(f"Duplicate client_id in OPENSKY_ACCOUNTS[{i}]")
        seen.add(client_id)
        accounts.append((client_id, client_secret.strip()))
    return accounts


def _parse_bboxes(raw: str, default_interval: float) -> list:
    try:
        items = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ConfigError(f"BBOXES is not valid JSON: {e}")
    if not isinstance(items, list) or not items:
        raise ConfigError("BBOXES must be a non-empty JSON list")

    boxes, seen = [], set()
    for i, it in enumerate(items):
        try:
            b = BBox(
                name=str(it["name"]),
                lamin=float(it["lamin"]),
                lomin=float(it["lomin"]),
                lamax=float(it["lamax"]),
                lomax=float(it["lomax"]),
                interval=float(it.get("interval", default_interval)),
            )
        except (KeyError, TypeError, ValueError) as e:
            raise ConfigError(
                f"BBOXES[{i}] needs name, lamin, lomin, lamax, lomax "
                f"(optional interval): {e!r}"
            )
        if not NAME_RE.match(b.name):
            raise ConfigError(f"BBOXES[{i}] name {b.name!r}: use letters, digits, _ or - only")
        if b.name in seen:
            raise ConfigError(f"Duplicate bbox name {b.name!r}")
        seen.add(b.name)
        if not (-90 <= b.lamin < b.lamax <= 90):
            raise ConfigError(f"{b.name}: need -90 <= lamin < lamax <= 90")
        if not (-180 <= b.lomin < b.lomax <= 180):
            raise ConfigError(
                f"{b.name}: need -180 <= lomin < lomax <= 180 "
                "(boxes crossing the antimeridian must be split in two)"
            )
        if b.interval < MIN_INTERVAL_SEC:
            raise ConfigError(f"{b.name}: interval must be >= {MIN_INTERVAL_SEC} s")
        boxes.append(b)
    return boxes


def load_config() -> Config:
    default_interval = float(os.environ.get("POLL_INTERVAL_SEC", "90"))
    return Config(
        accounts=_load_accounts(),
        bboxes=_parse_bboxes(_require("BBOXES"), default_interval),
        out_dir=Path(os.environ.get("OUT_DIR", "./data")),
        flush_bytes=int(float(os.environ.get("FLUSH_SIZE_MB", "64")) * 1024 * 1024),
        flush_max_age_sec=float(os.environ.get("FLUSH_MAX_AGE_SEC", "0")),
        compression=os.environ.get("PARQUET_COMPRESSION", "zstd"),
        daily_credit_budget=int(os.environ.get("DAILY_CREDIT_BUDGET", "4000")),
    )


def budget_report(cfg: Config) -> tuple:
    """Returns (text, within_budget). Credits are shared across workers and accounts."""
    account_budget = cfg.daily_credit_budget * len(cfg.accounts)
    lines = [
        f"Projected API credit usage (all workers share {len(cfg.accounts)} account(s)):"
    ]
    total = 0.0
    for b in cfg.bboxes:
        lines.append(
            f"  {b.name:<16} {b.area:>8.1f} sq deg  {b.credits_per_call} cr/call  "
            f"every {b.interval:g}s  ->  {b.credits_per_day:,.0f} cr/day"
        )
        total += b.credits_per_day
    ok = total <= account_budget
    lines.append(
        f"  TOTAL {total:,.0f} cr/day vs budget {account_budget:,} "
        f"-> {'OK' if ok else 'OVER BUDGET: you will hit 429s before the day ends'}"
    )
    return "\n".join(lines), ok
