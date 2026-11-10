/**
 * Host-module resolution for the out-of-tree `dsh-gitbash-win` plugin.
 *
 * An out-of-tree DSH plugin cannot bare-import `@deepseek-ai/dsh-*`: those
 * packages live in the DSH installation's own `node_modules`, not in the
 * profile that loads the plugin. The supported bridge is a `createRequire`
 * chain anchored at the DSH CLI entry point (`<dsh>/lib/bin.js`), from which
 * every peer host package resolves (`dsh-bash-sandbox`, `dsh-sandbox`,
 * `dsh-subprocess-local`, `cordis`, `schemastery`, ...).
 *
 * Everything here is silent on success — no `console.warn` and no caching of
 * failures beyond the resolution attempt itself: a failed resolution throws an
 * explicit error naming the missing package and the install locations tried
 * (no silent fallback to a different copy of DSH).
 *
 * @module dsh-gitbash-win/host-modules
 */
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'

/** Stable error code for an unresolvable host package. */
export const HOST_MODULE_NOT_FOUND = 'DSH_HOST_MODULE_NOT_FOUND'

/** `specifier -> Promise<module namespace>` for {@link hostImport}. */
const importCache = new Map()
/** `specifier -> absolute resolved path` for {@link hostResolve}. */
const resolveCache = new Map()
/** Lazily built `require` functions, one per plausible DSH anchor file. */
let requireChain

