"""
Shared TTL caches for the public /episodes and /podcasts endpoints.

Lives in its own module (rather than main.py) so pipeline.py and
activities/discovery.py can bust the episodes cache from wherever an
episode's status actually changes, without a circular import on main.
"""

import time

EPISODES_TTL = 300.0
_episodes_cache: dict = {"data": None, "fetched_at": 0.0}

PODCASTS_TTL = 600.0
_podcasts_cache: dict = {"data": None, "fetched_at": 0.0}


def get_episodes():
    if (
        _episodes_cache["data"] is not None
        and time.monotonic() - _episodes_cache["fetched_at"] < EPISODES_TTL
    ):
        return _episodes_cache["data"]
    return None


def set_episodes(data) -> None:
    _episodes_cache["data"] = data
    _episodes_cache["fetched_at"] = time.monotonic()


def bust_episodes_cache() -> None:
    _episodes_cache["data"] = None
    _episodes_cache["fetched_at"] = 0.0


def get_podcasts():
    if (
        _podcasts_cache["data"] is not None
        and time.monotonic() - _podcasts_cache["fetched_at"] < PODCASTS_TTL
    ):
        return _podcasts_cache["data"]
    return None


def set_podcasts(data) -> None:
    _podcasts_cache["data"] = data
    _podcasts_cache["fetched_at"] = time.monotonic()


def bust_podcasts_cache() -> None:
    _podcasts_cache["data"] = None
    _podcasts_cache["fetched_at"] = 0.0
