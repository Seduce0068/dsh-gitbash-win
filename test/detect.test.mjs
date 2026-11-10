/**
 * Tests for `lib/detect.js` — Git for Windows discovery/validation.
 *
 * The Windows-specific logic is exercised as a pure function of
 * `(platform, configured, env, fs, probe)` so it can be verified on this
 * (POSIX) host; the two live probes (`/bin/bash` is not a Git Bash) prove the
 * real spawn path and the fail-closed identification rule.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MAX_REPORTED_TRIED_PATHS,
  NEGATIVE_RESULT_TTL_MS,
  candidateBashPaths,
  clearDetectionCache,
  expandHomePath,
  isWslAlias,
  isGitForWindowsSystem,
  probeBash,
  resolveGitBash,
} from '../lib/detect.js'

const PROGRAM_FILES = 'C:\\Program Files'
const PROGRAM_FILES_X86 = 'C:\\Program Files (x86)'
const LOCAL_APP_DATA = 'C:\\Users\\u\\AppData\\Local'
const PF_BASH = `${PROGRAM_FILES}\\Git\\bin\\bash.exe`
const PF86_BASH = `${PROGRAM_FILES_X86}\\Git\\bin\\bash.exe`
const LOCAL_BASH = `${LOCAL_APP_DATA}\\Programs\\Git\\bin\\bash.exe`
const PATH_BASH = `${PROGRAM_FILES}\\Git\\cmd\\bash.exe`
const TOOLS_BASH = 'C:\\tools\\bash.exe'

/** A Windows-shaped env with Program Files, LOCALAPPDATA and a PATH. */
function winEnv(overrides = {}) {
  return {
    SystemRoot: 'C:\\Windows',
    ProgramFiles: PROGRAM_FILES,
    'ProgramFiles(x86)': PROGRAM_FILES_X86,
    ProgramW6432: PROGRAM_FILES,
    LOCALAPPDATA: LOCAL_APP_DATA,
    PATH: `C:\\Windows\\System32;"${PROGRAM_FILES}\\Git\\cmd";C:\\tools`,
    ...overrides,
  }
}

/** A stub fs that only reports the given paths as existing files. */
function stubFs(existingPaths) {
  const paths = new Set(existingPaths)
  const fileStat = { isFile: () => true, isSymbolicLink: () => false }
  return {
    existsSync: (path) => paths.has(path),
    statSync: (path) => {
      if (!paths.has(path)) throw new Error(`ENOENT: ${path}`)
      return fileStat
    },
  }
}

/** A probe stub that accepts only the given paths and records every call. */
function stubProbe(acceptedPaths, { system = 'MINGW64_NT-10.0-22631', version = '5.2.37(1)-release' } = {}) {
  const accepted = new Set(acceptedPaths)
  const calls = []
  const probe = async (path) => {
    calls.push(path)
    return accepted.has(path)
      ? { ok: true, system, version, error: null }
      : { ok: false, system: 'Linux', version: null, error: 'not a Git for Windows (MINGW/MSYS/CYGWIN) bash' }
  }
  return { probe, calls }
}

test('expandHomePath expands a leading ~ and strips surrounding quotes', () => {
  assert.equal(expandHomePath('~/init.sh', '/home/u'), '/home/u/init.sh')
  assert.equal(expandHomePath('~\\init.sh', 'C:\\Users\\u'), 'C:\\Users\\u\\init.sh')
  assert.equal(expandHomePath('~', '/home/u'), '/home/u')
  assert.equal(expandHomePath('  "~/my init.sh"  ', '/home/u'), '/home/u/my init.sh')
  assert.equal(expandHomePath("'~/quoted.sh'", '/home/u'), '/home/u/quoted.sh')
  assert.equal(expandHomePath('~/x', '/home/u/'), '/home/u/x', 'trailing separators on homedir are normalized')
  assert.equal(expandHomePath('/abs/path', '/home/u'), '/abs/path')
  assert.equal(expandHomePath('~other/x', '/home/u'), '~other/x', 'only ~, ~/ and ~\\ are expanded')
  assert.equal(expandHomePath('', '/home/u'), '')
  assert.equal(expandHomePath(undefined, '/home/u'), '')
  assert.equal(expandHomePath(null, '/home/u'), '')
})

