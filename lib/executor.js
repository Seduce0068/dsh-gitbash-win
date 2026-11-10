/**
 * Private Git for Windows bash executor for `dsh-gitbash-win`.
 *
 * The executor extends the official `@deepseek-ai/dsh-bash-sandbox`
 * `SandboxBashExecutor`, so command lifecycle, output bounding/spill,
 * timeout/deadline classification, subprocess ownership, and the sandbox
 * result/documentation vocabulary are the host's own. Only the executable
 * boundary is replaced: every command runs as
 * `[<git-bash.exe>, '-c', <command>]` — one argv element, never a shell.
 *
 * Routing (`DESIGN.md` §3.2):
 * - `danger-full-access` (or no policy at all): spawn Git Bash directly.
 * - confining mode + `sandboxFallback: 'fail'`: delegate to the official
 *   `SandboxBashExecutor.execute()`, which wraps the exact argv through
 *   `ctx.sandbox.confine()`; a `SandboxUnavailableError` propagates
 *   (fail-closed).
 * - confining mode + `sandboxFallback: 'unconfined'` (explicit opt-in): spawn
 *   directly and honestly label the result `enforcement: 'unconfined'`.
 * - Missing Git Bash always throws — the executor never falls back to
 *   `pwsh.exe`, `cmd.exe`, or a WSL bash.
 *
 * @module dsh-gitbash-win/executor
 */
import { homedir as osHomedir } from 'node:os'
import { hostImport } from './host-modules.js'
import { expandHomePath, resolveGitBash } from './detect.js'
import { makeConfig, DEFAULT_GRACE_MS, DEFAULT_MAX_OUTPUT_BYTES, DEFAULT_MAX_SPILL_BYTES, DEFAULT_MAX_TIMEOUT_MS, DEFAULT_TIMEOUT_MS } from './schema.js'

// Host packages cannot be bare-imported from an out-of-tree plugin; the
// createRequire chain in host-modules.js resolves them from the running DSH
// installation. Top-level await keeps every import static for the class body.
const { SandboxBashExecutor } = await hostImport('@deepseek-ai/dsh-bash-sandbox')
const { ENV_OVERRIDES } = await hostImport('@deepseek-ai/dsh-bash-local')
const { MAX_TIMER_DELAY_MS, clampTimeout } = await hostImport('@deepseek-ai/dsh-timeout')
const { SandboxUnavailableError } = await hostImport('@deepseek-ai/dsh-sandbox')
const z = (await hostImport('@deepseek-ai/schemastery')).default

/** The Config schema shared by the profile row and the private executor. */
export const Config = makeConfig(z)

/** Stable error code for "no Git Bash could be found" (fail-closed). */
export const GITBASH_UNAVAILABLE = 'GITBASH_UNAVAILABLE'

/**
 * The fail-closed user-facing message (`DESIGN.md` §3.3). There is no
 * alternative-shell fallback, and the text says so explicitly.
 */
export const GITBASH_UNAVAILABLE_MESSAGE =
  'dsh-gitbash-win: Git for Windows の bash.exe が見つからないためコマンドを実行できません。\n' +
  'Git for Windows をインストールするか、Settings → Plugins → Git Bash で bashPath を設定してください。\n' +
  '(代替シェルへの自動 fallback は行いません)'

/**
 * Guidance appended to a `SANDBOX_UNAVAILABLE` failure raised by the official
 * confining path (`DESIGN.md` §3.2/§11). Git Bash + the Windows ACL restricted
 * token/Low-integrity runner is unverified, so the operator gets the documented
 * escape hatches — never an automatic unconfined retry.
 */
export const SANDBOX_UNAVAILABLE_HINT =
  'dsh-gitbash-win: Git Bash を Windows ACL sandbox で実行できませんでした（Git Bash + Windows ACL の互換性は未検証です）。' +
  '公式 pwsh ツールでその操作を行うか、danger-full-access へ切り替えるか、sandboxFallback: unconfined を明示してください。'

/**
 * NTSTATUS exit codes that mean an MSYS shell (Git for Windows) could not
 * initialize under a Windows restricted token — measured on a real Windows
 * host with the official ACL runner (0xC0000142 / STATUS_DLL_INIT_FAILED;
 * 0xC0000005 and 0xC00000FD are the same class of CRT/loader failure). The
 * command never ran, so this is reported as `SANDBOX_UNAVAILABLE` instead of a
 * cryptic command exit code — never retried unconfined.
 */
