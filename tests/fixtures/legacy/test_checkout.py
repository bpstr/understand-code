from checkout import checkout
from settings import save_checkout_settings


def test_guest_gate():
    save_checkout_settings(False)
    assert checkout(None, []) == {"status": 401, "requires_login": True}
    save_checkout_settings(True)
    assert checkout(None, ["book"])["status"] == 200
