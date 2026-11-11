/**
 * Git for Windows `bash.exe` detection and validation.
 *
 * Git Bash is the ONLY shell this plugin will ever select. When it cannot be
 * found the result is an explicit `ok: false` (fail-closed) — never a silent
 * fallback to `pwsh.exe`, `cmd.exe`, or the WSL/WindowsApps `bash.exe` Store
 * alias. Detection is a pure-ish function of `(platform, configured, env)` so
 * the Windows logic can be unit-tested on a POSIX host by injecting
 * `platform`, `env`, `fs`, and `probe`.
 *
 * Probe rule (`DESIGN.md` §4): `<bash> -c "uname -s"` must print a
 * `MINGW*`, `MSYS*`, or `CYGWIN*` system name. `execFile` with `shell: false`
 * is used, a 4 s timeout bounds a hanging binary, and the probe is only run on
 * candidates whose file already exists.
 *
 * @module dsh-gitbash-win/detect
 */
import { execFile } from 'node:child_process'
import * as nodeFs from 'node:fs'
import { homedir as defaultHomedir } from 'node:os'
import { win32 as winPath } from 'node:path'

/** The probe command: the MSYS/POSIX identity plus the bash version line. */
const PROBE_COMMAND = 'uname -s && bash --version'
/** Default probe budget; a Git Bash start is normally well under 1 s. */
export const DEFAULT_PROBE_TIMEOUT_MS = 4_000
/** `uname -s` shapes a bash-compatible MSYS/Cygwin host reports. */
const MINGW_SYSTEM_PATTERN = /^(MINGW|MSYS|CYGWIN)/i
/** Strict shape of a Git for Windows bash: only the MINGW system is Git's own. */
const GIT_FOR_WINDOWS_SYSTEM_PATTERN = /^MINGW/i
/** Registry install keys written by Git for Windows installers. */
const REGISTRY_KEYS = Object.freeze(['HKLM\\SOFTWARE\\GitForWindows', 'HKLM\\SOFTWARE\\WOW6432Node\\GitForWindows'])
/** Per-process memoization of identical detection inputs (`DESIGN.md` §4). */
const detectionCache = new Map()
/** Cap the memo table; realistic key counts are tiny. */
const DETECTION_CACHE_LIMIT = 32
/**
 * How long a NEGATIVE detection result (no usable Git Bash) stays memoized.
 * Successes are memoized indefinitely, but a failure must not survive a late
 * Git for Windows install: the settings card's "re-detect" and the next command
 * re-probe after about this long instead of requiring a DSH restart.
 */
export const NEGATIVE_RESULT_TTL_MS = 15_000
/** How many tried paths a fail-closed report lists before truncating. */
export const MAX_REPORTED_TRIED_PATHS = 8
/** Stable per-object ids so injected collaborators cannot collide in the memo key. */
const collaboratorIds = new WeakMap()
let nextCollaboratorId = 0

/** Identity token for an injected (or default) collaborator in the memo key. */
function collaboratorId(value) {
  if (value === null || value === undefined) return 'none'
  if (typeof value !== 'object' && typeof value !== 'function') return String(value)
  let id = collaboratorIds.get(value)
  if (id === undefined) {
    id = ++nextCollaboratorId
    collaboratorIds.set(value, id)
  }
  return String(id)
}

