from settings import checkout_settings


def checkout(user, items):
    if not user and not checkout_settings()["guest_checkout"]:
        return {"status": 401, "requires_login": True}
    return {"status": 200, "order": items, "requires_login": False}


def old_checkout_never_called(items):
    # Legacy implementation: existence is not evidence of reachability.
    return {"order": items}
