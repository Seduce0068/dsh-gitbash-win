/**
 * Windows-only live tests: real Git for Windows detection and real command
 * execution through the private executor.
 *
 * These tests are skipped on POSIX hosts; they exist so the
 * `.github/workflows/windows-smoke.yml` job exercises the Windows code path on
 * a real Windows machine (GitHub-hosted runner) instead of only through the
 * injected `platform`/`env`/`fs`/`probe` unit tests.
 *
 * They need a DSH installation (the published `@deepseek-ai/dsh@0.2.2-rc.1`)
 * on the machine, exactly like the plugin itself.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const isWindows = process.platform === 'win32'
const skip = isWindows ? false : 'Windows-only live check (run in windows-smoke.yml)'

/**
 * Mount the private Git Bash executor in an isolated cordis scope, the same way
 * `lib/index.js` does, with just enough stubbed sandbox services for the
 * unconfined route.
 * @param {object} [overrides] - extra executor config fields.
 * @returns {Promise<{root: object, shell: object, detection: object}>} the mounted pieces.
 */
async function mountLive(overrides = {}) {
  const { hostImport } = await import('../lib/host-modules.js')
  const { GitBashExecutor } = await import('../lib/executor.js')
  const { resolveGitBash } = await import('../lib/detect.js')
  const { Context, Service } = await hostImport('@deepseek-ai/cordis')
  const subprocess = await hostImport('@deepseek-ai/dsh-subprocess-local')

  const detection = await resolveGitBash({ cache: false })
  assert.equal(detection.ok, true, detection.report)

  class StubSandboxPolicy extends Service {
    constructor(ctx) {
      super(ctx, 'sandboxPolicy')
      this.defaultMode = 'danger-full-access'
    }
    resolve() {
      return { mode: 'danger-full-access', workspaceRoot: process.cwd() }
    }
  }
  class StubSandbox extends Service {
    constructor(ctx) {
      super(ctx, 'sandbox')
    }
    confine() {
      throw new Error('the sandbox is not used by the unconfined live tests')
    }
  }

  const root = new Context()
  await root.plugin(subprocess.default, {})
  await root.plugin(StubSandboxPolicy, {})
  await root.plugin(StubSandbox, {})
  const scope = root.isolate('shell')
  await scope.plugin(GitBashExecutor, {
    bashPath: detection.path,
    sandboxFallback: 'fail',
    cwd: process.cwd(),
    timeoutMs: 120000,
    maxTimeoutMs: 600000,
    maxOutputBytes: 64000,
    ...overrides,
  })
  const shell = scope.get('shell')
  assert.ok(shell !== undefined, 'the isolated shell service must be mounted')
  return { root, shell, detection }
}

/** Convert a Windows path to the POSIX spelling Git Bash understands. */
function toPosixPath(bash, windowsPath) {
  const converted = execFileSync(bash, ['-c', 'cygpath -u "$1"', '--', windowsPath], { encoding: 'utf8' })
  return converted.trim()
}

test('detection resolves the installed Git for Windows bash and probes MINGW', { skip }, async () => {
  const { resolveGitBash, probeBash } = await import('../lib/detect.js')
  const result = await resolveGitBash({ cache: false })
  assert.equal(result.ok, true, result.report)
  assert.ok(typeof result.path === 'string' && result.path.length > 0, 'a resolved path is present')
  assert.match(result.path.toLowerCase(), /git[\\/]bin[\\/]bash\.exe$/, 'auto-detection picked Git for Windows bash.exe')
  const probe = await probeBash(result.path)
  assert.equal(probe.ok, true, probe.error ?? 'probe failed')
  assert.match(probe.system ?? '', /^MINGW/i, 'uname -s reports a MINGW system')
})

test('the private executor spawns Git Bash inside an isolated cordis scope', { skip }, async () => {
  const { root, shell } = await mountLive()
  try {
    const spec = shell.resolve({ command: 'echo windows-live; uname -s; pwd' })
    const result = await (await shell.execute(spec)).result()
    assert.equal(result.exitCode, 0, `stderr: ${result.stderr.text}`)
    assert.match(result.stdout.text, /windows-live/)
    assert.match(result.stdout.text, /MINGW/i)
  } finally {
    await root.fiber.dispose()
  }
})

test('initScript is exported as BASH_ENV and sourced by every command', { skip }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-gitbash-win-live-'))
  try {
    const script = join(dir, 'init.sh')
    await writeFile(script, 'export DSH_WIN_LIVE_INIT=from-init-script\n')
    // BASH_ENV must be a path bash itself can open; convert the Windows temp
    // path to its POSIX spelling using the resolved Git Bash.
    const detection = (await import('../lib/detect.js')).resolveGitBash
    const resolved = await detection({ cache: false })
    assert.equal(resolved.ok, true, resolved.report)
    const initScript = toPosixPath(resolved.path, script)
    const { root, shell } = await mountLive({ initScript })
    try {
      const spec = shell.resolve({ command: 'echo "init=$DSH_WIN_LIVE_INIT"' })
      const result = await (await shell.execute(spec)).result()
      assert.equal(result.exitCode, 0, `stderr: ${result.stderr.text}`)
      assert.match(result.stdout.text, /init=from-init-script/)
    } finally {
      await root.fiber.dispose()
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the explicit unconfined fallback labels its sandbox facts and hides the mode', { skip }, async () => {
  const { root, shell } = await mountLive({ sandboxFallback: 'unconfined' })
  try {
    assert.equal(shell.sandboxMode, undefined, 'no sandbox mode is advertised for the unconfined route')
    const spec = shell.resolve({
      command: 'echo fallback-ok',
      sandboxPolicy: { mode: 'workspace-write', workspaceRoot: process.cwd() },
    })
    const result = await (await shell.execute(spec)).result()
    assert.equal(result.exitCode, 0, `stderr: ${result.stderr.text}`)
    assert.match(result.stdout.text, /fallback-ok/)
    assert.equal(result.sandbox?.enforcement, 'unconfined')
    assert.equal(result.sandbox?.mode, 'workspace-write')
    assert.equal(result.sandbox?.denied, false)
  } finally {
    await root.fiber.dispose()
  }
})
