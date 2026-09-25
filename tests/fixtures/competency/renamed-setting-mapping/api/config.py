MAX_ATTACHMENT_BYTES = 10485760


def attachment_limit():
    return MAX_ATTACHMENT_BYTES


def accepts_attachment(size_bytes):
    return size_bytes <= attachment_limit()


def upload_policy():
    # This serialized field is the explicit API/frontend mapping.
    return {'maxUploadSize': attachment_limit()}
