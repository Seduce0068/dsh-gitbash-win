/**
 * Tests for `lib/executor.js` — the private Git for Windows bash executor.
 *
 * The centrepiece is a REAL cordis mount on this host: a fresh root
 * `Context`, the host `dsh-subprocess-local` provider, stub `sandbox` /
 * `sandboxPolicy` services, an isolated `shell` scope, and the real
 * `GitBashExecutor` mounted with `bashPath: '/bin/bash'`. Commands genuinely
 * spawn `/bin/bash` through the host subprocess machinery and are asserted on
 * their stdout/exit code/sandbox facts.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { hostImport } from '../lib/host-modules.js'
import { makeConfig } from '../lib/schema.js'
import {
  Config,
  GITBASH_UNAVAILABLE,
  GITBASH_UNAVAILABLE_MESSAGE,
  GitBashExecutor,
  gitBashRoute,
} from '../lib/executor.js'

const { Context } = await hostImport('@deepseek-ai/cordis')
const subprocessLocal = (await hostImport('@deepseek-ai/dsh-subprocess-local')).default
const { SandboxBashExecutor } = await hostImport('@deepseek-ai/dsh-bash-sandbox')
const { SandboxUnavailableError } = await hostImport('@deepseek-ai/dsh-sandbox')
const z = (await hostImport('@deepseek-ai/schemastery')).default

const IS_WINDOWS = process.platform === 'win32'
const BASH = IS_WINDOWS ? 'C:\\Program Files\\Git\\bin\\bash.exe' : '/bin/bash'

// Every isolated cordis root mounts the host subprocess provider, which
// attaches one host-exit listener per root. That is expected for this test
// harness (it is not a leak in the plugin), so lift the default warning bound.
process.setMaxListeners(64)

/** Identity of the real sandbox result facts a stub provider returns. */
const PARTIAL_ENFORCEMENT = Object.freeze({
  enforcement: 'partial',
  denialSignatures: ['access is denied'],
  runnerFailureRules: [],
})

/**
 * Build a real cordis harness: root context + host subprocess provider +
 * stubbed sandbox/sandboxPolicy services, with the executor mounted inside an
 * isolated `shell` scope.
 * @param {object} [options]
 * @param {{ mode?: string, [key: string]: unknown }} [options.policy] - standing sandbox policy.
 * @param {object} [options.executorConfig] - extra GitBashExecutor config.
 * @param {(argv: string[], policy: object, signal: AbortSignal|undefined) => Promise<object>} [options.confine] - sandbox stub behavior.
 * @returns {Promise<object>} the harness.
 */
async function makeHarness({ policy = {}, executorConfig = {}, confine } = {}) {
  const mode = policy.mode ?? 'danger-full-access'
  const standingPolicy = { mode, workspaceRoot: process.cwd(), ...policy }
  const sandboxCalls = []
  const sandbox = {
    confine: async (argv, callPolicy, signal) => {
      sandboxCalls.push({ argv: [...argv], policy: callPolicy })
      if (confine !== undefined) return confine(argv, callPolicy, signal)
      return { argv: [...argv], ...PARTIAL_ENFORCEMENT }
    },
  }
  const sandboxPolicy = {
    defaultMode: mode,
    resolve: () => ({ ...standingPolicy }),
  }
  const root = new Context()
  await root.plugin(subprocessLocal)
  await root.plugin(function stubServices(ctx) {
    ctx.provide('sandbox', sandbox)
    ctx.provide('sandboxPolicy', sandboxPolicy)
  })
  const scope = root.isolate('shell')
  await scope.plugin(GitBashExecutor, { bashPath: BASH, timeoutMs: 20_000, ...executorConfig })
  const shell = scope.get('shell')
  assert.ok(shell !== undefined, 'GitBashExecutor must register ctx.shell in the isolated scope')
  return { root, scope, shell, sandbox, sandboxPolicy, sandboxCalls, standingPolicy }
}