/** Normalize a Windows path spelling for case-insensitive comparison. */
function pathKey(path) {
  return String(path).replace(/\//g, '\\').toLowerCase().replace(/\\+$/, '')
}

/**
 * Absolute paths of `dsh/lib/bin.js` for the installs this host could be
 * running from: the npm global prefix used on many Linux boxes
 * (`~/.npm-global`), the prefix derived from the running `node` executable,
 * the common system prefixes, and the Windows npm global locations.
 * @returns {string[]} candidate `dsh/lib/bin.js` paths, deduplicated, in order.
 */
function dshBinCandidates() {
  const candidates = []
  const add = (...segments) => {
    try {
      candidates.push(join(...segments))
    } catch {
      /* an unusable environment fragment is simply not a candidate */
    }
  }
  const dshBin = (...prefix) => add(...prefix, '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  const home = homedir()

  // The npm global prefix used on this host and common on Kubuntu boxes.
  dshBin(home, '.npm-global', 'lib', 'node_modules')
  // Node installed as /usr/bin/node -> /usr/lib/node_modules;
  // /usr/local/bin/node -> /usr/local/lib/node_modules.
  const execDir = dirname(process.execPath)
  dshBin(execDir, '..', 'lib', 'node_modules')
  // Windows installs keep global packages next to node.exe.
  dshBin(execDir, 'node_modules')
  // Common POSIX global prefixes.
  for (const prefix of ['/usr/local/lib/node_modules', '/usr/lib/node_modules', '/opt/homebrew/lib/node_modules']) dshBin(prefix)
  // Windows npm global prefix (%APPDATA%\npm\node_modules) and Program Files.
  if (process.platform === 'win32') {
    for (const envVar of ['APPDATA', 'LOCALAPPDATA']) {
      const base = process.env[envVar]
      if (typeof base === 'string' && base.length > 0) dshBin(base, 'npm', 'node_modules')
    }
    const programFiles = process.env.ProgramFiles
    if (typeof programFiles === 'string' && programFiles.length > 0) dshBin(programFiles, 'nodejs', 'node_modules')
  }
  // An explicitly configured npm prefix wins nothing here — it is just another
  // anchor to try; both npm layouts are covered.
  for (const envVar of ['npm_config_prefix', 'NPM_CONFIG_PREFIX']) {
    const prefix = process.env[envVar]
    if (typeof prefix !== 'string' || prefix.length === 0) continue
    dshBin(prefix, 'lib', 'node_modules')
    dshBin(prefix, 'node_modules')
  }

  const seen = new Set()
  const unique = []
  for (const candidate of candidates) {
    const key = pathKey(candidate)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(candidate)
  }
  return unique
}

/**
 * Build (once) the ordered `require` functions used for resolution:
 * the plugin's own location (development install / symlinked peer deps), the
 * running DSH CLI entry point (`process.argv[1]` from a `dsh` launch), the
 * current working directory (test/profile checkouts), and the known global
 * install anchors.
 * @returns {{ requires: import('node:module').NodeRequire[], tried: string[] }}
 */
function buildRequireChain() {
  if (requireChain !== undefined) return requireChain
  const requires = []
  const tried = []
  const addRequire = (anchor, label) => {
    try {
      requires.push(createRequire(anchor))
      tried.push(label)
    } catch {
      /* not a usable anchor on this host */
    }
  }

  addRequire(import.meta.url, 'plugin module')
  const cliEntry = process.argv[1]
  if (typeof cliEntry === 'string' && /^(?:[a-zA-Z]:[\\/]|[\\/])/.test(cliEntry)) addRequire(cliEntry, `argv[1] (${cliEntry})`)
  const cwdPackage = join(process.cwd(), 'package.json')
  if (existsSync(cwdPackage)) addRequire(cwdPackage, 'cwd package')
  for (const binPath of dshBinCandidates()) addRequire(binPath, binPath)

  requireChain = { requires, tried }
  return requireChain
}

/**
 * Resolve a host package specifier to the absolute file path Node would load.
 * @param {string} specifier - e.g. `@deepseek-ai/dsh-bash-sandbox`.
 * @returns {string} absolute path of the resolved module entry.
 * @throws {Error} with code {@link HOST_MODULE_NOT_FOUND} when no anchor can
 *   resolve the specifier; the message names the package and the anchors tried.
 */
export function hostResolve(specifier) {
  if (typeof specifier !== 'string' || specifier.trim().length === 0) {
    const error = new Error(`dsh-gitbash-win: host module specifier must be a non-empty string, got ${JSON.stringify(specifier)}`)
    error.code = HOST_MODULE_NOT_FOUND
    throw error
  }
  const cached = resolveCache.get(specifier)
  if (cached !== undefined) return cached

  const { requires, tried } = buildRequireChain()
  const failures = []
  for (const requireFn of requires) {
    try {
      const resolved = requireFn.resolve(specifier)
      resolveCache.set(specifier, resolved)
      return resolved
    } catch (error) {
      failures.push(error)
    }
  }
  const error = new Error(
    `dsh-gitbash-win: DSH 本体のパッケージ "${specifier}" を解決できません。` +
      'このプラグインは DeepSeek Harness (0.2.2-rc.1) のプロセスから実行する必要があります。' +
      ` (tried ${tried.length} DSH anchors: ${tried.join(', ') || 'none'})` +
      (failures.length > 0 ? ` Last resolution error: ${String(failures[failures.length - 1])}` : ''),
  )
  error.code = HOST_MODULE_NOT_FOUND
  error.specifier = specifier
  error.tried = tried
  throw error
}

/**
 * Import a host package through {@link hostResolve}.
 *
 * The namespace is cached per specifier so repeated imports hand back one
 * module instance — critical for class identity (the executor must extend the
 * exact `SandboxBashExecutor` class the host sandbox machinery expects).
 * @param {string} specifier - e.g. `@deepseek-ai/dsh-bash-sandbox`.
 * @returns {Promise<Record<string, unknown>>} the ESM namespace.
 * @throws {Error} with code {@link HOST_MODULE_NOT_FOUND} when unresolvable.
 */
export async function hostImport(specifier) {
  const cached = importCache.get(specifier)
  if (cached !== undefined) return cached
  const loading = (async () => {
    const resolved = hostResolve(specifier)
    // `require.resolve` yields a file path; a plain dynamic import of a
    // `file:` URL keeps Windows and POSIX paths unambiguous, and the resolved
    // package root's ESM conditional export is honored by Node from there.
    return import(pathToFileURL(resolved).href)
  })()
  importCache.set(specifier, loading)
  try {
    return await loading
  } catch (error) {
    // A failed load is not memoized; the next call retries resolution.
    importCache.delete(specifier)
    throw error
  }
}

/**
 * Drop the resolution and import caches. Used by tests and by diagnostics
 * that must observe a changed installation; the plugin itself never needs it.
 */
export function clearHostModuleCache() {
  importCache.clear()
  resolveCache.clear()
  requireChain = undefined
}
