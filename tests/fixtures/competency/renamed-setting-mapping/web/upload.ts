export const maxUploadSize = 10 * 1024 * 1024;
export function acceptsUpload(bytes: number) { return bytes <= maxUploadSize; }