export const RESTRICTED_TOKEN_SHELL_CRASH_CODES = Object.freeze(
  [0xc0000142, 0xc0000005, 0xc00000fd].map((code) => code >>> 0),
)

/**
 * Whether a settled foreground exit code is the known MSYS/restricted-token
 * startup crash. Normalizes signed values Node may report on Windows.
 * @param {number|null|undefined} exitCode - process exit code.
 * @returns {boolean} true when the code is a known shell-startup failure.
 */
export function isRestrictedTokenShellCrash(exitCode) {
  return Number.isInteger(exitCode) && RESTRICTED_TOKEN_SHELL_CRASH_CODES.includes(exitCode >>> 0)
}

/** Defaults used when a field is absent from a raw/ref-shaped config object. */
const FIELD_DEFAULTS = Object.freeze({
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

/**
 * Read one config field from either a plain value (the private mount receives
 * plain snapshot values) or a schemastery volatile ref (`{ get() }`, the shape
 * host executors use). Both are accepted so the executor works whether it is
 * mounted from `lib/index.js` or configured through a ref-carrying schema.
 * @param {object|undefined} config - the live config section.
 * @param {keyof typeof FIELD_DEFAULTS} name - field name.
 * @returns {unknown} the field value, or its documented default.
 */
function readField(config, name) {
  const field = config?.[name]
  if (field === undefined || field === null) return FIELD_DEFAULTS[name]
  if (typeof field === 'object' && typeof field.get === 'function') {
    const value = field.get()
    return value === undefined || value === null ? FIELD_DEFAULTS[name] : value
  }
  return field
}

/** Assert a config number is positive and finite (base mechanics require it). */
function assertPositiveFinite(name, value) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`gitbash-win: ${name} must be a positive finite number`)
}

/**
 * Reject a config the base executor mechanics could not run with. The schema
 * expresses neither "positive and finite" nor the timer bound `graceMs` needs.
 * @param {ReturnType<GitBashExecutor['configValues']>} values - the plain config snapshot.
 */
function assertServiceableConfig(values) {
  assertPositiveFinite('timeoutMs', values.timeoutMs)
  assertPositiveFinite('maxTimeoutMs', values.maxTimeoutMs)
  assertPositiveFinite('maxOutputBytes', values.maxOutputBytes)
  assertPositiveFinite('maxSpillBytes', values.maxSpillBytes)
  assertPositiveFinite('graceMs', values.graceMs)
  if (values.graceMs > MAX_TIMER_DELAY_MS) throw new Error(`gitbash-win: graceMs must be no greater than ${MAX_TIMER_DELAY_MS}`)
}

/**
 * Append the Git-Bash-specific sandbox guidance to a fail-closed
 * `SANDBOX_UNAVAILABLE` error while preserving the original error (and its
 * `code`, which the tool layer maps to the structured result).
 * @param {unknown} error - the thrown value.
 * @returns {unknown} the same error, with guidance appended when applicable.
 */
function augmentSandboxUnavailableError(error) {
  if (error === null || typeof error !== 'object') return error
  if (error.code !== 'SANDBOX_UNAVAILABLE') return error
  if (typeof error.message !== 'string' || error.message.includes('dsh-gitbash-win:')) return error
  try {
    error.message = `${error.message}\n${SANDBOX_UNAVAILABLE_HINT}`
  } catch {
    /* a frozen error keeps its original message; the code still fails closed */
  }
  return error
}

/**
 * Pure routing decision for one execution (`DESIGN.md` §3.2), exported so the
 * matrix can be unit-tested without mounting a context.
 *
 * Accepts either a resolved execution spec (`{ sandboxPolicy: { mode } }`) or a
 * bare sandbox policy (`{ mode }`), so callers cannot get the two shapes
 * confused.
 * @param {{ sandboxPolicy?: { mode?: string }|null, mode?: string }|undefined} spec - spec or policy.
 * @param {'fail'|'unconfined'} [sandboxFallback] - the configured fallback.
 * @returns {{ route: 'direct'|'confined'|'unconfined', mode: string }} the selected route and mode.
 */
