/**
 * dsh-gitbash-win — host half.
 *
 * The whole plugin is one *additive* loader row: it mounts a private Git for
 * Windows executor and the official `@deepseek-ai/dsh-tool-bash` object plugin
 * inside the SAME isolated `shell` service scope (`ctx.isolate('shell')`).
 *
 * Why the isolate matters: the official bash tool is a pure consumer of the
 * `ctx.shell` capability seam, so inside the isolated scope it drives the
 * private `GitBashExecutor` without a single line of the tool being forked,
 * copied, or reconfigured. The root `ctx.shell` (PowerShell on Windows) is never
 * touched, which keeps the official `pwsh` tool, the agent presets, and every
 * other base row exactly as shipped — uninstalling this package restores the
 * stock composition.
 *
 * Besides the mount, `apply` adds two independent contributions, each behind
 * `ctx.inject` and owned by a Cordis effect so unloading the row removes it:
 * - a routing prompt section telling the model when to pick `bash` over `pwsh`;
 * - `GET /dsh-gitbash-win/status`, the detection report the Web settings card
 *   reads (behind the composition's `connection` trust fence).
 *
 * @module dsh-gitbash-win
 */
import { GitBashExecutor, Config } from './executor.js'
import { hostImport } from './host-modules.js'
import { resolveGitBash } from './detect.js'

/**
 * The official bash tool plugin (object plugin: `{ name, inject, Config, apply }`),
 * host-resolved at module load because this out-of-tree package cannot bare-import
 * `@deepseek-ai/dsh-*`. Discovering it eagerly keeps `apply` synchronous and makes
 * a broken host installation a load-time error instead of a half-mounted row.
 */
const officialToolBash = await hostImport('@deepseek-ai/dsh-tool-bash')

/** Cordis plugin name; also the loader row id and the settings-card key. */
export const name = 'gitbash-win'

/**
 * Nothing to wait for before mounting: `apply` registers the isolated child
 * plugins synchronously, and the prompt/route contributions wait on their own
 * `ctx.inject` fibers.
 */
export const inject = []

/** The row config schema — the same schema the private executor validates. */
export { Config }

/** Path of the detection-status route (GET; JSON, never cached). */
const STATUS_PATH = '/dsh-gitbash-win/status'

/** Name of the prompt section that carries the bash-vs-pwsh routing guidance. */
const ROUTING_SECTION = 'gitbash-win:routing'

/** Id of the mounted tool, as registered by the official tool-bash plugin. */
const TOOL_NAME = 'bash'

/**
 * Routing guidance appended right after the official `TOOL_PWSH` prompt slot.
 * It states the two-shell split, prefers bash for POSIX work, and — because
 * sandbox denials are a policy outcome, not a shell limitation — forbids
 * retrying the same operation through another shell.
 */
const ROUTING_TEXT = `A Git for Windows bash tool named \`bash\` is available in addition to the official \`pwsh\` tool.
- Prefer \`bash\` for POSIX shell work: pipelines, POSIX utilities, shell scripts, \`git\` commands, and commands written for Unix shells.
- Use \`pwsh\` only when the task genuinely needs native PowerShell: cmdlets, .NET APIs, the registry, or commands written in PowerShell syntax.
- Never work around a sandbox or policy denial by switching shells or by embedding another shell (for example \`pwsh -Command\` or \`cmd /c\`) inside a command. Report the denial instead.`

/**
 * Config field names passed from the row to the private executor. Sourced from
 * the schema when possible so a schema addition is forwarded automatically;
 * the literal list keeps the forwarding stable for schema-less test doubles.
 */
const FALLBACK_CONFIG_FIELDS = Object.freeze([
  'cwd',
  'timeoutMs',
  'maxTimeoutMs',
  'maxOutputBytes',
  'maxSpillBytes',
  'graceMs',
  'bashPath',
  'initScript',
  'sandboxFallback',
])

/** Every field name the row config schema declares (plus the literal fallbacks). */
const CONFIG_FIELDS = Object.freeze([
  ...new Set([...Object.keys(Config?.dict ?? {}), ...FALLBACK_CONFIG_FIELDS]),
])

