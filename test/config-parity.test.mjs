/**
 * Contract parity with the official LocalBashExecutor (source of the
 * mechanics this plugin reuses through `SandboxBashExecutor`).
 *
 * Because the settings row must read live volatile values, `lib/executor.js`
 * overrides `resolve()`/`spawnSpec()` instead of calling the parent versions.
 * That duplication is only safe while both produce identical resolved specs and
 * spawn specs; these tests compare them field by field against the installed
 * official class, so a DSH upgrade that changes the parent contract fails here
 * instead of silently diverging.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { hostImport } from '../lib/host-modules.js'
import { GitBashExecutor } from '../lib/executor.js'
import { CONFIG_FIELD_DEFAULTS } from '../lib/schema.js'

const { LocalBashExecutor } = await hostImport('@deepseek-ai/dsh-bash-local')

/** Turn a plain config object into volatile-ref-shaped fields. */
function refs(values) {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { get: () => value }]))
}

const CONFIG = refs({ ...CONFIG_FIELD_DEFAULTS, cwd: '/tmp', bashPath: '/bin/bash', timeoutMs: 120_000 })

function ourExecutor() {
  const executor = Object.create(GitBashExecutor.prototype)
  executor.config = CONFIG
  executor.ctx = {}
  return executor
}

function officialExecutor() {
  const executor = Object.create(LocalBashExecutor.prototype)
  executor.config = CONFIG
  return executor
}

const REQUESTS = [
  { command: 'echo hi' },
  { command: 'echo capped', timeoutMs: 5_000 },
  {
    command: 'echo full',
    workdir: '/tmp',
    onExpiry: 'none',
    stdoutMaxBytes: 1_234,
    env: { GITBASH_PARITY: '1' },
    dshEnv: { DSH_CWD: '/tmp' },
    stdin: 'input\n',
  },
]

/** Remove the executors' own sandbox-policy stamp for a field-by-field compare. */
function stripPolicy(spec) {
  const { sandboxPolicy: _policy, ...rest } = spec
  return rest
}

test('resolve() matches the official LocalBashExecutor apart from the sandbox-policy stamp', () => {
  for (const request of REQUESTS) {
    const ours = ourExecutor().resolve(request)
    assert.equal(ours.sandboxPolicy, undefined, 'no sandboxPolicy service in this fixture')
    assert.deepEqual(stripPolicy(ours), stripPolicy(officialExecutor().resolve(request)), `resolved spec diverges for ${JSON.stringify(request)}`)
  }
})

test('the empty-cwd default is the one intentional resolve() difference', () => {
  const emptyCwd = refs({ ...CONFIG_FIELD_DEFAULTS, cwd: '', bashPath: '/bin/bash' })
  const ours = Object.create(GitBashExecutor.prototype)
  ours.config = emptyCwd
  ours.ctx = {}
  // Official keeps the empty configured value; this executor treats '' as
  // "the session/process cwd" (schema docs), which the tool layer overrides per
  // call anyway. Pin the behavior so the difference stays deliberate.
  assert.equal(ours.resolve({ command: 'echo hi' }).workdir, process.cwd())
})

test('spawnSpec() matches the official LocalBashExecutor for the same resolved values', () => {
  const spec = {
    command: 'echo spawn',
    workdir: '/tmp',
    timeoutMs: 1_000,
    onExpiry: 'kill',
    stdoutMaxBytes: 4_000,
    env: { GITBASH_PARITY: '1' },
    dshEnv: { DSH_CWD: '/tmp' },
    stdin: 'input\n',
  }
  const signal = new AbortController().signal
  const ours = ourExecutor().spawnSpec(spec, ['/bin/bash', '-c', spec.command], spec.stdoutMaxBytes, signal)
  const official = officialExecutor().spawnSpec(spec, ['/bin/bash', '-c', spec.command], spec.stdoutMaxBytes, signal)
  assert.deepEqual(ours, official)
})
