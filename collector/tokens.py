"""OAuth2 client-credentials token manager for the OpenSky API.

One instance is shared by all workers. Tokens last 30 minutes, so the
manager caches the token and refreshes it shortly before it expires.
"""
import logging
import threading
import time
from dataclasses import dataclass

import requests

log = logging.getLogger(__name__)

TOKEN_URL = (
    "https://auth.opensky-network.org/auth/realms/opensky-network/"
    "protocol/openid-connect/token"
)
REFRESH_MARGIN_SEC = 60  # refresh this long before the real expiry


class NoAvailableAccount(Exception):
    def __init__(self, retry_after: float):
        super().__init__(f"all accounts are rate limited; retry after {retry_after:.0f}s")
        self.retry_after = retry_after


@dataclass
class _Account:
    client_id: str
    client_secret: str
    token: str | None = None
    expires_at: float = 0.0
    unavailable_until: float = 0.0


class TokenManager:
    def __init__(
        self,
        accounts: list[tuple[str, str]],
        token_url: str = TOKEN_URL,
    ):
        if not accounts:
            raise ValueError("at least one OpenSky account is required")
        self._accounts = [_Account(client_id, secret) for client_id, secret in accounts]
        self._token_url = token_url
        self._lock = threading.Lock()
        self._active_index = 0

    @property
    def account_count(self) -> int:
        return len(self._accounts)

    def get_token(
        self,
        excluded: set[int] | None = None,
    ) -> tuple[int, str]:
        """Return an available account index and valid token (thread-safe)."""
        with self._lock:
            now = time.monotonic()
            excluded = excluded or set()
            indices = [
                (self._active_index + offset) % len(self._accounts)
                for offset in range(len(self._accounts))
            ]
            for index in indices:
                if index in excluded:
                    continue
                account = self._accounts[index]
                if now < account.unavailable_until:
                    continue
                self._active_index = index
                if account.token and now < account.expires_at:
                    return index, account.token
                return index, self._refresh(account)

            retry_after = min(
                max(0.0, account.unavailable_until - now)
                for account in self._accounts
            )
            raise NoAvailableAccount(max(1.0, retry_after))

    def invalidate(self, account_index: int, bad_token: str) -> None:
        """Drop the cached token after a 401.

        Only drops it if it is still the token that failed, so several workers
        hitting 401 at once trigger one refresh, not one each.
        """
        with self._lock:
            account = self._accounts[account_index]
            if account.token == bad_token:
                account.token = None
                account.expires_at = 0.0

    def mark_rate_limited(self, account_index: int, retry_after: float) -> None:
        with self._lock:
            account = self._accounts[account_index]
            account.unavailable_until = time.monotonic() + max(1.0, retry_after)
            self._active_index = (account_index + 1) % len(self._accounts)

    def _refresh(self, account: _Account) -> str:
        r = requests.post(
            self._token_url,
            data={
                "grant_type": "client_credentials",
                "client_id": account.client_id,
                "client_secret": account.client_secret,
            },
            timeout=30,
        )
        r.raise_for_status()
        data = r.json()
        account.token = data["access_token"]
        expires_in = float(data.get("expires_in", 1800))
        account.expires_at = time.monotonic() + max(expires_in - REFRESH_MARGIN_SEC, 0)
        log.info("Fetched new OpenSky token (valid %.0f s)", expires_in)
        return account.token
