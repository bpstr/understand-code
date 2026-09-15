def checkout(queue, order):
    queue.enqueue('charge-card', order.id)
    return {'accepted': True}
