from checkout import checkout
from settings import save_checkout_settings

ROUTES = {
    "POST /api/checkout": checkout,
    "PUT /api/settings/checkout": save_checkout_settings,
}

# No HTTP server binds this table in the fixture: that link must remain UNKNOWN.