test('isWslAlias rejects System32 and WindowsApps bash aliases', () => {
  const env = { SystemRoot: 'C:\\Windows' }
  assert.equal(isWslAlias('C:\\Windows\\System32\\bash.exe', env), true)
  assert.equal(isWslAlias('c:/windows/system32/bash.exe', env), true)
  assert.equal(isWslAlias('C:\\Windows\\SysWOW64\\bash.exe', env), true)
  assert.equal(isWslAlias('C:\\Users\\u\\AppData\\Local\\Microsoft\\WindowsApps\\bash.exe', env), true)
  assert.equal(isWslAlias('C:\\Program Files\\Git\\bin\\bash.exe', env), false)
  assert.equal(isWslAlias('/bin/bash', env), false)
  assert.equal(isWslAlias('', env), false)
  assert.equal(isWslAlias(undefined, env), false)
  // A custom Windows root is honored, and a non-default root still matches its own System32.
  assert.equal(isWslAlias('D:\\Win\\System32\\bash.exe', { SystemRoot: 'D:\\Win' }), true)
  assert.equal(isWslAlias('E:\\Tools\\bash.exe', { SystemRoot: 'D:\\Win' }), false)
})

test('candidateBashPaths lists Windows candidates in documented priority order', () => {
  const candidates = candidateBashPaths({ platform: 'win32', env: winEnv() })
  assert.deepEqual(candidates, [
    PF_BASH, // known dir: %ProgramFiles%\Git\bin
    PF86_BASH, // known dir: %ProgramFiles(x86)%\Git\bin
    LOCAL_BASH, // known dir: %LOCALAPPDATA%\Programs\Git\bin
    PATH_BASH, // PATH bash.exe (Git\cmd on PATH)
    TOOLS_BASH, // PATH bash.exe (C:\tools)
    'C:\\bin\\bash.exe', // git.exe sibling of C:\tools\... (dirname(C:\tools) = C:\)
  ])
})

test('candidateBashPaths skips WSL/WindowsApps PATH entries', () => {
  const env = winEnv({
    PATH: 'C:\\Windows\\System32;C:\\Users\\u\\AppData\\Local\\Microsoft\\WindowsApps;D:\\Git\\cmd',
  })
  const candidates = candidateBashPaths({ platform: 'win32', env })
  assert.equal(candidates.some((path) => path.toLowerCase().includes('system32')), false)
  assert.equal(candidates.some((path) => path.toLowerCase().includes('windowsapps')), false)
  assert.ok(candidates.includes('D:\\Git\\cmd\\bash.exe'))
  assert.ok(candidates.includes('D:\\Git\\bin\\bash.exe'))
})

test('candidateBashPaths is Windows-only and handles quoted/path noise', () => {
  assert.deepEqual(candidateBashPaths({ platform: 'linux', env: winEnv() }), [])
  assert.deepEqual(candidateBashPaths({ platform: 'darwin', env: winEnv() }), [])
  const env = winEnv({ PATH: `  "${PROGRAM_FILES}\\Git\\cmd" ; ;relative\\bin;${'C:\\Windows\\System32'}` })
  const candidates = candidateBashPaths({ platform: 'win32', env })
  assert.ok(candidates.includes(PATH_BASH), 'quoted PATH entries are unwrapped')
  assert.ok(candidates.includes('C:\\Program Files\\Git\\bin\\bash.exe'), 'git-sibling of quoted Git\\cmd is included')
})

test('probeBash rejects a POSIX bash: uname -s must report MINGW/MSYS/CYGWIN', { skip: process.platform === 'win32' }, async () => {
  const result = await probeBash('/bin/bash')
  assert.equal(result.ok, false)
  assert.equal(result.system, 'Linux')
  assert.equal(result.version, null)
  assert.match(result.error, /Git for Windows/)
})

