/**
 * The load-bearing link between a volatile settings save and the next command:
 * `lib/index.js` attaches a live config reader to the isolated executor.
 *
 * The Windows browser test proves that Save persists across a reload; these
 * tests prove the other half — the reader actually observes volatile ref
 * updates in place, which is what makes the (restart-free) next-command
 * behavior real.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

const { attachLiveConfig } = await import('../lib/index.js')

/** Build a row-config-shaped object of volatile refs over a mutable store. */
function makeStore() {
  const store = {
    cwd: '',
    timeoutMs: 120_000,
    maxTimeoutMs: 600_000,
    maxOutputBytes: 64_000,
    maxSpillBytes: 67_108_864,
    graceMs: 3_000,
    bashPath: '',
    initScript: '',
    sandboxFallback: 'fail',
  }
  const config = Object.fromEntries(Object.entries(store).map(([key]) => [key, { get: () => store[key] }]))
  return { store, config }
}

test('attachLiveConfig installs a reader that observes volatile ref edits in place', () => {
  const { store, config } = makeStore()
  const shell = {}
  const injected = []
  const scope = {
    inject(deps, callback) {
      injected.push(deps)
      callback({ shell })
    },
  }
  attachLiveConfig(scope, config)
  assert.deepEqual(injected, [['shell']], 'it waits for the isolated shell service')
  assert.equal(typeof shell.liveConfigReader, 'function')
  assert.equal(shell.liveConfigReader().timeoutMs, 120_000)
  assert.equal(shell.liveConfigReader().sandboxFallback, 'fail')

  // Simulate the Host settings write: the refs are mutated in place.
  store.timeoutMs = 5_000
  store.bashPath = 'C:/Program Files/Git/bin/bash.exe'
  store.initScript = '~/dsh-init.sh'
  store.sandboxFallback = 'unconfined'
  const live = shell.liveConfigReader()
  assert.equal(live.timeoutMs, 5_000)
  assert.equal(live.bashPath, 'C:/Program Files/Git/bin/bash.exe')
  assert.equal(live.initScript, '~/dsh-init.sh')
  assert.equal(live.sandboxFallback, 'unconfined')
  assert.equal(live.maxOutputBytes, 64_000, 'untouched fields keep their values')
})

test('attachLiveConfig tolerates a missing shell service and a missing config', () => {
  const scope = { inject: (_deps, callback) => callback({}) }
  assert.doesNotThrow(() => attachLiveConfig(scope, undefined))
  const shell = {}
  const scopeWithShell = { inject: (_deps, callback) => callback({ shell }) }
  assert.doesNotThrow(() => attachLiveConfig(scopeWithShell, undefined))
  assert.equal(typeof shell.liveConfigReader, 'function')
  assert.deepEqual(shell.liveConfigReader(), {}, 'missing config projects to an empty plain object; the executor merges its own schema defaults')
})