/**
 * Read one resolved config value as a plain value.
 *
 * Cordis hands plugins the schemastery-resolved config. Ordinary fields are
 * already plain; `.volatile()` fields are reference holders with `get()`. The
 * executor receives plain values either way (DESIGN §3.1).
 * @param {object|undefined} config - the resolved row config.
 * @param {string} key - the field name.
 * @returns {unknown} the plain value, or `undefined` when absent.
 */
function readConfigValue(config, key) {
  if (config === null || typeof config !== 'object') return undefined
  let value
  try {
    value = config[key]
  } catch {
    return undefined
  }
  if (value === undefined || value === null) return undefined
  if (typeof value === 'object' && typeof value.get === 'function') {
    try {
      return value.get()
    } catch {
      return undefined
    }
  }
  return value
}

/**
 * Project the resolved row config onto plain values for the child executor.
 * @param {object|undefined} config - the resolved row config.
 * @returns {Record<string, unknown>} the plain config values.
 */
function plainConfig(config) {
  const values = {}
  for (const key of CONFIG_FIELDS) {
    const value = readConfigValue(config, key)
    if (value !== undefined) values[key] = value
  }
  return values
}

/**
 * Read one config value as a non-empty string, falling back to `''`.
 * @param {unknown} value - any config value.
 * @returns {string} the string value.
 */
function stringOf(value) {
  return typeof value === 'string' ? value : ''
}

/**
 * Map an error to a wire-safe message. Status responses carry no secrets; the
 * detection report and config echoed here are exactly what the card displays.
 * @param {unknown} error - the thrown value.
 * @returns {string} the message.
 */
function errorMessage(error) {
  if (error instanceof Error && error.message.length > 0) return error.message
  return String(error)
}

/**
 * Install the live config reader on the executor mounted in `scope`.
 *
 * Exported for tests: the installation is the load-bearing link between a
 * volatile settings save and the next command, so it must be executable
 * evidence rather than only a code path (`test/live-config.test.mjs`).
 * @param {import('@deepseek-ai/cordis').Context} scope - the isolated shell scope.
 * @param {object|undefined} config - the row's resolved config (volatile refs).
 * @returns {void}
 */
export function attachLiveConfig(scope, config) {
  scope.inject(['shell'], (shellCtx) => {
    const shell = shellCtx.shell
    if (shell === null || typeof shell !== 'object') return
    shell.liveConfigReader = () => plainConfig(config)
  })
}

/** JSON response (no-store: detection results are live facts). */
function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

/** 405 naming the route's one supported method. */
function sendMethodNotAllowed(res, allow) {
  res.statusCode = 405
  res.setHeader('allow', allow)
  res.setHeader('cache-control', 'no-store')
  res.end()
}

/**
 * Build the status payload (DESIGN §6.1) for the settings card.
 *
 * Detection runs on demand, never at boot: the card's first fetch (or a reload
 * click) is what probes Git for Windows, so composing the row never spawns a
 * process. `resolveGitBash` memoizes per `(platform, configured, PATH, env)`, so
 * repeated fetches are cheap.
 * @param {import('@deepseek-ai/cordis').Context} ctx - the route's context.
 * @param {object|undefined} config - the resolved row config.
 * @returns {Promise<object>} the JSON payload.
 */
async function statusPayload(ctx, config) {
  const configured = stringOf(readConfigValue(config, 'bashPath'))
  // Force a fresh probe on every card read / re-detect click: the detection
  // memo exists to keep command execution cheap, but a settings card that
  // shows a stale answer after the user installs (or moves) Git for Windows is
  // worse than one extra ~100 ms probe. The executor keeps its own memo so
  // repeated commands never probe.
  const detected = await resolveGitBash({ configured, cache: false })
  const sandboxPolicy = ctx.get('sandboxPolicy')
  return {
    plugin: 'dsh-gitbash-win',
    platform: process.platform,
    supported: process.platform === 'win32',
    bashPath: {
      configured,
      resolved: detected?.path ?? null,
      ok: detected?.ok === true,
      source: detected?.source ?? null,
      candidates: (detected?.candidates ?? []).map((candidate) => ({
        path: candidate?.path ?? null,
        ok: candidate?.ok === true,
        reason: candidate?.reason ?? null,
      })),
    },
    sandbox: {
      available: ctx.get('sandbox') !== undefined,
      defaultMode: sandboxPolicy?.defaultMode ?? null,
      fallback: stringOf(readConfigValue(config, 'sandboxFallback')) || 'fail',
    },
    tool: { name: TOOL_NAME, global: true },
  }
}