/** Collect cordis logger messages for warning assertions. */
function captureLogs(root) {
  const messages = []
  root.logger.exporter({ export: (message) => messages.push(message) })
  return messages
}

test('GitBashExecutor extends the host SandboxBashExecutor and inherits its injections', () => {
  assert.equal(Object.getPrototypeOf(GitBashExecutor), SandboxBashExecutor)
  assert.deepEqual(GitBashExecutor.inject, ['subprocess', 'sandbox', 'sandboxPolicy'])
  assert.equal(GitBashExecutor.Config, Config)
})

test('Config exposes the documented volatile fields and defaults', () => {
  const schema = makeConfig(z)
  const values = schema({})
  const read = (key) => (values[key] !== null && typeof values[key] === 'object' && typeof values[key].get === 'function' ? values[key].get() : values[key])
  assert.deepEqual(
    {
      cwd: read('cwd'),
      timeoutMs: read('timeoutMs'),
      maxTimeoutMs: read('maxTimeoutMs'),
      maxOutputBytes: read('maxOutputBytes'),
      maxSpillBytes: read('maxSpillBytes'),
      graceMs: read('graceMs'),
      bashPath: read('bashPath'),
      initScript: read('initScript'),
      sandboxFallback: read('sandboxFallback'),
    },
    {
      cwd: '',
      timeoutMs: 120_000,
      maxTimeoutMs: 600_000,
      maxOutputBytes: 64_000,
      maxSpillBytes: 67_108_864,
      graceMs: 3_000,
      bashPath: '',
      initScript: '',
      sandboxFallback: 'fail',
    },
  )
  assert.deepEqual(
    Object.keys(schema.dict).sort(),
    ['bashPath', 'cwd', 'graceMs', 'initScript', 'maxOutputBytes', 'maxSpillBytes', 'maxTimeoutMs', 'sandboxFallback', 'timeoutMs'].sort(),
  )
  // Volatile fields are what make the Host settings document serve a form for
  // this row (and therefore render the Web settings card); the live reader in
  // lib/index.js then gives the mounted executor the edited values.
  // sandboxFallback is the deliberate exception: it changes the official tool's
  // advertised sandbox mode, so a change must reload the row instead of
  // mutating a live snapshot (see schema.js).
  for (const key of Object.keys(schema.dict)) {
    const expected = key === 'sandboxFallback' ? false : true
    assert.equal(Boolean(schema.dict[key].meta?.volatile), expected, `${key} must be ${expected ? 'volatile' : 'non-volatile'}`)
  }
  assert.throws(() => schema({ sandboxFallback: 'silently-unconfined' }))
  assert.equal(Config, GitBashExecutor.Config)
})

test('a live config reader overrides the mount-time snapshot', () => {
  const executor = Object.create(GitBashExecutor.prototype)
  executor.config = {
    timeoutMs: { get: () => 120_000 },
    maxTimeoutMs: { get: () => 600_000 },
    maxOutputBytes: { get: () => 64_000 },
    maxSpillBytes: { get: () => 67_108_864 },
    graceMs: { get: () => 3_000 },
    cwd: { get: () => '' },
    bashPath: { get: () => '' },
    initScript: { get: () => '' },
    sandboxFallback: { get: () => 'fail' },
  }
  assert.equal(executor.configValues().timeoutMs, 120_000, 'mount snapshot is used without a reader')
  executor.liveConfigReader = () => ({
    cwd: 'C:/work',
    timeoutMs: 5_000,
    maxTimeoutMs: 600_000,
    maxOutputBytes: 32_000,
    maxSpillBytes: 1_024,
    graceMs: 1_000,
    bashPath: 'C:/Program Files/Git/bin/bash.exe',
    initScript: '~/init.sh',
    sandboxFallback: 'unconfined',
  })
  const live = executor.configValues()
  assert.equal(live.timeoutMs, 5_000)
  assert.equal(live.bashPath, 'C:/Program Files/Git/bin/bash.exe')
  assert.equal(live.sandboxFallback, 'unconfined')
  assert.equal(live.maxOutputBytes, 32_000)
  executor.liveConfigReader = () => {
    throw new Error('reader failed')
  }
  assert.equal(executor.configValues().timeoutMs, 120_000, 'a throwing reader falls back to the mount snapshot')
})

