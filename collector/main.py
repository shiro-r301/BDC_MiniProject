"""Entry point:  python -m collector.main   (run from the project root)."""
import logging
import signal
import sys
import threading

from dotenv import load_dotenv

from collector.config import ConfigError, budget_report, load_config
from collector.tokens import TokenManager
from collector.worker import Worker


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(threadName)s] %(message)s",
        datefmt="%H:%M:%S",
    )
    load_dotenv()
    try:
        cfg = load_config()
    except ConfigError as e:
        print(f"Config error: {e}", file=sys.stderr)
        return 2

    report, ok = budget_report(cfg)
    print(report)
    if not ok:
        print("WARNING: raise the intervals or shrink the boxes (continuing anyway).")

    stop = threading.Event()

    def _shutdown(signum, _frame):
        logging.getLogger(__name__).info("signal %s received, flushing and stopping...", signum)
        stop.set()

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    token = TokenManager(cfg.accounts)
    n = len(cfg.bboxes)
    workers = [
        Worker(
            bbox=b,
            token=token,
            out_path=cfg.out_dir,
            flush_bytes=cfg.flush_bytes,
            stop=stop,
            start_delay=i * b.interval / n,  # spread first polls across one interval
            flush_max_age=cfg.flush_max_age_sec,
            compression=cfg.compression,
        )
        for i, b in enumerate(cfg.bboxes)
    ]

    threads = [
        threading.Thread(target=w.run, name=w.name, daemon=False) for w in workers
    ]
    for t in threads:
        t.start()

    # Keep the main thread alive; short joins so Ctrl+C is handled promptly.
    while any(t.is_alive() for t in threads):
        for t in threads:
            t.join(timeout=0.5)
    return 0


if __name__ == "__main__":
    sys.exit(main())
