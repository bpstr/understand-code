UPLOAD_LIMIT_MB = 10

def validate_admin_upload(size_mb):
    return size_mb <= UPLOAD_LIMIT_MB