export function gitBashRoute(spec, sandboxFallback = 'fail') {
  const policy = spec?.sandboxPolicy ?? spec
  const mode = policy?.mode
  if (mode === undefined || mode === null || mode === 'danger-full-access') {
    return { route: 'direct', mode: mode ?? 'danger-full-access' }
  }
  if (sandboxFallback === 'unconfined') return { route: 'unconfined', mode }
  return { route: 'confined', mode }
}

/**
 * Git for Windows bash executor. Registers as `ctx.shell` in whatever context
 * it is mounted in; `lib/index.js` mounts it inside `ctx.isolate('shell')`, so
 * the root `ctx.shell` (the official PowerShell executor on Windows) is never
 * replaced.
 */
export class GitBashExecutor extends SandboxBashExecutor {
  /** The shared row/executor Config schema. */
  static Config = Config

  /** One-shot latch for the explicit unconfined-fallback warning. */
  warnedUnconfined = false
  /** One-shot latch for a configured-path detection warning. */
  warnedDetection = false

  /**
   * The plain config snapshot this executor reads. Accepts both mount shapes
   * (plain values from `scope.plugin(...)`, refs from a volatile schema).
   * @returns {typeof FIELD_DEFAULTS} plain field values.
   */
  configValues() {
    const config = this.config
    return {
      cwd: String(readField(config, 'cwd')),
      timeoutMs: readField(config, 'timeoutMs'),
      maxTimeoutMs: readField(config, 'maxTimeoutMs'),
      maxOutputBytes: readField(config, 'maxOutputBytes'),
      maxSpillBytes: readField(config, 'maxSpillBytes'),
      graceMs: readField(config, 'graceMs'),
      bashPath: String(readField(config, 'bashPath')),
      initScript: String(readField(config, 'initScript')),
      sandboxFallback: readField(config, 'sandboxFallback'),
    }
  }

  /**
   * The sandbox mode the model-facing tool layer may advertise escalation for.
   *
   * With the default fail-closed fallback this is the deployment's
   * `sandboxPolicy.defaultMode`. With the explicit `'unconfined'` fallback it
   * is `undefined`: the official tool then advertises no escalation fields and
   * treats this executor as unsandboxed, which is exactly what it is — no
   * misleading "protected" presentation (`DESIGN.md` §3.2).
   * @returns {string|undefined} the effective default mode, when confining.
   */
  get sandboxMode() {
    if (this.configValues().sandboxFallback === 'unconfined') return undefined
    return this.ctx.sandboxPolicy?.defaultMode
  }

  /**
   * Resolve a request into a fully-specified spec. Mirrors
   * `LocalBashExecutor.resolve()` but reads the plain config values directly
   * (the parent's version assumes volatile `{ get() }` refs), and treats an
   * empty `cwd` as "use the process cwd" (`DESIGN.md` §3.1).
   * @param {object} request - caller request.
   * @returns {object} the resolved spec, including the per-call sandbox policy.
   */
  resolve(request = {}) {
    const values = this.configValues()
    assertServiceableConfig(values)
    const timeoutMs = clampTimeout(request.timeoutMs, values.timeoutMs, values.maxTimeoutMs, 'gitbash-win: request.timeoutMs')
    const stdoutMaxBytes = request.stdoutMaxBytes ?? values.maxOutputBytes
    assertPositiveFinite('request.stdoutMaxBytes', stdoutMaxBytes)
    const policy = request.sandboxPolicy ?? this.ctx.sandboxPolicy?.resolve?.()
    return {
      command: request.command,
      workdir: request.workdir ?? (values.cwd.length > 0 ? values.cwd : process.cwd()),
      timeoutMs,
      onExpiry: request.onExpiry ?? 'kill',
      stdoutMaxBytes,
      ...(request.signal ? { signal: request.signal } : {}),
      ...(request.stdin !== undefined ? { stdin: request.stdin } : {}),
      ...(request.env !== undefined ? { env: request.env } : {}),
      ...(request.dshEnv !== undefined ? { dshEnv: request.dshEnv } : {}),
      sandboxPolicy: policy,
    }
  }

