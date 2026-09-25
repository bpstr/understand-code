# Producer and consumer joined by a string key

Question: What consumes the event emitted when an order completes?

Expected: connect producer and consumer through the exact `order.completed` key; do not connect the unrelated refund subscription. Missing consumers must remain explicit gaps.
