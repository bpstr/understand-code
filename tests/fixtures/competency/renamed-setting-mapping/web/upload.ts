export type UploadPolicy = { maxUploadSize: number };

// The caller passes the API's serialized upload_policy() payload.
export function acceptsUpload(bytes: number, policy: UploadPolicy) {
    return bytes <= policy.maxUploadSize;
}
