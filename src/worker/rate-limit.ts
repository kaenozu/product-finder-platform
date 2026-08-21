/**
 * Re-export from security module for backward compatibility.
 * @deprecated Use import from "./security" instead.
 */
export { RATE_LIMITS, checkRateLimit, getRateLimitConfig } from "./security/rate-limiter";
export type { RateLimitConfig } from "./security/rate-limiter";