test('probeBash reports a spawn failure for a missing executable', async () => {
  const result = await probeBash('/definitely/not/a/real/bash-binary')
  assert.equal(result.ok, false)
  assert.equal(result.system, null)
  assert.ok(typeof result.error === 'string' && result.error.length > 0)
  assert.match(result.error, /ENOENT|spawn|no output/i)
})

test('probeBash rejects an empty path without spawning', async () => {
  assert.deepEqual(await probeBash(''), { ok: false, system: null, version: null, error: 'empty bash path' })
})

test('probeBash accepts a MINGW-identifying bash and reads its version', { skip: process.platform === 'win32' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-gitbash-win-probe-'))
  try {
    const fakeBash = join(dir, 'bash')
    await writeFile(fakeBash, '#!/bin/sh\nif [ "$1" = "-c" ]; then echo MINGW64_NT-10.0-22631; echo "GNU bash, version 5.2.37(1)-release (x86_64-pc-msys)"; fi\n')
    await chmod(fakeBash, 0o755)
    const result = await probeBash(fakeBash)
    assert.equal(result.ok, true)
    assert.equal(result.system, 'MINGW64_NT-10.0-22631')
    assert.equal(result.version, '5.2.37(1)-release')
    assert.equal(result.error, null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('resolveGitBash prefers an explicit configured path over auto-detection', async () => {
  const configured = 'C:\\Custom\\Git\\bin\\bash.exe'
  const { probe, calls } = stubProbe([configured, PF_BASH])
  const result = await resolveGitBash({
    configured,
    platform: 'win32',
    env: winEnv(),
    probe,
    fs: stubFs([configured, PF_BASH]),
    cache: false,
    registryQuery: async () => [],
  })
  assert.equal(result.ok, true)
  assert.equal(result.path, configured)
  assert.equal(result.source, 'configured')
  assert.equal(result.warning, null)
  assert.deepEqual(calls, [configured], 'the configured path is probed before any candidate')
  assert.deepEqual(result.candidates, [{ path: configured, ok: true, source: 'configured', reason: null }])
  assert.match(result.report, /source: configured/)
})

test('resolveGitBash keeps an explicitly configured bash even when uname does not identify MINGW', async () => {
  const configured = 'C:\\Users\\u\\scoop\\apps\\git\\bin\\bash.exe'
  const probe = async (path) => ({ ok: false, system: 'Linux', version: null, error: 'not Git Bash' })
  const result = await resolveGitBash({
    configured,
    platform: 'win32',
    env: winEnv(),
    probe,
    fs: stubFs([configured]),
    cache: false,
    registryQuery: async () => [],
  })
  assert.equal(result.ok, true, 'a user explicit path is not discarded')
  assert.equal(result.path, configured)
  assert.equal(result.source, 'configured')
  assert.ok(typeof result.warning === 'string' && result.warning.includes('MINGW/MSYS/CYGWIN'))
  assert.equal(result.candidates[0].ok, true)
  assert.equal(result.candidates[0].reason, result.warning)
})

test('resolveGitBash rejects a configured WSL alias and auto-detects a real Git Bash', async () => {
  const configured = 'C:\\Windows\\System32\\bash.exe'
  const { probe, calls } = stubProbe([PF_BASH])
  const result = await resolveGitBash({
    configured,
    platform: 'win32',
    env: winEnv(),
    probe,
    fs: stubFs([configured, PF_BASH]),
    cache: false,
    registryQuery: async () => [],
  })
  assert.equal(result.ok, true)
  assert.equal(result.path, PF_BASH)
  assert.equal(result.source, 'known-dir')
  assert.equal(result.candidates[0].ok, false)
  assert.equal(result.candidates[0].source, 'configured')
  assert.match(result.candidates[0].reason, /WSL/)
  assert.deepEqual(calls, [PF_BASH], 'the WSL alias is never spawned')
})

test('resolveGitBash falls back to auto-detection when the configured path does not exist', async () => {
  const configured = 'D:\\Missing\\Git\\bin\\bash.exe'
  const { probe, calls } = stubProbe([PF_BASH])
  const result = await resolveGitBash({
    configured,
    platform: 'win32',
    env: winEnv(),
    probe,
    fs: stubFs([PF_BASH]),
    cache: false,
    registryQuery: async () => [],
  })
  assert.equal(result.ok, true)
  assert.equal(result.path, PF_BASH)
  assert.equal(result.candidates[0].reason, 'configured path does not exist')
  assert.deepEqual(calls, [PF_BASH])
})

test('resolveGitBash probes existing auto-detection candidates in priority order', async () => {
  const { probe, calls } = stubProbe([PF86_BASH])
  const result = await resolveGitBash({
    platform: 'win32',
    env: winEnv({ PATH: `${PROGRAM_FILES}\\Git\\cmd` }),
    probe,
    fs: stubFs([PF86_BASH, PATH_BASH]),
    cache: false,
    registryQuery: async () => [],
  })
  assert.equal(result.ok, true)
  assert.equal(result.path, PF86_BASH)
  assert.equal(result.source, 'known-dir')
  assert.deepEqual(calls, [PF86_BASH], 'only existing candidates are probed, in candidate order')
})

test('resolveGitBash finds a Git bin sibling of a PATH git.exe', async () => {
  const pg = 'D:\\PortableGit'
  const sibling = `${pg}\\bin\\bash.exe`
  const { probe } = stubProbe([sibling])
  const result = await resolveGitBash({
    platform: 'win32',
    env: winEnv({ PATH: `${pg}\\cmd` }),
    probe,
    fs: stubFs([sibling]),
    cache: false,
    registryQuery: async () => [],
  })
  assert.equal(result.ok, true)
  assert.equal(result.path, sibling)
  assert.equal(result.source, 'git-sibling')
})

test('resolveGitBash uses the registry InstallPath as the last resort', async () => {
  const regBash = 'E:\\Git\\bin\\bash.exe'
  const { probe } = stubProbe([regBash])
  const registryCalls = []
  const result = await resolveGitBash({
    platform: 'win32',
    env: winEnv({ PATH: '' }),
    probe,
    fs: stubFs([regBash]),
    cache: false,
    registryQuery: async ({ env }) => {
      registryCalls.push(env)
      return [regBash]
    },
  })
  assert.equal(result.ok, true)
  assert.equal(result.path, regBash)
  assert.equal(result.source, 'registry')
  assert.equal(registryCalls.length, 1)
})

test('resolveGitBash ignores a registry failure and fails closed', async () => {
  const { probe } = stubProbe([])
  const result = await resolveGitBash({
    platform: 'win32',
    env: winEnv({ PATH: '' }),
    probe,
    fs: stubFs([]),
    cache: false,
    registryQuery: async () => {
      throw new Error('reg.exe is not available')
    },
  })
  assert.equal(result.ok, false)
  assert.equal(result.path, null)
  assert.equal(result.source, null)
  assert.ok(result.candidates.length > 0)
  assert.ok(result.candidates.every((candidate) => candidate.ok === false))
  assert.match(result.report, /not found/)
  assert.match(result.report, /bashPath/)
})

test('resolveGitBash fails closed when detection finds no Git Bash', async () => {
  const { probe, calls } = stubProbe([])
  const result = await resolveGitBash({
    platform: 'win32',
    env: winEnv({ PATH: '' }),
    probe,
    fs: stubFs([]),
    cache: false,
    registryQuery: async () => [],
  })
  assert.equal(result.ok, false)
  assert.equal(result.path, null)
  assert.equal(result.source, null)
  assert.equal(calls.length, 0, 'nonexistent candidates are not spawned')
  assert.ok(result.candidates.some((candidate) => candidate.reason === 'not found'))
})

test('resolveGitBash converts a throwing probe into a rejected candidate', async () => {
  const configured = 'C:\\Broken\\bash.exe'
  const probe = async () => {
    throw new Error('probe exploded')
  }
  const result = await resolveGitBash({
    configured,
    platform: 'win32',
    env: winEnv({ PATH: '' }),
    probe,
    fs: stubFs([configured]),
    cache: false,
    registryQuery: async () => [],
  })
  assert.equal(result.ok, false)
  assert.match(result.candidates[0].reason, /probe failed/)
})

test('resolveGitBash expands ~ in the configured path', async () => {
  const expanded = 'C:\\Users\\u\\git\\bin\\bash.exe'
  const { probe } = stubProbe([expanded])
  const result = await resolveGitBash({
    configured: '~\\git\\bin\\bash.exe',
    platform: 'win32',
    env: winEnv(),
    homedir: 'C:\\Users\\u',
    probe,
    fs: stubFs([expanded]),
    cache: false,
    registryQuery: async () => [],
  })
  assert.equal(result.ok, true)
  assert.equal(result.path, expanded)
  assert.equal(result.source, 'configured')
})

test('resolveGitBash is Windows-only unless an explicit path is configured', async () => {
  const noConfig = await resolveGitBash({ platform: 'linux', env: {}, cache: false })
  assert.equal(noConfig.ok, false)
  assert.equal(noConfig.path, null)
  assert.match(noConfig.report, /Windows-only/i)
  assert.equal(noConfig.candidates.length, 0)

  const testBash = '/usr/local/bin/test-git-bash'
  const explicit = await resolveGitBash({
    configured: testBash,
    platform: 'linux',
    env: {},
    probe: async () => ({ ok: false, system: 'Linux', version: null, error: 'not Git Bash' }),
    fs: stubFs([testBash]),
    cache: false,
  })
  assert.equal(explicit.ok, true, 'explicit POSIX paths are accepted on existence (development/testing)')
  assert.equal(explicit.path, testBash)
  assert.equal(explicit.source, 'configured')
  assert.equal(explicit.warning, null)
  assert.match(explicit.candidates[0].reason, /skipped on linux/)

  const missing = await resolveGitBash({
    configured: testBash,
    platform: 'linux',
    env: {},
    fs: stubFs([]),
    cache: false,
  })
  assert.equal(missing.ok, false)
  assert.match(missing.report, /Windows-only|not usable/i)
})

test('resolveGitBash memoizes identical inputs and honors cache: false', async () => {
  clearDetectionCache()
  const env = winEnv({ PATH: 'F:\\Git\\cmd' })
  const bash = 'F:\\Git\\cmd\\bash.exe'
  const { probe, calls } = stubProbe([bash])
  const options = { platform: 'win32', env, probe, fs: stubFs([bash]), registryQuery: async () => [] }
  const first = await resolveGitBash(options)
  const second = await resolveGitBash(options)
  assert.equal(second, first, 'identical inputs return the same memoized result object')
  assert.equal(calls.length, 1, 'the probe runs only once')
  const fresh = await resolveGitBash({ ...options, cache: false })
  assert.notEqual(fresh, first)
  assert.equal(calls.length, 2, 'cache: false forces a fresh detection')
})

test('resolveGitBash fails closed when the configured bash exists but cannot execute', async () => {
  const configured = 'C:\\Broken\\Git\\bin\\bash.exe'
  const probeCalls = []
  const probe = async (path) => {
    probeCalls.push(path)
    return { ok: false, system: null, version: null, error: 'spawn EACCES' }
  }
  let registryCalls = 0
  const result = await resolveGitBash({
    configured,
    platform: 'win32',
    env: winEnv(),
    probe,
    // Auto-detection would have found this perfectly good real Git Bash:
    fs: stubFs([configured, PF_BASH, PATH_BASH]),
    cache: false,
    registryQuery: async () => {
      registryCalls += 1
      return ['D:\\Git\\bin\\bash.exe']
    },
  })
  assert.equal(result.ok, false, "no silent substitution for the user's explicit choice")
  assert.equal(result.path, null)
  assert.deepEqual(probeCalls, [configured], 'auto-detection candidates are never probed')
  assert.equal(registryCalls, 0, 'the registry fallback is never consulted')
  assert.equal(result.candidates.length, 1)
  assert.equal(result.candidates[0].source, 'configured')
  assert.match(result.candidates[0].reason, /probe failed/)
  assert.match(result.report, /not runnable/)
  assert.ok(result.report.includes(configured))
})

test('resolveGitBash fails closed when the configured path is not a file', async () => {
  const configured = 'C:\\GitDir'
  const probeCalls = []
  const directoryFs = {
    existsSync: (path) => path === configured,
    statSync: () => ({ isFile: () => false, isSymbolicLink: () => false }),
  }
  const result = await resolveGitBash({
    configured,
    platform: 'win32',
    env: winEnv(),
    probe: async (path) => {
      probeCalls.push(path)
      return { ok: true, system: 'MINGW64_NT', version: '5.2', error: null }
    },
    fs: directoryFs,
    cache: false,
    registryQuery: async () => [],
  })
  assert.equal(result.ok, false)
  assert.deepEqual(probeCalls, [], 'a directory is rejected before any probe')
  assert.equal(result.candidates[0].reason, 'configured path is not a file')
  assert.match(result.report, /not runnable/)
})

test('negative detection results expire after the negative TTL while successes stay memoized', async () => {
  clearDetectionCache()
  let clock = 1_000_000
  let probes = 0
  const failingProbe = async () => {
    probes += 1
    return { ok: false, system: 'Linux', version: null, error: 'not a Git for Windows (MINGW/MSYS/CYGWIN) bash' }
  }
  const base = {
    platform: 'win32',
    env: winEnv({ PATH: '' }),
    fs: stubFs([PF_BASH]),
    probe: failingProbe,
    cache: true,
    now: () => clock,
    registryQuery: async () => [],
  }

  const first = await resolveGitBash(base)
  assert.equal(first.ok, false)
  assert.equal(probes, 1)

  clock += NEGATIVE_RESULT_TTL_MS - 1
  const memoized = await resolveGitBash(base)
  assert.equal(memoized, first, 'inside the TTL the memoized negative result is returned')
  assert.equal(probes, 1, 'no re-probe inside the TTL')

  clock += 2
  const fresh = await resolveGitBash(base)
  assert.notEqual(fresh, first, 'after the negative TTL a fresh detection runs')
  assert.equal(fresh.ok, false)
  assert.ok(probes > 1, 'the probe ran again after expiry')

  // A negativeTtlMs of 0 disables negative memoization entirely.
  clearDetectionCache()
  const zeroTtl = { ...base, negativeTtlMs: 0 }
  const zeroFirst = await resolveGitBash(zeroTtl)
  const probesAfterZeroFirst = probes
  const zeroSecond = await resolveGitBash(zeroTtl)
  assert.notEqual(zeroSecond, zeroFirst)
  assert.ok(probes > probesAfterZeroFirst)

  // Successes are never expired by the negative TTL (nor by negativeTtlMs: 0).
  clearDetectionCache()
  let successes = 0
  const okProbe = async () => {
    successes += 1
    return { ok: true, system: 'MINGW64_NT-10.0-22631', version: '5.2.37(1)-release', error: null }
  }
  const okBase = { ...base, probe: okProbe, negativeTtlMs: 0 }
  const okFirst = await resolveGitBash(okBase)
  assert.equal(okFirst.ok, true)
  clock += 10_000_000
  const okSecond = await resolveGitBash(okBase)
  assert.equal(okSecond, okFirst, 'successes stay memoized until clearDetectionCache()')
  assert.equal(successes, 1)

  // clearDetectionCache() drops everything, including successes.
  clearDetectionCache()
  const afterClear = await resolveGitBash(okBase)
  assert.notEqual(afterClear, okFirst)
  assert.equal(successes, 2)
})

test('the fail-closed report caps the tried-path list', async () => {
  const dirs = Array.from({ length: 12 }, (_, index) => `C:\\dir${index}`)
  const { probe } = stubProbe([])
  const result = await resolveGitBash({
    platform: 'win32',
    env: winEnv({ PATH: dirs.join(';') }),
    probe,
    fs: stubFs([]),
    cache: false,
    registryQuery: async () => [],
  })
  assert.equal(result.ok, false)
  assert.ok(result.candidates.length > MAX_REPORTED_TRIED_PATHS, 'the fixture must exceed the cap')
  const match = /\(\+(\d+) more\)/.exec(result.report)
  assert.ok(match !== null, 'the truncation marker is present')
  assert.equal(Number(match[1]), result.candidates.length - MAX_REPORTED_TRIED_PATHS)
  assert.ok(result.report.includes(result.candidates[MAX_REPORTED_TRIED_PATHS - 1].path), 'the first 8 paths are listed')
  assert.equal(result.report.includes(result.candidates[MAX_REPORTED_TRIED_PATHS].path), false, 'later paths are truncated')
})

test('detect.js and executor.js never spawn a shell', async () => {
  for (const file of ['../lib/detect.js', '../lib/executor.js']) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8')
    assert.equal(/shell\s*:\s*true/.test(source), false, `${file} must never use shell: true`)
  }
})

test('the plugin directory has no bare @deepseek-ai static imports', async () => {
  for (const file of ['../lib/detect.js', '../lib/executor.js', '../lib/schema.js', '../lib/host-modules.js']) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8')
    const staticImports = [...source.matchAll(/^import\s[^'"]*['"]([^'"]+)['"]/gm)].map((match) => match[1])
    for (const specifier of staticImports) {
      assert.ok(specifier.startsWith('node:') || specifier.startsWith('./') || specifier.startsWith('../'), `${file} statically imports non-builtin/non-local "${specifier}"`)
    }
  }
})

test('isGitForWindowsSystem accepts MINGW only, not MSYS/Cygwin/Linux', () => {
  assert.equal(isGitForWindowsSystem('MINGW64_NT-10.0-22631'), true)
  assert.equal(isGitForWindowsSystem('MINGW32_NT-6.2'), true)
  assert.equal(isGitForWindowsSystem('MSYS_NT-10.0-22631'), false)
  assert.equal(isGitForWindowsSystem('CYGWIN_NT-10.0-22631'), false)
  assert.equal(isGitForWindowsSystem('Linux'), false)
  assert.equal(isGitForWindowsSystem(''), false)
  assert.equal(isGitForWindowsSystem(null), false)
  assert.equal(isGitForWindowsSystem(undefined), false)
})

test('auto-detection refuses an MSYS bash and tells the user to set bashPath explicitly', async () => {
  // Only C:\tools\bash.exe exists and it identifies as MSYS2 (bash-compatible,
  // but not Git for Windows): auto-detection must not substitute it silently.
  const fs = stubFs([TOOLS_BASH])
  const calls = []
  const probe = async (path) => {
    calls.push(path)
    return { ok: true, system: 'MSYS_NT-10.0-22631', version: '5.2.37(1)-release', error: null }
  }
  const result = await resolveGitBash({
    platform: 'win32',
    env: winEnv(),
    fs,
    probe,
    registryQuery: async () => [],
    cache: false,
  })
  assert.equal(result.ok, false, 'an MSYS bash is not auto-selected')
  assert.equal(result.path, null)
  const rejected = result.candidates.find((candidate) => candidate.path === TOOLS_BASH)
  assert.ok(rejected !== undefined, 'the MSYS candidate is reported')
  assert.equal(rejected.ok, false)
  assert.match(rejected.reason, /not Git for Windows/)
  assert.match(rejected.reason, /bashPath explicitly/)
})

test('an explicitly configured MSYS bash is accepted with a warning', async () => {
  const fs = stubFs([TOOLS_BASH])
  const probe = async () => ({ ok: true, system: 'MSYS_NT-10.0-22631', version: '5.2.37(1)-release', error: null })
  const result = await resolveGitBash({
    configured: TOOLS_BASH,
    platform: 'win32',
    env: winEnv(),
    fs,
    probe,
    registryQuery: async () => [],
    cache: false,
  })
  assert.equal(result.ok, true)
  assert.equal(result.path, TOOLS_BASH)
  assert.equal(result.source, 'configured')
  assert.match(String(result.warning), /not Git for Windows/)
})
