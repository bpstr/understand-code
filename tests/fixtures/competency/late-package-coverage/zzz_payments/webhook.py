def payment_webhook(request, retry_payment):
    if request.event == 'payment.failed':
        return retry_payment(request.order_id)
    return None
