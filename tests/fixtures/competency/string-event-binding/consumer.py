def register(bus, send_receipt):
    bus.subscribe('order.completed', send_receipt)
    bus.subscribe('order.refunded', lambda event: None)
