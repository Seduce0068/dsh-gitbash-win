/**
 * Config schema factory for `dsh-gitbash-win`.
 *
 * One schema is shared by the profile row (the `dsh-gitbash-win` plugin in
 * `cordis.patch.yml`) and by the privately mounted `GitBashExecutor`, exactly
 * as `DESIGN.md` §3.1 requires. It is built from the host's own
 * `@deepseek-ai/schemastery` instance, so the produced schema is accepted by
 * cordis' config validation unchanged.
 *
 * All fields except `sandboxFallback` are `.volatile()`, exactly like the
 * official shell executors: the Host settings document only serves a form for
 * volatile schema nodes (that is what makes the Web settings card appear), and
 * a save edits the row's refs in place instead of reloading the row. The
 * mounted executor reads the live row values through the `liveConfigReader`
 * installed by `lib/index.js`, while the base executor mechanics receive a
 * plain snapshot at mount time.
 *
 * `sandboxFallback` is deliberately NON-volatile: it changes which sandbox
 * mode the official bash tool advertises at mount time, so a live in-place
 * change would desynchronise the advertised policy from the execution route.
 * A change therefore reloads the plugin row (both the executor and the mounted
 * tool are re-created with the new value) or applies on the next host start.
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
 * The single canonical field vocabulary of the row/executor config: the one
 * place a field name and its default are declared. Everything else
 * (`makeConfig`, the executor projection, the host row forwarding) derives
 * from this object, so adding a field cannot silently desynchronise copies.
 */
export const CONFIG_FIELD_DEFAULTS = Object.freeze({
  cwd: '',
  timeoutMs: DEFAULT_TIMEOUT_MS,
  maxTimeoutMs: DEFAULT_MAX_TIMEOUT_MS,
  maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
  maxSpillBytes: DEFAULT_MAX_SPILL_BYTES,
  graceMs: DEFAULT_GRACE_MS,
  bashPath: '',
  initScript: '',
  sandboxFallback: 'fail',
})

/** Every config field name, in schema order. */
export const CONFIG_FIELD_NAMES = Object.freeze(Object.keys(CONFIG_FIELD_DEFAULTS))

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
    cwd: z.string().default(CONFIG_FIELD_DEFAULTS.cwd).volatile(),
    /** Default per-command timeout (ms). */
    timeoutMs: z.number().default(CONFIG_FIELD_DEFAULTS.timeoutMs).volatile(),
    /** Upper bound for a caller-requested timeout (ms). */
    maxTimeoutMs: z.number().default(CONFIG_FIELD_DEFAULTS.maxTimeoutMs).volatile(),
    /** Retained bytes cap for one output stream. */
    maxOutputBytes: z.number().default(CONFIG_FIELD_DEFAULTS.maxOutputBytes).volatile(),
    /** Spill-file cap for one output stream. */
    maxSpillBytes: z.number().default(CONFIG_FIELD_DEFAULTS.maxSpillBytes).volatile(),
    /** SIGTERM -> SIGKILL grace period (ms). */
    graceMs: z.number().default(CONFIG_FIELD_DEFAULTS.graceMs).volatile(),
    /** Explicit Git for Windows `bash.exe`; empty means auto-detection. */
    bashPath: z.string().default(CONFIG_FIELD_DEFAULTS.bashPath).volatile(),
    /** Init script passed to bash as `BASH_ENV`; empty means none, `~` expands. */
    initScript: z.string().default(CONFIG_FIELD_DEFAULTS.initScript).volatile(),
    /** Behavior when a confining mode is requested but the ACL runner is unusable.
     *  Non-volatile: a change reloads the row so the tool's advertised mode and
     *  the executor route cannot diverge (see the module note above). */
    sandboxFallback: z.union([...SANDBOX_FALLBACKS]).default(CONFIG_FIELD_DEFAULTS.sandboxFallback),
  })
}