  /**
   * Map one resolved spec and its explicit argv onto a subprocess spawn,
   * exactly like `LocalBashExecutor.spawnSpec` (same model-friendly
   * `ENV_OVERRIDES`, output bounds, spill caps, and managed-range grace),
   * reading the plain config values instead of volatile refs.
   * @param {object} spec - resolved execution spec.
   * @param {string[]} argv - the exact executable argv.
   * @param {number} stdoutMaxBytes - stdout capture budget.
   * @param {AbortSignal|undefined} signal - fused deadline/cancellation signal.
   * @returns {object} the subprocess spawn spec.
   */
  spawnSpec(spec, argv, stdoutMaxBytes, signal) {
    const values = this.configValues()
    const collect = (maxBytes) => ({ maxBytes, spill: { maxBytes: values.maxSpillBytes } })
    return {
      argv: [...argv],
      cwd: spec.workdir,
      stdio: {
        stdin: spec.stdin !== undefined ? { data: spec.stdin } : 'ignore',
        stdout: collect(stdoutMaxBytes),
        stderr: collect(values.maxOutputBytes),
      },
      graceMs: values.graceMs,
      signal,
      env: {
        // Bash-tool environment policy merged first so a trusted caller's own
        // entries still win, exactly as the host executor documents.
        ...ENV_OVERRIDES,
        ...spec.env,
        ...spec.dshEnv,
      },
    }
  }

  /**
   * Merge the configured init script into the managed `DSH_*` environment as
   * `BASH_ENV` (expanding `~`), so a non-interactive `bash -c` sources it.
   * @param {object} spec - resolved execution spec.
   * @returns {object} the spec unchanged, or a copy carrying `dshEnv.BASH_ENV`.
   */
  withInitScript(spec) {
    const { initScript } = this.configValues()
    const expanded = expandHomePath(initScript, osHomedir())
    if (expanded.length === 0) return spec
    return { ...spec, dshEnv: { ...(spec.dshEnv ?? {}), BASH_ENV: expanded } }
  }

  /**
   * Resolve the Git Bash executable for this executor, throwing the explicit
   * fail-closed error when detection finds none. The detection result is
   * memoized inside `detect.js`, so repeated commands are cheap; no
   * alternative shell is ever returned.
   * @returns {Promise<string>} absolute path to the Git for Windows `bash.exe`.
   * @throws {Error} code {@link GITBASH_UNAVAILABLE} when no Git Bash is usable.
   */
  async requireBashPath() {
    const { bashPath } = this.configValues()
    const detection = await resolveGitBash({ configured: bashPath, platform: process.platform, env: process.env })
    if (detection.ok && typeof detection.path === 'string' && detection.path.length > 0) {
      if (detection.warning !== null && detection.warning !== undefined && !this.warnedDetection) {
        this.warnedDetection = true
        try {
          this.ctx.logger?.warn?.(`gitbash-win: ${detection.warning}`)
        } catch {
          /* logging must never break command execution */
        }
      }
      return detection.path
    }
    const error = new Error(`${GITBASH_UNAVAILABLE_MESSAGE}\n検出結果: ${detection.report}`)
    error.code = GITBASH_UNAVAILABLE
    error.detection = detection
    throw error
  }

  /**
   * The routing decision for one execution, using this executor's configured
   * fallback. See the exported {@link gitBashRoute} for the pure matrix.
   * @param {object} spec - resolved execution spec.
   * @returns {{ route: 'direct'|'confined'|'unconfined', mode: string }} the selected route.
   */
  routeFor(spec) {
    return gitBashRoute(spec, this.configValues().sandboxFallback)
  }

  /**
   * Wrap one shell command through `ctx.sandbox.confine` with the Git Bash
   * executable. The parent `SandboxBashExecutor.confine` hard-codes bare
   * `bash`; overriding it is what makes the official sandbox path run Git for
   * Windows (`DESIGN.md` §3.2).
   * @param {string} command - shell source for the confined inner `bash -c`.
   * @param {object} policy - the resolved confined execution policy.
   * @param {AbortSignal|undefined} signal - cancellation of confinement preparation.
   * @returns {Promise<object>} the provider's wrapped argv and classification facts.
   */
  async confine(command, policy, signal) {
    return this.ctx.sandbox.confine([await this.requireBashPath(), '-c', command], policy, signal)
  }

