def complete_order(bus, order_id):
    bus.publish('order.completed', {'id': order_id})