/** Normalize a path for case-insensitive de-duplication (Windows semantics). */
function pathKey(path) {
  return String(path).trim().replace(/\//g, '\\').toLowerCase().replace(/\\+$/, '')
}

/**
 * Expand a leading `~` and strip surrounding quotes from a config path.
 *
 * Accepts `~`, `~/...`, and `~\...`; anything else is returned trimmed but
 * otherwise untouched. A `%VAR%` form is deliberately NOT expanded — only a
 * home directory is portable enough to interpret here.
 * @param {string} value - raw configured path (e.g. `~/dsh-init.sh`).
 * @param {string} [homedir] - home directory to substitute; injectable for tests.
 * @returns {string} the expanded path, or `''` for an absent/non-string value.
 */
export function expandHomePath(value, homedir = defaultHomedir()) {
  if (typeof value !== 'string') return ''
  let text = value.trim()
  if (text.length >= 2) {
    const first = text[0]
    const last = text[text.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) text = text.slice(1, -1).trim()
  }
  if (text.length === 0) return ''
  if (typeof homedir !== 'string' || homedir.length === 0) return text
  const home = homedir.replace(/[\\/]+$/, '') || homedir
  if (text === '~') return home
  if (text.startsWith('~/') || text.startsWith('~\\')) return home + text.slice(1)
  return text
}

/**
 * Whether a path is a WSL or Windows-Store execution alias rather than a real
 * Git for Windows installation. Candidates under `%SystemRoot%\System32`
 * (the WSL bash alias) or anywhere under `WindowsApps` (the Store app
 * execution alias) are rejected outright — those are never Git Bash.
 * @param {string} value - candidate path.
 * @param {Record<string, string|undefined>} [env] - environment for `SystemRoot`/`windir`.
 * @returns {boolean} true when the path is a WSL/Store alias.
 */
export function isWslAlias(value, env = process.env) {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (trimmed.length === 0) return false
  const normalized = trimmed.replace(/\//g, '\\').toLowerCase()
  const segments = normalized.split('\\').filter((segment) => segment.length > 0)
  if (segments.includes('windowsapps')) return true
  const systemRoot = env?.SystemRoot ?? env?.windir
  if (typeof systemRoot === 'string' && systemRoot.trim().length > 0) {
    const root = systemRoot.trim().replace(/\//g, '\\').toLowerCase().replace(/\\+$/, '')
    if (root.length > 0 && (normalized.startsWith(`${root}\\system32\\`) || normalized.startsWith(`${root}\\syswow64\\`))) return true
  }
  for (let index = 0; index + 1 < segments.length; index += 1) {
    if (segments[index] === 'windows' && (segments[index + 1] === 'system32' || segments[index + 1] === 'syswow64')) return true
  }
  return false
}

/**
 * Whether a `uname -s` system name identifies Git for Windows itself (MINGW)
 * rather than another MSYS/Cygwin bash.
 *
 * Auto-detection only accepts MINGW. MSYS2/Cygwin bash are bash-compatible and
 * remain usable when the user names one explicitly in `bashPath`; letting an
 * auto-scan pick them would silently substitute a different toolchain (mount
 * points, path translation and installed tools differ from Git for Windows).
 * @param {string|null|undefined} system - the probed `uname -s` value.
 * @returns {boolean} true when the name is a Git for Windows MSYS.
 */
export function isGitForWindowsSystem(system) {
  return typeof system === 'string' && GIT_FOR_WINDOWS_SYSTEM_PATTERN.test(system)
}

/**
 * Parse and normalize the Windows `PATH` entries a Git installation can hide
 * in: quoted, empty, relative, and duplicate entries are dropped.
 * @param {string|undefined} pathValue - the `PATH` value.
 * @returns {string[]} absolute, trimmed, de-duplicated directories in order.
 */
function parsePathEntries(pathValue) {
  if (typeof pathValue !== 'string' || pathValue.length === 0) return []
  const seen = new Set()
  const entries = []
  for (const raw of pathValue.split(';')) {
    let entry = raw.trim()
    if (entry.length >= 2) {
      const first = entry[0]
      const last = entry[entry.length - 1]
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) entry = entry.slice(1, -1).trim()
    }
    entry = entry.replace(/[\\/]+$/, '')
    if (entry.length === 0 || !winPath.isAbsolute(entry)) continue
    const key = pathKey(entry)
    if (seen.has(key)) continue
    seen.add(key)
    entries.push(entry)
  }
  return entries
}

/**
 * Structural candidate list with the source each path was derived from.
 * Pure: no filesystem access — existence and probes are the resolver's job.
 * @param {{ platform?: string, env?: Record<string, string|undefined> }} [options]
 * @returns {{ path: string, source: 'known-dir'|'path'|'git-sibling' }[]}
 */
function candidateEntries({ platform = process.platform, env = process.env } = {}) {
  if (platform !== 'win32') return []
  const entries = []
  const push = (path, source) => {
    if (typeof path === 'string' && path.trim().length > 0) entries.push({ path, source })
  }

  // 1. Known Git for Windows install directories.
  const programFiles = env?.ProgramFiles ?? 'C:\\Program Files'
  const programFilesX86 = env?.['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
  const programW6432 = env?.ProgramW6432 ?? programFiles
  for (const base of [programFiles, programFilesX86, programW6432]) {
    if (typeof base !== 'string' || base.trim().length === 0) continue
    push(winPath.join(base, 'Git', 'bin', 'bash.exe'), 'known-dir')
  }
  const localAppData = env?.LOCALAPPDATA
  if (typeof localAppData === 'string' && localAppData.trim().length > 0) {
    push(winPath.join(localAppData, 'Programs', 'Git', 'bin', 'bash.exe'), 'known-dir')
  }

  // 2. PATH entries holding bash.exe directly (System32 / WindowsApps excluded).
  const pathEntries = parsePathEntries(env?.PATH)
  for (const dir of pathEntries) {
    if (isWslAlias(dir, env)) continue
    push(winPath.join(dir, 'bash.exe'), 'path')
  }

  // 3. The sibling of a PATH git.exe: `<git-dir>\..\bin\bash.exe`.
  for (const dir of pathEntries) {
    if (isWslAlias(dir, env)) continue
    const normalized = dir.replace(/[\\/]+$/, '')
    const parent = winPath.dirname(normalized)
    if (parent === normalized) continue
    push(winPath.join(parent, 'bin', 'bash.exe'), 'git-sibling')
  }
  return entries
}

/**
 * Candidate `bash.exe` paths in resolution priority order: known install
 * directories, `PATH` entries, then Git `bin` siblings of `PATH` `git.exe`s.
 * Pure (no filesystem access) and Windows-only — an empty array elsewhere.
 * @param {{ platform?: string, env?: Record<string, string|undefined> }} [options]
 * @returns {string[]} de-duplicated candidate paths, highest priority first.
 */
export function candidateBashPaths({ platform = process.platform, env = process.env } = {}) {
  const seen = new Set()
  const paths = []
  for (const entry of candidateEntries({ platform, env })) {
    const key = pathKey(entry.path)
    if (seen.has(key)) continue
    seen.add(key)
    paths.push(entry.path)
  }
  return paths
}

/**
 * Run one executable and collect its streams without ever involving a shell.
 * @param {string} file - executable path.
 * @param {string[]} args - argv elements.
 * @param {{ timeoutMs: number }} options - probe timeout.
 * @returns {Promise<{ error: Error|null, timedOut: boolean, stdout: string, stderr: string }>}
 */
function runFile(file, args, { timeoutMs }) {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    try {
      execFile(
        file,
        args,
        {
          timeout: timeoutMs,
          killSignal: 'SIGTERM',
          windowsHide: true,
          encoding: 'utf8',
          maxBuffer: 256 * 1024,
          // NEVER a shell: the command is handed to the target bash as one
          // argv element and no intermediate cmd.exe/POSIX shell parses it.
          shell: false,
        },
        (error, stdout, stderr) => {
          finish({
            error: error ?? null,
            timedOut: error?.killed === true || error?.code === 'ETIMEDOUT',
            stdout: typeof stdout === 'string' ? stdout : '',
            stderr: typeof stderr === 'string' ? stderr : '',
          })
        },
      )
    } catch (error) {
      finish({ error: error ?? new Error('spawn failed'), timedOut: false, stdout: '', stderr: '' })
    }
  })
}

/**
 * Validate one candidate bash: run `uname -s` and require an MSYS/MINGW/CYGWIN
 * system name. The same invocation also captures `bash --version` (when the
 * platform provides it after `&&`) so the report can name the bash version.
 * @param {string} path - candidate `bash.exe` path.
 * @param {{ timeoutMs?: number }} [options] - probe timeout (default 4 s).
 * @returns {Promise<{ ok: boolean, system: string|null, version: string|null, error: string|null }>}
 */
export async function probeBash(path, { timeoutMs = DEFAULT_PROBE_TIMEOUT_MS } = {}) {
  if (typeof path !== 'string' || path.trim().length === 0) {
    return { ok: false, system: null, version: null, error: 'empty bash path' }
  }
  const { error, timedOut, stdout, stderr } = await runFile(path.trim(), ['-c', PROBE_COMMAND], { timeoutMs })
  const lines = stdout.split(/\r?\n/).map((line) => line.trim())
  const firstLine = lines.find((line) => line.length > 0) ?? ''
  if (firstLine.length === 0) {
    const detail = timedOut
      ? `probe timed out after ${timeoutMs}ms`
      : error
        ? String(error.message ?? error)
        : stderr.trim().length > 0
          ? stderr.trim().split(/\r?\n/)[0]
          : 'no output from "uname -s"'
    return { ok: false, system: null, version: null, error: detail }
  }
  if (!MINGW_SYSTEM_PATTERN.test(firstLine)) {
    return {
      ok: false,
      system: firstLine,
      version: null,
      error: `not a Git for Windows (MINGW/MSYS/CYGWIN) bash: "uname -s" returned ${JSON.stringify(firstLine)}`,
    }
  }
  const version = /GNU bash,\s*version\s+(\S+)/i.exec(stdout)?.[1] ?? null
  return { ok: true, system: firstLine, version, error: null }
}

/**
 * Default registry lookup: read the `GitForWindows\InstallPath` value with
 * `reg.exe query` (read-only; failures are ignored, `DESIGN.md` §4 step 5).
 * @param {{ platform?: string, env?: Record<string, string|undefined>, timeoutMs?: number }} [options]
 * @returns {Promise<string[]>} candidate `bash.exe` paths found via the registry.
 */
async function defaultRegistryQuery({ platform = process.platform, env = process.env, timeoutMs = DEFAULT_PROBE_TIMEOUT_MS } = {}) {
  if (platform !== 'win32' || process.platform !== 'win32') return []
  const systemRoot = env?.SystemRoot ?? env?.windir ?? 'C:\\Windows'
  const regExe = winPath.join(systemRoot, 'System32', 'reg.exe')
  const found = []
  for (const key of REGISTRY_KEYS) {
    const { error, stdout } = await runFile(regExe, ['query', key, '/v', 'InstallPath'], { timeoutMs })
    if (error !== null) continue
    const installPath = /InstallPath\s+REG_\w+\s+(\S.*?)\s*$/im.exec(stdout)?.[1]?.trim()
    if (installPath === undefined || installPath.length === 0) continue
    found.push(winPath.join(installPath.replace(/[\\/]+$/, ''), 'bin', 'bash.exe'))
  }
  return found
}

/** Build the success result shape shared by every `ok: true` return. */
function successResult({ path, source, candidates, warning }) {
  const detail = warning === null || warning === undefined ? '' : ` — ${warning}`
  return {
    ok: true,
    path,
    source,
    candidates,
    report: `Git Bash: ${path} (source: ${source})${detail}`,
    warning: warning ?? null,
  }
}

/** Build the fail-closed result shape; `report` explains what was tried. */
function failureResult({ candidates, platform }) {
  if (platform !== 'win32') {
    const rejected = candidates.find((candidate) => candidate.ok === false && candidate.source === 'configured')
    return {
      ok: false,
      path: null,
      source: null,
      candidates,
      report:
        `Git Bash: not usable on "${platform}" — dsh-gitbash-win is a Windows-only plugin (Git for Windows required).` +
        (rejected === undefined ? '' : ` Configured bashPath rejected: ${rejected.path} (${rejected.reason}).`) +
        ' Set bashPath explicitly to test on a POSIX host.',
      warning: null,
    }
  }
  const rejected = candidates.find((candidate) => candidate.ok === false && candidate.source === 'configured')
  // A configured path that exists but cannot be run is an explicit user choice
  // we must not silently replace with another executable (DESIGN.md §4/§10).
  const notRunnable = rejected !== undefined && typeof rejected.reason === 'string' && (rejected.reason.startsWith('probe failed') || rejected.reason === 'configured path is not a file')
  const tried = candidates.map((candidate) => candidate.path)
  const shown = tried.slice(0, MAX_REPORTED_TRIED_PATHS)
  const hidden = tried.length - shown.length
  return {
    ok: false,
    path: null,
    source: null,
    candidates,
    report:
      (notRunnable
        ? 'Git Bash: the configured bashPath is not runnable (platform: win32). Fix the bashPath config or install Git for Windows at that path.'
        : 'Git Bash: not found (platform: win32). Install Git for Windows or set the bashPath config to bash.exe.') +
      (rejected === undefined ? '' : ` Configured bashPath rejected: ${rejected.path} (${rejected.reason}).`) +
      (tried.length === 0 ? '' : ` Tried: ${shown.join(', ')}${hidden > 0 ? ` … (+${hidden} more)` : ''}`),
    warning: null,
  }
}

/** Resolve a path's existence through the (injectable) fs implementation. */
function makeExists(fs) {
  const existsSync = typeof fs?.existsSync === 'function' ? fs.existsSync.bind(fs) : nodeFs.existsSync
  return (path) => {
    try {
      return existsSync(path) === true
    } catch {
      return false
    }
  }
}

/** Whether a path points at a file (or a symlink/alias Node can spawn). */
function isFileLike(fs, path) {
  const statSync = typeof fs?.statSync === 'function' ? fs.statSync.bind(fs) : nodeFs.statSync
  try {
    const stat = statSync(path)
    return stat.isFile() === true || stat.isSymbolicLink() === true
  } catch {
    // An injected fs without a usable statSync, or a stat race: existence was
    // already confirmed, so do not turn a stat failure into a rejection.
    return true
  }
}

/** Run a probe and normalize a thrown error into a failed probe result. */
async function safeProbe(probe, path, timeoutMs) {
  try {
    const result = await probe(path, { timeoutMs })
    if (result !== null && typeof result === 'object') return result
    return { ok: false, system: null, version: null, error: 'probe returned no result' }
  } catch (error) {
    return { ok: false, system: null, version: null, error: `probe failed: ${String(error?.message ?? error)}` }
  }
}

/**
 * The detection engine behind {@link resolveGitBash}; split out so the memo
 * wrapper stays trivial and the flow is readable.
 * @param {object} options - resolved detection options.
 * @returns {Promise<object>} the detection result (see {@link resolveGitBash}).
 */
async function detect({ configured, platform, env, probe, fs, homedir, probeTimeoutMs, registryQuery }) {
  const candidates = []
  const seen = new Set()
  const markSeen = (path) => {
    const key = pathKey(path)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }
  const exists = makeExists(fs)
  const configuredPath = expandHomePath(configured, homedir)

  if (configuredPath.length > 0) {
    if (isWslAlias(configuredPath, env)) {
      markSeen(configuredPath)
      candidates.push({
        path: configuredPath,
        ok: false,
        source: 'configured',
        reason: 'WSL/Store bash alias rejected (System32/WindowsApps); set bashPath to the Git for Windows bash.exe',
      })
    } else if (!exists(configuredPath)) {
      markSeen(configuredPath)
      candidates.push({ path: configuredPath, ok: false, source: 'configured', reason: 'configured path does not exist' })
    } else if (!isFileLike(fs, configuredPath)) {
      // Exists but is not a spawnable file: same no-substitution rule.
      markSeen(configuredPath)
      candidates.push({ path: configuredPath, ok: false, source: 'configured', reason: 'configured path is not a file' })
      if (platform === 'win32') return failureResult({ candidates, platform })
    } else if (platform !== 'win32') {
      // Explicit paths are accepted on POSIX for development/testing: the
      // Windows identity check only gates auto-detection (DESIGN.md §4).
      const probeResult = await safeProbe(probe, configuredPath, probeTimeoutMs)
      markSeen(configuredPath)
      candidates.push({
        path: configuredPath,
        ok: true,
        source: 'configured',
        reason: probeResult.ok === true ? null : `accepted on existence (Windows "uname -s" check skipped on ${platform})`,
      })
      return successResult({ path: configuredPath, source: 'configured', candidates, warning: null })
    } else {
      const probeResult = await safeProbe(probe, configuredPath, probeTimeoutMs)
      markSeen(configuredPath)
      if (probeResult.ok === true) {
        const warning = isGitForWindowsSystem(probeResult.system)
          ? null
          : `configured bashPath identifies as ${JSON.stringify(probeResult.system)}, not Git for Windows (MINGW); using the explicit choice`
        candidates.push({ path: configuredPath, ok: true, source: 'configured', reason: warning })
        return successResult({ path: configuredPath, source: 'configured', candidates, warning })
      }
      if (typeof probeResult.system === 'string' && probeResult.system.length > 0) {
        // The user explicitly configured this executable: keep it, but warn
        // that it does not identify itself as Git for Windows.
        const warning = `configured bashPath did not report MINGW/MSYS/CYGWIN via "uname -s" (got ${JSON.stringify(probeResult.system)}); using it anyway`
        candidates.push({ path: configuredPath, ok: true, source: 'configured', reason: warning })
        return successResult({ path: configuredPath, source: 'configured', candidates, warning })
      }
      // FAIL CLOSED: the configured executable exists but cannot be executed
      // (spawn error, timeout, no output). Never silently substitute another
      // bash for the user's explicit choice — report the failure instead.
      candidates.push({
        path: configuredPath,
        ok: false,
        source: 'configured',
        reason: `probe failed: ${probeResult.error ?? 'unknown error'}`,
      })
      return failureResult({ candidates, platform })
    }
  }

  if (platform !== 'win32') return failureResult({ candidates, platform })

  // Auto-detection: known dirs, PATH bash.exe, git.exe siblings.
  for (const entry of candidateEntries({ platform, env })) {
    if (!markSeen(entry.path)) continue
    if (isWslAlias(entry.path, env)) {
      candidates.push({ path: entry.path, ok: false, source: entry.source, reason: 'WSL/Store bash alias rejected' })
      continue
    }
    if (!exists(entry.path)) {
      candidates.push({ path: entry.path, ok: false, source: entry.source, reason: 'not found' })
      continue
    }
    const probeResult = await safeProbe(probe, entry.path, probeTimeoutMs)
    if (probeResult.ok === true && isGitForWindowsSystem(probeResult.system)) {
      candidates.push({ path: entry.path, ok: true, source: entry.source, reason: null })
      return successResult({ path: entry.path, source: entry.source, candidates, warning: null })
    }
    if (probeResult.ok === true) {
      // Bash-compatible but not Git for Windows: an explicit bashPath may
      // select it, auto-detection must not silently substitute it.
      candidates.push({
        path: entry.path,
        ok: false,
        source: entry.source,
        reason: `not Git for Windows (uname -s: ${JSON.stringify(probeResult.system)}); set bashPath explicitly to use an MSYS/Cygwin bash`,
      })
      continue
    }
    candidates.push({
      path: entry.path,
      ok: false,
      source: entry.source,
      reason: probeResult.error ?? 'probe failed',
    })
  }

  // Registry fallback (read-only, failures ignored).
  let registryPaths = []
  try {
    const queried = await registryQuery({ platform, env, timeoutMs: probeTimeoutMs })
    registryPaths = Array.isArray(queried) ? queried : []
  } catch {
    registryPaths = []
  }
  for (const raw of registryPaths) {
    const path = typeof raw === 'string' ? raw : raw?.path
    if (typeof path !== 'string' || path.trim().length === 0) continue
    if (!markSeen(path)) continue
    if (isWslAlias(path, env)) {
      candidates.push({ path, ok: false, source: 'registry', reason: 'WSL/Store bash alias rejected' })
      continue
    }
    if (!exists(path)) {
      candidates.push({ path, ok: false, source: 'registry', reason: 'not found' })
      continue
    }
    const probeResult = await safeProbe(probe, path, probeTimeoutMs)
    if (probeResult.ok === true && isGitForWindowsSystem(probeResult.system)) {
      candidates.push({ path, ok: true, source: 'registry', reason: null })
      return successResult({ path, source: 'registry', candidates, warning: null })
    }
    if (probeResult.ok === true) {
      candidates.push({
        path,
        ok: false,
        source: 'registry',
        reason: `not Git for Windows (uname -s: ${JSON.stringify(probeResult.system)}); set bashPath explicitly to use an MSYS/Cygwin bash`,
      })
      continue
    }
    candidates.push({ path, ok: false, source: 'registry', reason: probeResult.error ?? 'probe failed' })
  }

  return failureResult({ candidates, platform })
}

/**
 * Resolve the Git for Windows bash this process should use.
 *
 * Resolution order (`DESIGN.md` §4): explicit `configured` path (rejected only
 * when it is a WSL/Store alias), known install directories, `PATH` entries,
 * `git.exe` sibling directories, then the registry `InstallPath` value. Every
 * auto-detected candidate must exist and pass {@link probeBash}. Identical
 * `(platform, configured, PATH, env)` inputs are memoized per process; a
 * memoized success is revalidated with a cheap existence check before reuse (a
 * moved/uninstalled Git is detected instead of spawning a stale path), and
 * `cache: false` forces a fresh probe (the settings card's "re-detect").
 *
 * @param {object} [options]
 * @param {string} [options.configured] - explicit `bashPath` config value.
 * @param {string} [options.platform] - platform to resolve for; defaults to `process.platform`.
 * @param {Record<string, string|undefined>} [options.env] - environment to probe; defaults to `process.env`.
 * @param {(path: string, options: { timeoutMs: number }) => Promise<object>} [options.probe] - candidate validator; defaults to {@link probeBash}.
 * @param {boolean} [options.cache] - memoize identical inputs; defaults to true.
 * @param {number} [options.negativeTtlMs] - how long an `ok: false` result stays memoized; defaults to {@link NEGATIVE_RESULT_TTL_MS}.
 * @param {() => number} [options.now] - injectable clock for the negative-result TTL; defaults to `Date.now`.
 * @param {object} [options.fs] - injectable `node:fs`-shaped object (`existsSync`, `statSync`).
 * @param {string} [options.homedir] - home directory for `~` expansion.
 * @param {number} [options.probeTimeoutMs] - per-candidate probe budget (ms).
 * @param {(options: object) => Promise<string[]>} [options.registryQuery] - registry lookup override.
 * @returns {Promise<{
 *   ok: boolean,
 *   path: string|null,
 *   source: 'configured'|'known-dir'|'path'|'git-sibling'|'registry'|null,
 *   candidates: { path: string, ok: boolean, source: string, reason?: string|null }[],
 *   report: string,
 *   warning?: string|null,
 * }>} the resolved bash and the evidence used to pick (or reject) it.
 */
export async function resolveGitBash({
  configured = '',
  platform = process.platform,
  env = process.env,
  probe = probeBash,
  cache = true,
  negativeTtlMs = NEGATIVE_RESULT_TTL_MS,
  now = Date.now,
  fs = nodeFs,
  homedir = defaultHomedir(),
  probeTimeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
  registryQuery = defaultRegistryQuery,
} = {}) {
  const key = [
    platform,
    expandHomePath(configured, homedir),
    homedir,
    collaboratorId(probe),
    collaboratorId(registryQuery),
    collaboratorId(fs),
    probeTimeoutMs,
    ['PATH', 'SystemRoot', 'windir', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'LOCALAPPDATA'].map((name) => env?.[name] ?? '').join('\u0001'),
  ].join('\u0000')

  const clock = typeof now === 'function' ? now : Date.now
  const ttl = Number.isFinite(negativeTtlMs) && negativeTtlMs >= 0 ? negativeTtlMs : NEGATIVE_RESULT_TTL_MS

  if (cache === true) {
    const cached = detectionCache.get(key)
    if (cached !== undefined) {
      // Successes stay memoized until clearDetectionCache()/their path
      // disappears; only a negative result expires, so a late Git for Windows
      // install becomes visible.
      if (cached.negative === true && clock() - cached.createdAt >= ttl) {
        detectionCache.delete(key)
      } else {
        const memoized = await cached.promise
        if (
          cached.negative === false &&
          memoized !== null &&
          typeof memoized === 'object' &&
          memoized.ok === true &&
          typeof memoized.path === 'string' &&
          memoized.path.length > 0 &&
          !makeExists(fs)(memoized.path)
        ) {
          // The resolved executable disappeared (moved/uninstalled): drop the
          // memo and let the normal resolution run again below.
          detectionCache.delete(key)
        } else {
          return memoized
        }
      }
    }
  }

  const pending = detect({ configured, platform, env, probe, fs, homedir, probeTimeoutMs, registryQuery })
  if (cache === true) {
    if (detectionCache.size >= DETECTION_CACHE_LIMIT) {
      const oldest = detectionCache.keys().next().value
      if (oldest !== undefined) detectionCache.delete(oldest)
    }
    const entry = { promise: pending, createdAt: clock(), negative: false }
    detectionCache.set(key, entry)
    pending.then(
      (result) => {
        entry.negative = result?.ok === false
      },
      () => {
        // Never memoize an unexpected failure (a rejection is not an
        // ordinary ok:false detection result).
        if (detectionCache.get(key) === entry) detectionCache.delete(key)
      },
    )
  }
  return pending
}

/**
 * Clear the detection memo. Useful for a "re-detect" status endpoint; the
 * executor itself intentionally keeps the memo so repeated commands do not
 * re-probe the filesystem.
 */
export function clearDetectionCache() {
  detectionCache.clear()
}
