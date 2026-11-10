/**
 * Host-half integration tests for dsh-gitbash-win.
 *
 * These tests mount the REAL composition the plugin targets, on this Linux box:
 * a fresh Cordis root context with the host-resolved (never vendored) official
 * services — `dsh-system-prompt`, `dsh-tools`, `dsh-shell-env`,
 * `dsh-working-directory`, `dsh-subprocess-local`, and
 * `dsh-tool-executor-native` — then mount `lib/index.js` exactly like a loader
 * row. The plugin then isolates its own `shell` service, mounts the private
 * `GitBashExecutor` there, and mounts the official `@deepseek-ai/dsh-tool-bash`
 * object plugin into the same isolate.
 *
 * What that proves (DESIGN §9.2):
 * - the official bash tool appears in the real tool registry while the ROOT
 *   `ctx.shell` is never registered or replaced;
 * - the private executor is the one the official tool actually drives: a bash
 *   call goes through the real tool pipeline and spawns a command;
 * - the routing prompt section is assembled by the real SystemPrompt service
 *   in the slot right after the official pwsh guidance;
 * - `GET /dsh-gitbash-win/status` answers the DESIGN §6.1 payload, is fenced by
 *   `connection.requestRejection`, allows only GET, and maps failures to JSON;
 * - disposing the row fiber unregisters the tool, the prompt section, and the
 *   route, leaving the official composition untouched.
 *
 * Services whose real implementations are entangled with a live deployment are
 * provided as narrow fakes (explicitly allowed by DESIGN §9.2): `sandbox` (a
 * provider would run a Windows/Linux runner), `sandboxPolicy`, `fs`,
 * `sessionProjections`, `webServer`, and `connection`. The fake sandbox policy
 * reports `danger-full-access`, so the private executor routes to its direct
 * (unconfined) branch — the branch that needs no platform runner and is
 * therefore exercisable here.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import * as plugin from '../lib/index.js'
import { hostImport } from '../lib/host-modules.js'

const { Context } = await hostImport('@deepseek-ai/cordis')
const systemPromptModule = await hostImport('@deepseek-ai/dsh-system-prompt')
const toolsModule = await hostImport('@deepseek-ai/dsh-tools')
const shellEnvModule = await hostImport('@deepseek-ai/dsh-shell-env')
const workingDirectoryModule = await hostImport('@deepseek-ai/dsh-working-directory')
const subprocessModule = await hostImport('@deepseek-ai/dsh-subprocess-local')
const nativeExecutorModule = await hostImport('@deepseek-ai/dsh-tool-executor-native')

/** Status route path (DESIGN §6.1). */
const STATUS_PATH = '/dsh-gitbash-win/status'
/** Prompt section the plugin must contribute. */
const ROUTING_SECTION = 'gitbash-win:routing'
/** The row config values DESIGN §8 ships; tests override only bashPath/initScript. */
const ROW_CONFIG = Object.freeze({
  bashPath: '',
  initScript: '',
  sandboxFallback: 'fail',
  timeoutMs: 120000,
  maxOutputBytes: 64000,
})

/**
 * Poll until `predicate` holds, so tests observe asynchronous Cordis fibers
 * without arbitrary sleeps.
 * @param {() => boolean} predicate - condition to reach.
 * @param {string} label - human-readable wait description.
 * @param {number} [timeoutMs] - upper bound.
 * @returns {Promise<void>} resolves once the condition holds.
 */