test('gitBashRoute selects direct/confined/unconfined per the contract', () => {
  assert.deepEqual(gitBashRoute(undefined), { route: 'direct', mode: 'danger-full-access' })
  assert.deepEqual(gitBashRoute({}), { route: 'direct', mode: 'danger-full-access' })
  assert.deepEqual(gitBashRoute({ sandboxPolicy: undefined }), { route: 'direct', mode: 'danger-full-access' })
  assert.deepEqual(gitBashRoute({ sandboxPolicy: { mode: 'danger-full-access' } }), { route: 'direct', mode: 'danger-full-access' })
  assert.deepEqual(gitBashRoute({ mode: 'read-only' }, 'fail'), { route: 'confined', mode: 'read-only' })
  assert.deepEqual(gitBashRoute({ sandboxPolicy: { mode: 'workspace-write' } }, 'fail'), { route: 'confined', mode: 'workspace-write' })
  assert.deepEqual(gitBashRoute({ sandboxPolicy: { mode: 'workspace-write' } }, 'unconfined'), { route: 'unconfined', mode: 'workspace-write' })
  assert.deepEqual(gitBashRoute({ mode: 'read-only' }, 'unconfined'), { route: 'unconfined', mode: 'read-only' })
})

test('mounts in an isolated shell scope and really executes through bash', async () => {
  const { root, scope, shell } = await makeHarness()
  assert.equal(root.get('shell'), undefined, 'the root ctx.shell (official executor) must stay untouched')
  assert.equal(Object.getPrototypeOf(shell), GitBashExecutor.prototype)
  assert.equal(Object.getPrototypeOf(shell).constructor, GitBashExecutor)
  assert.equal(shell instanceof GitBashExecutor, true)
  assert.equal(shell.sandboxMode, 'danger-full-access')

  const spec = shell.resolve({ command: 'echo dsh-gitbash-win' })
  assert.equal(spec.command, 'echo dsh-gitbash-win')
  assert.equal(spec.workdir, process.cwd())
  assert.equal(spec.timeoutMs, 20_000)
  assert.equal(spec.sandboxPolicy.mode, 'danger-full-access')

  const execution = await shell.execute(spec)
  const result = await execution.result()
  assert.equal(result.exitCode, 0)
  assert.equal(result.stdout.text, 'dsh-gitbash-win\n')
  assert.equal(result.stderr.text, '')
  assert.equal(result.timedOut, false)
  assert.equal(result.aborted, false)
  assert.deepEqual(result.sandbox, { mode: 'danger-full-access', denied: false })
  assert.deepEqual(execution.sandbox, { mode: 'danger-full-access', denied: false })

  // A nonzero exit is a command result, not an executor failure.
  const failed = await (await shell.execute(shell.resolve({ command: 'exit 7' }))).result()
  assert.equal(failed.exitCode, 7)

  // stdout/stderr stay separated.
  const split = await (await shell.execute(shell.resolve({ command: 'echo out; echo err >&2' }))).result()
  assert.equal(split.stdout.text, 'out\n')
  assert.equal(split.stderr.text, 'err\n')
})

