"""Prepared legacy fixture; no external services."""
STORE = {"guest_checkout": False}
CACHE = {}


def save_checkout_settings(guest_checkout):
    STORE["guest_checkout"] = bool(guest_checkout)
    CACHE.pop("checkout_settings", None)


def checkout_settings():
    if "checkout_settings" not in CACHE:
        CACHE["checkout_settings"] = dict(STORE)
    return CACHE["checkout_settings"]