async function waitFor(predicate, label, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${label}${lastError === undefined ? '' : `: ${lastError.message}`}`)
}

/** Minimal ServerResponse stand-in recording everything the route emits. */
class FakeResponse {
  statusCode = 0
  headers = Object.create(null)
  body = ''

  setHeader(name, value) {
    this.headers[String(name).toLowerCase()] = value
  }

  end(chunk) {
    this.body = chunk === undefined ? '' : String(chunk)
  }
}

/** Build one fake request; the route only inspects method + headers. */
function fakeRequest(method = 'GET') {
  return { method, url: STATUS_PATH, headers: { host: '127.0.0.1:3080' } }
}

/**
 * Mount the real host composition and the plugin row.
 * @param {object} [options] - mount options.
 * @param {object} [options.config] - row config override (defaults to DESIGN §8).
 * @param {(req: object) => number|undefined} [options.requestRejection] - trust fence behavior.
 * @returns {Promise<object>} the mounted host handle.
 */
async function mountHost({ config = ROW_CONFIG, requestRejection } = {}) {
  const root = new Context()
  const routes = []
  const warnings = []
  const connection = { requestRejection: requestRejection ?? (() => undefined) }
  const sandboxPolicy = {
    defaultMode: 'danger-full-access',
    resolve: () => ({ mode: 'danger-full-access' }),
  }
  const dshHome = mkdtempSync(join(tmpdir(), 'dsh-gitbash-win-home-'))

  // Official services, host-resolved from the installed DSH (DESIGN §5, §9.2).
  root.plugin(systemPromptModule.default)
  root.plugin(toolsModule.default)
  root.plugin(shellEnvModule, { dshHome })
  root.plugin(subprocessModule.default)
  root.plugin(nativeExecutorModule)

  // Deployment-entangled services: narrow fakes that keep the composition real
  // everywhere the plugin can observe it (DESIGN §9.2 allows this).
  root.provide('fs', {})
  root.provide('sessionProjections', { register: async () => ({ dispose() {} }) })
  root.plugin(workingDirectoryModule.default, { defaultDirectory: process.cwd() })
  root.provide('sandbox', {
    confine: async () => {
      throw new Error('the sandbox provider is not exercised by the host mount test')
    },
  })
  root.provide('sandboxPolicy', sandboxPolicy)
  root.provide('webServer', {
    register(route) {
      routes.push(route)
      return () => {
        const index = routes.indexOf(route)
        if (index >= 0) routes.splice(index, 1)
      }
    },
  })
  root.provide('connection', connection)
  root.logger.exporter({ export: (message) => warnings.push(message) })

  await waitFor(
    () => ['systemPrompt', 'tools', 'shellEnv', 'workingDirectory', 'subprocess'].every((name) => root.get(name) !== undefined),
    'host services',
  )

  // Mount the plugin exactly like the loader row does: module namespace + config.
  const fiber = root.plugin(plugin, config)
  await fiber
  await waitFor(() => root.get('tools').schemas().some((schema) => schema.name === 'bash'), 'the official bash tool registration')

  let disposed = false
  /** Tear the row down and remove its scratch home; idempotent. */
  const dispose = async () => {
    if (disposed) return
    disposed = true
    await fiber.dispose()
    await new Promise((resolve) => setTimeout(resolve, 0))
    rmSync(dshHome, { recursive: true, force: true })
  }

  return { root, routes, connection, sandboxPolicy, warnings, fiber, dispose }
}

/** Run a body against a mounted host and always tear it down. */
async function withHost(options, run) {
  const host = await mountHost(options)
  try {
    return await run(host)
  } finally {
    await host.dispose()
  }
}

/** Return the plugin's status route, asserting it is registered exactly once. */
function statusRoute(routes) {
  const matches = routes.filter((route) => route.path === STATUS_PATH)
  assert.equal(matches.length, 1, 'the plugin registers exactly one status route')
  assert.equal(matches[0].kind, 'exact', 'status route is an exact-path route')
  assert.equal(typeof matches[0].handler, 'function', 'status route carries a handler')
  return matches[0]
}

/** Drive the status handler with a fake request and return the fake response. */
async function callStatus(route, { method = 'GET' } = {}) {
  const response = new FakeResponse()
  await route.handler(fakeRequest(method), response)
  return response
}

/** Parse a JSON response body, asserting the JSON content type. */
function jsonBody(response) {
  assert.match(String(response.headers['content-type'] ?? ''), /^application\/json/, 'status responses are JSON')
  return JSON.parse(response.body)
}

/** Invoke one `bash` tool call through the real tool pipeline. */
async function runBash(root, command) {
  const batch = await root.get('tools').execute({
    signal: new AbortController().signal,
    calls: [
      {
        type: 'tool-call',
        id: 'call-1',
        name: 'bash',
        arguments: JSON.stringify({ command, description: 'host mount probe' }),
      },
    ],
  })
  assert.ok(Array.isArray(batch?.results), 'the tool pipeline returns a result batch')
  assert.equal(batch.results.length, 1, 'the batch contains the one bash call')
  return batch.results[0].result
}

test('the module is the additive row plugin the loader mounts', () => {
  assert.equal(plugin.name, 'gitbash-win', 'row id / configForms key')
  assert.equal(typeof plugin.apply, 'function', 'object plugin with apply()')
  assert.ok(Array.isArray(plugin.inject) && plugin.inject.length === 0, 'apply mounts immediately; children wait on their own injects')
  assert.equal(plugin.Config?.['~standard']?.vendor, 'schemastery', 'row config schema is the shared schemastery schema')
  for (const field of ['cwd', 'timeoutMs', 'maxTimeoutMs', 'maxOutputBytes', 'maxSpillBytes', 'graceMs', 'bashPath', 'initScript', 'sandboxFallback']) {
    assert.ok(field in plugin.Config.dict, `row schema field "${field}" (DESIGN §3.1)`)
  }
})

test('mounts the official bash tool on a private isolated shell and leaves root ctx.shell untouched', async () => {
  await withHost({ config: { ...ROW_CONFIG, bashPath: '/bin/bash' } }, async ({ root }) => {
    assert.equal(root.get('shell'), undefined, 'the root shell service must never be registered by this plugin')

    const schemas = root.get('tools').schemas()
    const bash = schemas.find((schema) => schema.name === 'bash')
    assert.ok(bash !== undefined, 'the official tool-bash plugin registers the model-facing "bash" tool')
    assert.match(bash.description, /^Execute a bash command/, 'the tool keeps the official bash description (no fork)')
    assert.ok(bash.parameters?.properties?.command !== undefined, 'official command argument')
    assert.ok(bash.parameters?.properties?.description !== undefined, 'official description argument')
  })
})

test('adds the bash/pwsh routing section right after the official pwsh slot', async () => {
  await withHost({ config: { ...ROW_CONFIG, bashPath: '/bin/bash' } }, async ({ root }) => {
    const systemPrompt = root.get('systemPrompt')
    const section = systemPrompt.layers.global.sections.get(ROUTING_SECTION)
    assert.ok(section !== undefined, 'routing section is registered in the global prompt layer')
    assert.equal(section.order, systemPrompt.getSectionOrder('TOOL_PWSH') + 1, 'placed immediately after TOOL_PWSH')
    assert.ok(section.order > systemPrompt.getSectionOrder('TOOL_BASH'), 'bash routing follows the generic bash tool slot')

    assert.match(section.text, /Git for Windows/, 'names the shell implementation')
    assert.match(section.text, /`bash`/, 'names the available bash tool')
    assert.match(section.text, /`pwsh`/, 'names the official PowerShell tool')
    assert.match(section.text, /Prefer `bash` for POSIX shell work/, 'prefers bash for POSIX work')
    assert.match(section.text, /only when the task genuinely needs native PowerShell/, 'keeps pwsh for native PowerShell')
    assert.match(section.text, /Never work around a sandbox or policy denial/, 'forbids shell-switching around a policy denial')
    assert.match(section.text, /pwsh -Command/, 'names the concrete workaround to avoid')

    const assembly = await systemPrompt.assemble({})
    const names = assembly.sections.map((entry) => entry.name)
    assert.ok(names.includes(ROUTING_SECTION), 'the assembled system prompt includes the routing section')
    assert.ok(names.indexOf(ROUTING_SECTION) > names.indexOf('tool:bash'), 'routing comes after the bash tool section')
    assert.ok(names.indexOf(ROUTING_SECTION) < names.indexOf('deployment:persona-suffix'), 'routing comes before the persona suffix')
    assert.ok(assembly.tools.some((tool) => tool.name === 'bash'), 'the assembled tool list exposes "bash"')
  })
})

test('the official bash tool really executes through the private Git Bash executor', async () => {
  await withHost({ config: { ...ROW_CONFIG, bashPath: '/bin/bash' } }, async ({ root }) => {
    // The row config alone (bashPath) reaches the private executor, and the
    // tool's normal pipeline spawns the command through it.
    const marker = `host-mount-${process.pid}`
    const result = await runBash(root, `printf '%s' '${marker}'`)
    assert.equal(result.isError, false, 'the bash tool call succeeds')
    assert.equal(result.content?.[0]?.text, marker, 'stdout is returned through the official rendering')
    assert.equal(result.value?.exitCode, 0, 'exit code 0')
    assert.equal(result.value?.kind, 'foreground')
    assert.equal(result.value?.sandbox?.mode, 'danger-full-access', 'sandbox facts come from the deployment policy')
    assert.equal(root.get('shell'), undefined, 'execution went through the isolate, not a root shell service')
  })
})

test('forwards initScript as BASH_ENV to the isolated executor', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'dsh-gitbash-win-init-'))
  const initScript = join(scratch, 'init.sh')
  writeFileSync(initScript, 'export DSH_GITBASH_HOST_PROBE=from-init-script\n')
  try {
    await withHost({ config: { ...ROW_CONFIG, bashPath: '/bin/bash', initScript } }, async ({ root }) => {
      const result = await runBash(root, 'printf "%s" "$DSH_GITBASH_HOST_PROBE"')
      assert.equal(result.isError, false)
      assert.equal(result.content?.[0]?.text, 'from-init-script', 'initScript reached bash through BASH_ENV')
    })
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})

test('serves the DESIGN §6.1 status payload as no-store JSON', async () => {
  await withHost({ config: ROW_CONFIG }, async ({ routes }) => {
    const response = await callStatus(statusRoute(routes))
    assert.equal(response.statusCode, 200)
    assert.equal(response.headers['cache-control'], 'no-store', 'detection facts are live, never cached')

    const payload = jsonBody(response)
    assert.deepEqual(payload, {
      plugin: 'dsh-gitbash-win',
      platform: process.platform,
      supported: process.platform === 'win32',
      bashPath: { configured: '', resolved: null, ok: false, source: null, candidates: [] },
      sandbox: { available: true, defaultMode: 'danger-full-access', fallback: 'fail' },
      tool: { name: 'bash', global: true },
    })
  })
})

test('reports a configured POSIX bash path and an explicit unconfined fallback', async () => {
  await withHost({ config: { ...ROW_CONFIG, bashPath: '/bin/bash', sandboxFallback: 'unconfined' } }, async ({ routes }) => {
    const payload = jsonBody(await callStatus(statusRoute(routes)))
    assert.equal(payload.bashPath.configured, '/bin/bash')
    assert.equal(payload.bashPath.resolved, '/bin/bash')
    assert.equal(payload.bashPath.ok, true, 'an explicitly configured path is used on a POSIX host')
    assert.equal(payload.bashPath.source, 'configured')
    assert.ok(Array.isArray(payload.bashPath.candidates) && payload.bashPath.candidates.length > 0)
    assert.deepEqual(payload.bashPath.candidates[0], {
      path: '/bin/bash',
      ok: true,
      reason: payload.bashPath.candidates[0].reason,
    })
    assert.equal(typeof payload.bashPath.candidates[0].reason, 'string', 'the POSIX acceptance explains itself')
    assert.equal(payload.sandbox.fallback, 'unconfined', 'the status reflects the explicit fallback')
    assert.equal(payload.sandbox.defaultMode, 'danger-full-access')
  })
})

test('status route is fenced: connection first, GET only, failures mapped to JSON', async () => {
  await withHost({ config: ROW_CONFIG }, async ({ routes, connection, sandboxPolicy }) => {
    const route = statusRoute(routes)

    // Method allow-list: the trust fence sees the request first, then 405.
    for (const method of ['POST', 'PUT', 'DELETE', 'HEAD']) {
      const response = await callStatus(route, { method })
      assert.equal(response.statusCode, 405, `${method} is rejected`)
      assert.equal(response.headers.allow, 'GET', '405 names the one supported method')
      assert.equal(response.body, '', '405 carries no payload')
    }

    // The connection trust fence wins over everything and leaks nothing.
    connection.requestRejection = () => 403
    const rejected = await callStatus(route)
    assert.equal(rejected.statusCode, 403, 'connection.requestRejection status is used verbatim')
    assert.equal(rejected.body, '', 'an untrusted caller gets no detection data')
    assert.equal(rejected.headers['content-type'], undefined, 'no JSON content type on rejection')

    // A broken fence fails closed with a JSON error, never with detection data.
    connection.requestRejection = () => {
      throw new Error('connection service unavailable')
    }
    const fenceBroken = await callStatus(route)
    assert.equal(fenceBroken.statusCode, 500)
    assert.equal(jsonBody(fenceBroken).error, 'authorization fence unavailable')

    // Ordinary handler errors become 500 JSON {error}.
    connection.requestRejection = () => undefined
    Object.defineProperty(sandboxPolicy, 'defaultMode', {
      configurable: true,
      get() {
        throw new Error('sandbox policy exploded')
      },
    })
    const failed = await callStatus(route)
    assert.equal(failed.statusCode, 500)
    assert.equal(failed.headers['cache-control'], 'no-store')
    assert.equal(jsonBody(failed).error, 'sandbox policy exploded')
  })
})

test('disposing the row fiber unregisters tool, prompt section, and route', async () => {
  const host = await mountHost({ config: { ...ROW_CONFIG, bashPath: '/bin/bash' } })
  const { root, routes } = host
  try {
    const systemPrompt = root.get('systemPrompt')
    assert.ok(root.get('tools').schemas().some((schema) => schema.name === 'bash'))
    assert.ok(systemPrompt.layers.global.sections.get(ROUTING_SECTION) !== undefined)
    assert.equal(routes.filter((route) => route.path === STATUS_PATH).length, 1)

    await host.dispose()
    await waitFor(() => !root.get('tools').schemas().some((schema) => schema.name === 'bash'), 'bash tool unregistration')

    assert.equal(root.get('tools').schemas().some((schema) => schema.name === 'bash'), false, 'tool unregistered')
    assert.equal(systemPrompt.layers.global.sections.get(ROUTING_SECTION), undefined, 'routing section unregistered')
    assert.equal(routes.length, 0, 'status route unregistered')
    const assembly = await systemPrompt.assemble({})
    assert.equal(assembly.sections.some((entry) => entry.name === ROUTING_SECTION), false, 'no routing text in the assembled prompt')
    assert.equal(assembly.tools.some((tool) => tool.name === 'bash'), false, 'no bash tool in the assembled tool list')
    assert.equal(root.get('shell'), undefined, 'the root shell was never touched, before or after unload')
  } finally {
    await host.dispose()
  }
})

test('a forced non-Windows mount warns once and still mounts the tool', { skip: process.platform === 'win32' }, async () => {
  await withHost({ config: { ...ROW_CONFIG, bashPath: '/bin/bash' } }, async ({ root, warnings }) => {
    const platformWarnings = warnings.filter(
      (message) => message.type === 'warn' && String(message.args[0] ?? '').includes('this plugin targets Windows'),
    )
    assert.equal(platformWarnings.length, 1, 'exactly one platform warning per mount')
    assert.ok(root.get('tools').schemas().some((schema) => schema.name === 'bash'), 'the forced row still works')
  })
})