  /**
   * Execute one resolved spec. Overrides the official sandbox executor to
   * swap the executable boundary and to implement the documented fallback
   * matrix; the confined branch still runs through the official
   * `SandboxBashExecutor.execute()` so sandbox facts and fail-closed behavior
   * stay identical to the host implementation.
   * @param {object} spec - resolved execution spec (produced by {@link resolve}).
   * @returns {Promise<object>} the live execution handle.
   */
  async execute(spec) {
    if (spec === null || typeof spec !== 'object' || typeof spec.command !== 'string') {
      throw new TypeError('gitbash-win: execute() requires a resolved spec with a string command (call resolve() first)')
    }
    const values = this.configValues()
    const route = gitBashRoute(spec, values.sandboxFallback)
    const bashPath = await this.requireBashPath()

    if (route.route === 'direct') {
      const execution = await this.executeArgv(this.withInitScript(spec), [bashPath, '-c', spec.command])
      return GitBashExecutor.decorateExecution(execution, { mode: route.mode, denied: false })
    }

    if (route.route === 'unconfined') {
      if (!this.warnedUnconfined) {
        this.warnedUnconfined = true
        try {
          this.ctx.logger?.warn?.(
            'gitbash-win: sandboxFallback is "unconfined": commands run WITHOUT DSH sandbox confinement because the operator configured it explicitly. Prefer the official pwsh tool for confined work.',
          )
        } catch {
          /* logging must never break command execution */
        }
      }
      const execution = await this.executeArgv(this.withInitScript(spec), [bashPath, '-c', spec.command])
      return GitBashExecutor.decorateExecution(execution, { mode: route.mode, denied: false, enforcement: 'unconfined' })
    }

    // Fail-closed confinement: the official sandbox executor calls our
    // confine() and lets SANDBOX_UNAVAILABLE propagate rather than running the
    // command unconfined. On Windows the ACL runner can start while Git Bash
    // itself dies during CRT initialization (measured 0xC0000142); that means
    // the command did not run, so report it as the same fail-closed error the
    // tool layer already knows how to render.
    try {
      const execution = await super.execute(this.withInitScript(spec))
      return GitBashExecutor.guardRestrictedTokenShellCrash(execution, route.mode)
    } catch (error) {
      throw augmentSandboxUnavailableError(error)
    }
  }

  /**
   * Map a confined run that died from the known MSYS/restricted-token startup
   * crash onto `SANDBOX_UNAVAILABLE`. The command never ran, so this is the
   * documented fail-closed outcome rather than an opaque exit code the model
   * might retry; no unconfined execution is attempted.
   * @param {object} execution - the live execution handle returned by the parent.
   * @param {string} mode - the requested sandbox mode.
   * @returns {object} the same handle, with its result projection guarded.
   */
  static guardRestrictedTokenShellCrash(execution, mode) {
    if (execution === null || typeof execution !== 'object' || typeof execution.result !== 'function') return execution
    const base = execution.result.bind(execution)
    let guarded
    execution.result = () => {
      guarded ??= base().then((result) => {
        if (isRestrictedTokenShellCrash(result.exitCode)) {
          const hex = (result.exitCode >>> 0).toString(16).toUpperCase()
          throw new SandboxUnavailableError(
            mode,
            `Git for Windows bash could not initialize under the Windows ACL restricted-token sandbox (exit 0x${hex}); the command did not run. ` +
              'Use the official pwsh tool for this operation, switch the session to danger-full-access, or set sandboxFallback: unconfined explicitly (shell confinement off; file tools keep their own policy).',
          )
        }
        return result
      })
      return guarded
    }
    return execution
  }

  /**
   * Attach sandbox facts to an execution handle without wrapping the handle
   * (the parent keys per-process facts on the exact instance). The foreground
   * `result()` projection and the handle both report them.
   * @param {object} execution - the live execution handle.
   * @param {{ mode: string, denied: boolean, enforcement?: string }} sandbox - the facts to attach.
   * @returns {object} the same handle, decorated in place.
   */
  static decorateExecution(execution, sandbox) {
    if (execution === null || typeof execution !== 'object' || typeof execution.result !== 'function') return execution
    const base = execution.result.bind(execution)
    let decorated
    execution.result = () => {
      decorated ??= base().then((result) => ({ ...result, sandbox: { ...sandbox } }))
      return decorated
    }
    if (execution.sandbox === undefined) {
      try {
        execution.sandbox = { ...sandbox }
      } catch {
        /* a frozen handle still exposes the facts through result() */
      }
    }
    return execution
  }
}

export default GitBashExecutor
