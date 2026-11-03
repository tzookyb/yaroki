// Photos are resized to ~1024px WebP on the client, so these are only safety limits.
// Together they keep R2 under its free 10 GB, even if every photo is the largest allowed.
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024
export const MAX_PLANTS = 5000

export const MAX_R2_DELETE_KEYS = 1000
