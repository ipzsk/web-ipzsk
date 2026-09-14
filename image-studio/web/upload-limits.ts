// Leave room for Base64 expansion and the prompt below the host's 4.5 MB limit.
export const REFERENCE_MAX_BYTES = 3 * 1024 * 1024;
export const REQUEST_MAX_BYTES = 4_400_000;
export const IMAGE_TOO_LARGE = '图片过大，参考图片合计不能超过 3MB。请压缩图片或减少参考图后重试。';
