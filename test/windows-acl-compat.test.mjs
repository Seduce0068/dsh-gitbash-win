/**
 * Windows ACL / restricted-token compatibility contract.
 *
 * The official Windows sandbox executes confined commands through a restricted
 * token. On a real Windows host, Git for Windows bash dies during CRT
 * initialization under that token with 0xC0000142 (STATUS_DLL_INIT_FAILED —
 * measured 2026-11-10 on a windows-latest runner, Git 2.56.0.windows.4). The
 * command never runs, but a raw NTSTATUS exit code is opaque to the model, so
 * the executor maps it onto the documented fail-closed `SANDBOX_UNAVAILABLE`
 * result. These tests are platform-independent: they feed the mapping directly.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  RESTRICTED_TOKEN_SHELL_CRASH_CODES,
  isRestrictedTokenShellCrash,
} from '../lib/executor.js'

const { GitBashExecutor } = await import('../lib/executor.js')

test('isRestrictedTokenShellCrash recognizes unsigned and signed NTSTATUS values', () => {
  assert.deepEqual([...RESTRICTED_TOKEN_SHELL_CRASH_CODES].sort((a, b) => a - b), [0xc0000005, 0xc00000fd, 0xc0000142].sort((a, b) => a - b))
  assert.equal(isRestrictedTokenShellCrash(0xc0000142), true)
  assert.equal(isRestrictedTokenShellCrash(3221225794), true, 'unsigned 0xC0000142')
  assert.equal(isRestrictedTokenShellCrash(-1073741502), true, 'signed int32 0xC0000142')
  assert.equal(isRestrictedTokenShellCrash(0xc0000005), true)
  for (const normal of [0, 1, 127, 9009, null, undefined, '0xC0000142']) {
    assert.equal(isRestrictedTokenShellCrash(normal), false, `not a restricted-token crash: ${String(normal)}`)
  }
})

test('a confined startup crash becomes SANDBOX_UNAVAILABLE instead of an opaque exit code', async () => {
  const execution = {
    result: async () => ({
      exitCode: 3221225794,
      sandbox: { mode: 'workspace-write', denied: false },
      stdout: { text: '' },
      stderr: { text: '' },
    }),
  }
  const guarded = GitBashExecutor.guardRestrictedTokenShellCrash(execution, 'workspace-write')
  await assert.rejects(guarded.result(), (error) => {
    assert.equal(error.code, 'SANDBOX_UNAVAILABLE')
    assert.match(String(error.message), /0xC0000142/i, 'the detail names the measured NTSTATUS')
    assert.match(String(error.message), /command did not run/i)
    return true
  })
})

test('a normal confined result passes through unchanged and is memoized', async () => {
  let calls = 0
  const expected = { exitCode: 0, stdout: { text: 'ok\n' }, stderr: { text: '' }, sandbox: { mode: 'workspace-write', denied: false } }
  const execution = {
    result: async () => {
      calls += 1
      return expected
    },
  }
  const guarded = GitBashExecutor.guardRestrictedTokenShellCrash(execution, 'workspace-write')
  const first = await guarded.result()
  const second = await guarded.result()
  assert.equal(first, expected)
  assert.equal(second, expected)
  assert.equal(calls, 1, 'the guarded projection is materialized once')
})

test('the guard tolerates a handle without a result projection', () => {
  const bare = { status: 'running' }
  assert.equal(GitBashExecutor.guardRestrictedTokenShellCrash(bare, 'workspace-write'), bare)
  assert.equal(GitBashExecutor.guardRestrictedTokenShellCrash(null, 'workspace-write'), null)
})
