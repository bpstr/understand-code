UPLOAD_LIMIT_MB = 250

def validate_media_upload(size_mb):
    return size_mb <= UPLOAD_LIMIT_MB
