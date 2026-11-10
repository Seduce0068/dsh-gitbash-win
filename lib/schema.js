/**
 * Config schema factory for `dsh-gitbash-win`.
 *
 * One schema is shared by the profile row (the `dsh-gitbash-win` plugin in
 * `cordis.patch.yml`) and by the privately mounted `GitBashExecutor`, exactly
 * as `DESIGN.md` §3.1 requires. It is built from the host's own
 * `@deepseek-ai/schemastery` instance, so the produced schema is accepted by
 * cordis' config validation unchanged.
 *
 * The fields are deliberately **not** `.volatile()`: every value the executor
 * reads is captured in its constructor and the base executor mechanics are
 * fed the same flat values (see `executor.js`). A settings change therefore
 * reloads the row (HMR) and mounts a fresh executor instead of mutating a
 * running one; the old command processes stay owned by `ctx.subprocess` and are
 * not killed by an executor-only reload (the official contract).
 *
 * @module dsh-gitbash-win/schema
 */

/** Default timeout for one command (ms). */
export const DEFAULT_TIMEOUT_MS = 120_000
/** Upper bound a caller may request for one command (ms). */
export const DEFAULT_MAX_TIMEOUT_MS = 600_000
/** Default retained-bytes cap per output stream. */
export const DEFAULT_MAX_OUTPUT_BYTES = 64_000
/** Default spill-file cap per output stream (64 MiB). */
export const DEFAULT_MAX_SPILL_BYTES = 64 * 1024 * 1024
/** Default SIGTERM -> SIGKILL grace period (ms). */
export const DEFAULT_GRACE_MS = 3_000
/** The only two fail-closed/fallback values accepted for `sandboxFallback`. */
export const SANDBOX_FALLBACKS = Object.freeze(['fail', 'unconfined'])

/**
 * Build the plugin Config schema.
 * @param {import('@deepseek-ai/schemastery').default} z - the host schemastery
 *   function, resolved through `hostImport` in `executor.js`.
 * @returns {import('@deepseek-ai/schemastery').Schema} the shared schema.
 */
export function makeConfig(z) {
  if (typeof z !== 'function' || typeof z.object !== 'function') {
    throw new TypeError('dsh-gitbash-win: makeConfig(z) requires the host @deepseek-ai/schemastery module')
  }
  return z.object({
    /** Default execution cwd; the empty string means "use the session cwd". */
    cwd: z.string().default(''),
    /** Default per-command timeout (ms). */
    timeoutMs: z.number().default(DEFAULT_TIMEOUT_MS),
    /** Upper bound for a caller-requested timeout (ms). */
    maxTimeoutMs: z.number().default(DEFAULT_MAX_TIMEOUT_MS),
    /** Retained bytes cap for one output stream. */
    maxOutputBytes: z.number().default(DEFAULT_MAX_OUTPUT_BYTES),
    /** Spill-file cap for one output stream. */
    maxSpillBytes: z.number().default(DEFAULT_MAX_SPILL_BYTES),
    /** SIGTERM -> SIGKILL grace period (ms). */
    graceMs: z.number().default(DEFAULT_GRACE_MS),
    /** Explicit Git for Windows `bash.exe`; empty means auto-detection. */
    bashPath: z.string().default(''),
    /** Init script passed to bash as `BASH_ENV`; empty means none, `~` expands. */
    initScript: z.string().default(''),
    /** Behavior when a confining mode is requested but the ACL runner is unusable. */
    sandboxFallback: z.union([...SANDBOX_FALLBACKS]).default('fail'),
  })
}