test('resolve() applies cwd/timeout defaults and caps like the host executor', async () => {
  const { shell } = await makeHarness({ executorConfig: { timeoutMs: 5_000, maxTimeoutMs: 8_000 } })
  assert.equal(shell.resolve({ command: 'x' }).timeoutMs, 5_000)
  assert.equal(shell.resolve({ command: 'x', timeoutMs: 9_000 }).timeoutMs, 8_000, 'caller timeouts are capped')
  assert.equal(shell.resolve({ command: 'x', workdir: tmpdir() }).workdir, tmpdir())
  assert.throws(() => shell.resolve({ command: 'x', timeoutMs: 0 }), /positive finite/)
  assert.throws(() => shell.resolve({ command: 'x', stdoutMaxBytes: -1 }), /positive finite/)
  // An explicit per-call policy (the tool's escalation grant) must win over the standing policy.
  const escalated = { mode: 'danger-full-access', workspaceRoot: process.cwd() }
  assert.deepEqual(shell.resolve({ command: 'x', sandboxPolicy: escalated }).sandboxPolicy, escalated)

  const configuredCwd = await makeHarness({ executorConfig: { cwd: tmpdir() } })
  assert.equal(configuredCwd.shell.resolve({ command: 'x' }).workdir, tmpdir())
})

test('a spec without a sandbox policy executes directly (danger-full-access equivalent)', async () => {
  // The standing policy confines, but a direct seam caller may hand over a
  // spec with no policy at all; the executor must then run honestly unconfined
  // and label the result danger-full-access rather than silently confining.
  const { shell, sandboxCalls } = await makeHarness({ policy: { mode: 'workspace-write' } })
  const spec = { ...shell.resolve({ command: 'echo no-policy' }), sandboxPolicy: undefined }
  const result = await (await shell.execute(spec)).result()
  assert.equal(result.exitCode, 0)
  assert.equal(result.stdout.text, 'no-policy\n')
  assert.deepEqual(result.sandbox, { mode: 'danger-full-access', denied: false })
  assert.equal(sandboxCalls.length, 0)
})

test('spawnSpec mirrors the host environment policy and output bounds', async () => {
  const { shell } = await makeHarness()
  const spec = shell.resolve({
    command: 'x',
    env: { TERM: 'xterm-256color', CUSTOM: '1' },
    dshEnv: { DSH_SESSION_ID: 'session-1' },
  })
  const spawn = shell.spawnSpec(spec, ['/bin/bash', '-c', 'x'], 1234, undefined)
  assert.deepEqual(spawn.argv, ['/bin/bash', '-c', 'x'])
  assert.equal(spawn.cwd, process.cwd())
  assert.equal(spawn.graceMs, 3_000)
  assert.equal(spawn.env.NO_COLOR, '1')
  assert.equal(spawn.env.PAGER, 'cat')
  assert.equal(spawn.env.TERM, 'xterm-256color', 'a trusted caller env entry wins over the overrides')
  assert.equal(spawn.env.CUSTOM, '1')
  assert.equal(spawn.env.DSH_SESSION_ID, 'session-1')
  assert.equal(spawn.stdio.stdin, 'ignore')
  assert.equal(spawn.stdio.stdout.maxBytes, 1234)
  assert.equal(spawn.stdio.stdout.spill.maxBytes, 67_108_864)
  assert.equal(spawn.stdio.stderr.maxBytes, 64_000)
})

test('confined mode wraps the exact Git Bash argv through ctx.sandbox.confine', async () => {
  const { shell, sandboxCalls } = await makeHarness({ policy: { mode: 'workspace-write' } })
  assert.equal(shell.sandboxMode, 'workspace-write')
  const spec = shell.resolve({ command: 'echo confined-ok' })
  assert.equal(spec.sandboxPolicy.mode, 'workspace-write')
  const result = await (await shell.execute(spec)).result()
  assert.equal(result.exitCode, 0)
  assert.equal(result.stdout.text, 'confined-ok\n')
  assert.deepEqual(result.sandbox, { mode: 'workspace-write', denied: false, enforcement: 'partial' })
  assert.equal(sandboxCalls.length, 1)
  assert.deepEqual(sandboxCalls[0].argv, [BASH, '-c', 'echo confined-ok'])
  assert.equal(sandboxCalls[0].policy.mode, 'workspace-write')
})

