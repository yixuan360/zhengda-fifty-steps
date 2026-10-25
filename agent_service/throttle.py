"""轻量进程内限流（单实例部署足够；多实例可换成 Redis）。"""
import threading
import time


class RateLimiter:
    """固定窗口计数：同一 key 在 window_seconds 内最多 limit 次。"""

    def __init__(self, limit, window_seconds=60, max_keys=5000):
        self.limit = max(1, int(limit))
        self.window_seconds = max(1, int(window_seconds))
        self.max_keys = max(1, int(max_keys))
        self._hits = {}
        self._lock = threading.Lock()

    def allow(self, key):
        now = time.monotonic()
        with self._lock:
            if len(self._hits) >= self.max_keys and key not in self._hits:
                self._purge(now)
                while len(self._hits) >= self.max_keys:
                    oldest = min(
                        self._hits, key=lambda item: self._hits[item][0],
                    )
                    self._hits.pop(oldest, None)
            start, count = self._hits.get(key, (now, 0))
            if now - start >= self.window_seconds:
                self._hits[key] = (now, 1)
                return True
            if count >= self.limit:
                return False
            self._hits[key] = (start, count + 1)
            return True

    def _purge(self, now):
        stale = [
            key for key, (start, _) in self._hits.items()
            if now - start >= self.window_seconds
        ]
        for key in stale:
            self._hits.pop(key, None)

    def reset(self):
        with self._lock:
            self._hits.clear()
