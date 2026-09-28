export const PROTOCOL_VERSION = 2
export const SOCKET_PATH = '/v2/realtime'
export const RECOVERY_MS = 30_000
export const ACK_MS = 5_000
export const RETRY_MS = 30_000
export const TOKEN_MS = 2 * 60 * 60 * 1000
export const RENEW_BEFORE_MS = 5 * 60 * 1000
export const TYPING_MS = 3_000
export const MAX_MESSAGES = 500
export const MAX_CONTENT_LENGTH = 2000

export function validContent(content) {
  return typeof content === 'string' && content.length <= MAX_CONTENT_LENGTH * 2 &&
    [...content].length <= MAX_CONTENT_LENGTH && content.trim().length > 0 &&
    !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(content)
}