test('confined mode reports a denial fact when the sandbox wrap denies the file effect', async () => {
  const { shell } = await makeHarness({ policy: { mode: 'workspace-write' } })
  // Simulate what a real provider's wrapped argv produces on a denial: a
  // nonzero exit whose stderr matches the backend dialect.
  const result = await (
    await shell.execute(shell.resolve({ command: 'echo "access is denied" >&2; exit 1' }))
  ).result()
  assert.equal(result.exitCode, 1)
  assert.deepEqual(result.sandbox, { mode: 'workspace-write', denied: true, enforcement: 'partial' })
})

test('fail-closed: a sandbox runner failure rejects with SANDBOX_UNAVAILABLE and never runs the command', async () => {
  const marker = join(tmpdir(), `dsh-gitbash-win-must-not-run-${process.pid}-${Date.now()}`)
  const { shell } = await makeHarness({
    policy: { mode: 'workspace-write' },
    confine: async () => {
      throw new SandboxUnavailableError('workspace-write', 'stub ACL runner cannot start')
    },
  })
  try {
    const spec = shell.resolve({ command: `touch "${marker}"` })
    await assert.rejects(shell.execute(spec), (error) => {
      assert.equal(error.code, 'SANDBOX_UNAVAILABLE')
      assert.match(error.message, /dsh-gitbash-win: Git Bash を Windows ACL sandbox で実行できませんでした/)
      assert.match(error.message, /sandboxFallback: unconfined/)
      return true
    })
    assert.equal(existsSync(marker), false, 'the command must not have run unconfined')
  } finally {
    if (existsSync(marker)) await rm(marker, { force: true })
  }
})

test('sandboxFallback "unconfined" runs directly, labels enforcement, and warns once', async () => {
  const { root, shell, sandboxCalls } = await makeHarness({
    policy: { mode: 'workspace-write' },
    executorConfig: { sandboxFallback: 'unconfined' },
  })
  assert.equal(shell.sandboxMode, undefined, 'the tool layer must not advertise confinement/escalation fields')
  const logs = captureLogs(root)
  for (const text of ['echo unconfined-one', 'echo unconfined-two']) {
    const result = await (await shell.execute(shell.resolve({ command: text }))).result()
    assert.equal(result.exitCode, 0)
    assert.equal(result.stdout.text, `${text.slice('echo '.length)}\n`)
    assert.deepEqual(result.sandbox, { mode: 'workspace-write', denied: false, enforcement: 'unconfined' })
  }
  assert.equal(sandboxCalls.length, 0, 'ctx.sandbox.confine must not be called in unconfined fallback')
  const warnings = logs.filter((message) => String(message.args?.[0] ?? '').includes('unconfined'))
  assert.equal(warnings.length, 1, 'the explicit fallback warning is emitted once per executor')
})

test('withInitScript merges BASH_ENV into dshEnv and leaves the spec otherwise untouched', async () => {
  const { shell } = await makeHarness({ executorConfig: { initScript: '~/dsh-gitbash-init.sh' } })
  const spec = shell.resolve({ command: 'echo init' })
  const request = { ...spec, dshEnv: { DSH_SESSION_ID: 'session-1' } }
  const merged = shell.withInitScript(request)
  assert.deepEqual(merged.dshEnv, { DSH_SESSION_ID: 'session-1', BASH_ENV: join(homedir(), 'dsh-gitbash-init.sh') })
  assert.deepEqual(request.dshEnv, { DSH_SESSION_ID: 'session-1' }, 'the caller spec is not mutated')
  assert.deepEqual(merged.sandboxPolicy, request.sandboxPolicy)

  const noInit = await makeHarness()
  const plainSpec = noInit.shell.resolve({ command: 'echo init' })
  assert.equal(noInit.shell.withInitScript(plainSpec), plainSpec, 'without initScript the spec passes through unchanged')
})