/**
 * Mount the Git Bash half of the plugin into the calling context.
 *
 * Kept synchronous by design (DESIGN §6): the official tool module is resolved
 * at module load, the private executor and the official tool are mounted
 * synchronously in an isolated `shell` scope, and the prompt/route contributions
 * are deferred to their own `ctx.inject` fibers. Every child registration is
 * owned by this fiber, so disposing the row unregisters all of it.
 * @param {import('@deepseek-ai/cordis').Context} ctx - the row plugin context.
 * @param {object|undefined} config - the resolved row config.
 */
export function apply(ctx, config) {
  const values = plainConfig(config)

  // One isolated `shell` label shared by the private executor provider and the
  // official tool consumer: inside this subtree `ctx.shell` is the Git Bash
  // executor; outside it, the root executor (official PowerShell) is untouched.
  const scope = ctx.isolate('shell')
  scope.plugin(GitBashExecutor, values)

  // The row schema is volatile: the Host settings document (and therefore the
  // settings card) edits these refs in place rather than reloading the row, so
  // hand the mounted executor a live view. Without this the executor would keep
  // the mount-time snapshot until the next restart.
  attachLiveConfig(scope, config)

  scope.plugin(officialToolBash, { enableRunInBackground: true, promoteOnTimeout: true })

  // bash-vs-pwsh routing, placed just after the official pwsh tool guidance.
  ctx.inject(['systemPrompt'], (c) =>
    c.effect(
      () =>
        c.systemPrompt.section({
          name: ROUTING_SECTION,
          order: c.systemPrompt.getSectionOrder('TOOL_PWSH') + 1,
          text: ROUTING_TEXT,
        }),
      'gitbash-win: routing section',
    ),
  )

  // Detection status route for the settings card, behind the composition's
  // connection trust fence (same fence the official host routes use).
  ctx.inject(['webServer', 'connection'], (c) => {
    /** Answer an untrusted/unauthenticated request; true when it was rejected. */
    const rejected = (req, res) => {
      let rejection
      try {
        rejection = c.connection.requestRejection(req)
      } catch {
        // Fail closed: never serve detection data when the fence itself fails.
        sendJson(res, 500, { error: 'authorization fence unavailable' })
        return true
      }
      if (rejection === undefined) return false
      // Fail closed on an out-of-contract fence answer (the connection service
      // documents number|undefined): never echo an invalid status code onto the
      // wire, and never fall through to serving detection data.
      if (!Number.isInteger(rejection) || rejection < 100 || rejection > 599) {
        sendJson(res, 500, { error: 'authorization fence returned an invalid status' })
        return true
      }
      res.statusCode = rejection
      res.end()
      return true
    }

    c.effect(
      () =>
        c.webServer.register({
          kind: 'exact',
          path: STATUS_PATH,
          handler: async (req, res) => {
            if (rejected(req, res)) return
            if (req.method !== 'GET') {
              sendMethodNotAllowed(res, 'GET')
              return
            }
            try {
              sendJson(res, 200, await statusPayload(c, config))
            } catch (error) {
              sendJson(res, 500, { error: errorMessage(error) })
            }
          },
        }),
      `gitbash-win: GET ${STATUS_PATH}`,
    )
  })

  // The row is disabled outside Windows by cordis.patch.yml; a forced mount
  // (tests, a hand-written patch) still works with an explicit bashPath, so
  // warn once instead of failing.
  if (process.platform !== 'win32') {
    try {
      ctx.logger?.warn?.(
        `dsh-gitbash-win: this plugin targets Windows; running on ${process.platform}. ` +
          'Configure bashPath explicitly (the row is disabled by cordis.patch.yml on non-Windows hosts).',
      )
    } catch {
      /* logging must never break the mount */
    }
  }
}
