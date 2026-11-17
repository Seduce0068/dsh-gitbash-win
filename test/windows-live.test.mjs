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
import { join, win32 as winPath } from 'node:path'

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
    const resolveDetection = (await import('../lib/detect.js')).resolveGitBash
    const resolved = await resolveDetection({ cache: false })
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

// --- Real registry (reg.exe) live checks ------------------------------------
//
// REG_EXPAND_SZ `%VAR%` expansion is deliberately NOT re-tested here: making a
// real InstallPath contain a `%VAR%` would mean WRITING to the machine registry,
// which is unsafe on a shared/GitHub-hosted runner. That logic is already
// covered as a pure function by `test/detect.test.mjs`:
// `expandEnvVars expands REG_EXPAND_SZ values case-insensitively`. These live
// checks only READ the registry and use the existing InstallPath values
// (normally plain ASCII paths), so no Japanese-locale runner is required.

/** Registry keys written by the Git for Windows installer (mirrors lib/detect.js). */
const REGISTRY_KEYS = Object.freeze([
  'HKCU\\SOFTWARE\\GitForWindows',
  'HKLM\\SOFTWARE\\GitForWindows',
  'HKLM\\SOFTWARE\\WOW6432Node\\GitForWindows',
])

/**
 * Query one `GitForWindows\InstallPath` value with the REAL reg.exe and keep
 * the raw bytes (`encoding: 'buffer'`), so lib/detect.js's CP932 decoder can be
 * exercised on genuine reg.exe output. `null` means the key is absent or
 * unreadable — the same read-only, ignore-failures rule the production lookup
 * follows. Nothing is ever written to the registry.
 * @param {string} key - registry key to query.
 * @returns {Buffer|null} raw reg.exe stdout, or null when unavailable.
 */
function queryInstallPathBuffer(key) {
  const systemRoot = process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows'
  const regExe = winPath.join(systemRoot, 'System32', 'reg.exe')
  try {
    return execFileSync(regExe, ['query', key, '/v', 'InstallPath'], {
      encoding: 'buffer',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return null
  }
}

/**
 * InstallPath values advertised by the real registry, turned into the same
 * `bin\bash.exe` candidates lib/detect.js builds (decoded with its own decoder
 * and expanded with the real process env). Injected as `registryQuery` in the
 * candidate test below so the registry fallback can be reached on a machine
 * where Git for Windows is also installed in a known directory — the bytes
 * still come from reg.exe on this host, only the trigger is forced.
 * @param {object} detect - the loaded `lib/detect.js` module.
 * @returns {string[]} candidate bash.exe paths from the real registry.
 */
function readRegistryBashPaths({ decodeRegistryOutput, expandEnvVars }) {
  const found = []
  for (const key of REGISTRY_KEYS) {
    const raw = queryInstallPathBuffer(key)
    if (raw === null) continue
    const text = decodeRegistryOutput(raw)
    const installPath = /InstallPath\s+REG_\w+\s+(\S.*?)\s*$/im.exec(text)?.[1]?.trim()
    if (!installPath) continue
    const expanded = expandEnvVars(installPath, process.env)
    found.push(winPath.join(expanded.replace(/[\\/]+$/, ''), 'bin', 'bash.exe'))
  }
  return found
}

test('real reg.exe InstallPath values appear as registry candidates in resolveGitBash', { skip }, async (t) => {
  const detect = await import('../lib/detect.js')
  const registryPaths = readRegistryBashPaths(detect)
  if (registryPaths.length === 0) {
    t.skip('no GitForWindows\\InstallPath value in HKCU/HKLM (Git for Windows was not registered by its installer)')
    return
  }
  const expected = new Set(registryPaths.map((path) => path.toLowerCase()))

  // On a hosted runner Git for Windows is usually found in a known directory,
  // so detection returns BEFORE consulting the registry. Force the known-dir /
  // PATH / git-sibling branches to miss with fake directories and an empty PATH
  // (SystemRoot stays real). The registry values themselves are still read from
  // the real reg.exe via the injected query, so the candidates are genuinely
  // registry-derived rather than synthesised by the test.
  const forcedEnv = {
    ...process.env,
    ProgramFiles: 'C:\\__dsh_registry_live__\\PF',
    'ProgramFiles(x86)': 'C:\\__dsh_registry_live__\\PF86',
    ProgramW6432: 'C:\\__dsh_registry_live__\\PF64',
    LOCALAPPDATA: 'C:\\__dsh_registry_live__\\Local',
    PATH: '',
    Path: '',
  }
  const result = await detect.resolveGitBash({
    cache: false,
    env: forcedEnv,
    registryQuery: async () => registryPaths,
  })

  const registryCandidates = result.candidates.filter((candidate) => candidate.source === 'registry')
  assert.ok(
    registryCandidates.length > 0,
    `expected registry-sourced candidates, got ${JSON.stringify(result.candidates.map((candidate) => `${candidate.source}:${candidate.path}`))}`,
  )
  for (const candidate of registryCandidates) {
    assert.ok(
      expected.has(String(candidate.path).toLowerCase()),
      `registry candidate ${candidate.path} must come from a real InstallPath value: ${JSON.stringify(registryPaths)}`,
    )
    assert.match(candidate.path, /[\\/]bin[\\/]bash\.exe$/i, 'registry candidate points at bin\\bash.exe')
  }
})

test('decodeRegistryOutput handles real reg.exe output received as a Buffer', { skip }, async (t) => {
  const { decodeRegistryOutput } = await import('../lib/detect.js')
  for (const key of REGISTRY_KEYS) {
    const raw = queryInstallPathBuffer(key)
    if (raw === null) continue
    assert.equal(Buffer.isBuffer(raw), true, `reg.exe output for ${key} was received with encoding: 'buffer'`)
    const text = decodeRegistryOutput(raw)
    const installPath = /InstallPath\s+REG_\w+\s+(\S.*?)\s*$/im.exec(text)?.[1]?.trim()
    assert.ok(
      typeof installPath === 'string' && installPath.length > 0,
      `decoded reg.exe output for ${key} must expose an InstallPath value: ${JSON.stringify(text)}`,
    )
    assert.match(installPath, /[\\/]/, `InstallPath must look like a path: ${JSON.stringify(installPath)}`)
    assert.equal(text.includes('\ufffd'), false, 'CP932 decoding must not leave U+FFFD replacement characters')
    // An ASCII InstallPath decodes identically under CP932 and UTF-8, which is
    // why this live check does not need a Japanese-locale runner.
    assert.ok(text.includes(installPath), 'the decoded path is present verbatim in the decoded output')
    return
  }
  t.skip('no GitForWindows\\InstallPath value in HKCU/HKLM (Git for Windows was not registered by its installer)')
})