test('initScript really sources through BASH_ENV before the command runs', { skip: IS_WINDOWS }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-gitbash-win-init-'))
  try {
    const initScript = join(dir, 'init.sh')
    await writeFile(initScript, 'export DSH_GITBASH_WIN_INIT=activated\n')
    const { shell } = await makeHarness({ executorConfig: { initScript } })
    const result = await (await shell.execute(shell.resolve({ command: 'printf %s "$DSH_GITBASH_WIN_INIT"' }))).result()
    assert.equal(result.exitCode, 0)
    assert.equal(result.stdout.text, 'activated')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a missing Git Bash fails closed with the documented message and no fallback', { skip: IS_WINDOWS }, async () => {
  const { shell } = await makeHarness({ executorConfig: { bashPath: '/definitely/not/installed/git/bin/bash.exe' } })
  const spec = shell.resolve({ command: 'echo nope' })
  await assert.rejects(shell.execute(spec), (error) => {
    assert.equal(error.code, GITBASH_UNAVAILABLE)
    assert.ok(error.message.startsWith(GITBASH_UNAVAILABLE_MESSAGE))
    assert.match(error.message, /fallback/)
    assert.ok(error.detection !== undefined && error.detection.ok === false)
    return true
  })
})

test('execute() rejects a non-resolved spec instead of running a malformed argv', async () => {
  const { shell } = await makeHarness()
  await assert.rejects(shell.execute({ command: undefined }), TypeError)
  await assert.rejects(shell.execute(undefined), TypeError)
})

test('a config whose timer fields exceed the host timer domain is rejected', () => {
  const refs = (values) => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { get: () => value }]))
  const base = {
    cwd: '',
    timeoutMs: 120_000,
    maxTimeoutMs: 600_000,
    maxOutputBytes: 64_000,
    maxSpillBytes: 67_108_864,
    graceMs: 3_000,
    bashPath: '/bin/bash',
    initScript: '',
    sandboxFallback: 'fail',
  }
  const make = (overrides) => {
    const executor = Object.create(GitBashExecutor.prototype)
    executor.config = refs({ ...base, ...overrides })
    return executor
  }
  assert.throws(() => make({ timeoutMs: 2 ** 31 }).resolve({ command: 'echo hi' }), /timeoutMs must be no greater than/)
  assert.throws(() => make({ maxTimeoutMs: 2 ** 31 }).resolve({ command: 'echo hi' }), /maxTimeoutMs must be no greater than/)
  assert.throws(() => make({ graceMs: 2 ** 31 }).resolve({ command: 'echo hi' }), /graceMs must be no greater than/)
})

test('markRestrictedTokenRunnerFailure turns a confined background crash into a runner failure', () => {
  const crashed = {
    exitCode: 3221225794,
    sandbox: { mode: 'workspace-write', denied: false, enforcement: 'partial' },
  }
  assert.equal(GitBashExecutor.markRestrictedTokenRunnerFailure(crashed), crashed)
  assert.deepEqual(crashed.sandbox, { mode: 'workspace-write', denied: false, enforcement: 'partial', runnerFailed: true })

  const normal = { exitCode: 0, sandbox: { mode: 'workspace-write', denied: false } }
  GitBashExecutor.markRestrictedTokenRunnerFailure(normal)
  assert.equal(normal.sandbox.runnerFailed, undefined, 'a normal exit is untouched')

  const fullAccess = { exitCode: 3221225794, sandbox: { mode: 'danger-full-access', denied: false } }
  GitBashExecutor.markRestrictedTokenRunnerFailure(fullAccess)
  assert.equal(fullAccess.sandbox.runnerFailed, undefined, 'full-access crashes are command failures, not sandbox runner failures')

  const noFacts = { exitCode: 3221225794 }
  assert.doesNotThrow(() => GitBashExecutor.markRestrictedTokenRunnerFailure(noFacts))
  assert.equal(noFacts.sandbox, undefined)
})
