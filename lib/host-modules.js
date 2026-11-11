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
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'

/** Stable error code for an unresolvable host package. */
export const HOST_MODULE_NOT_FOUND = 'DSH_HOST_MODULE_NOT_FOUND'
/** Stable error code for a host package resolved from a different DSH build. */
export const HOST_MODULE_VERSION_MISMATCH = 'DSH_HOST_MODULE_VERSION_MISMATCH'
/** Escape hatch for operators who deliberately mix host package copies. */
export const ALLOW_VERSION_MISMATCH_ENV = 'DSH_GITBASH_ALLOW_HOST_VERSION_MISMATCH'

/** `specifier -> Promise<module namespace>` for {@link hostImport}. */
const importCache = new Map()
/** `specifier -> absolute resolved path` for {@link hostResolve}. */
const resolveCache = new Map()
/** Lazily built `require` functions, one per plausible DSH anchor file. */
let requireChain
/** `specifier -> { packageName, version, packagePath }` for the version guard. */
const packageInfoCache = new Map()
/** The running DSH CLI package info, resolved once. */
let runningDshInfoCache

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

  // The npm global prefix used on this host and common on Linux boxes.
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
  // PATH-derived global prefixes. npm installs the Windows CLI shims in the
  // prefix root (`<prefix>\\dsh.cmd` -> `<prefix>/node_modules/...`) and the
  // POSIX shims in `<prefix>/bin` (`<prefix>/lib/node_modules/...`). This is
  // how a `node --test` invocation (no `dsh` parent process, no argv[1] anchor)
  // still finds the host packages on a GitHub Windows runner.
  const pathValue = process.env.PATH ?? process.env.Path ?? ''
  for (const rawEntry of pathValue.split(process.platform === 'win32' ? ';' : ':')) {
    const entry = rawEntry.trim().replace(/^"|"$/g, '').replace(/[\\/]+$/, '')
    if (entry.length === 0) continue
    dshBin(entry, 'node_modules')
    dshBin(entry, '..', 'lib', 'node_modules')
    dshBin(entry, '..', 'node_modules')
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
    verifyHostPackageVersion(specifier)
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
 * The npm package name a subpath specifier belongs to.
 * `@deepseek-ai/dsh-x/y` -> `@deepseek-ai/dsh-x`, `some-pkg/sub` -> `some-pkg`.
 * @param {string} specifier - package or package subpath specifier.
 * @returns {string} the owning package name.
 */
export function packageNameOf(specifier) {
  const parts = String(specifier).split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

/**
 * Locate the `package.json` that owns a resolved module file by walking up.
 * @param {string} resolvedPath - absolute module entry path.
 * @returns {{packageName: string, version: string, packagePath: string}|null} owning package facts.
 */
function packageInfoAt(resolvedPath) {
  let directory = dirname(resolvedPath)
  for (let depth = 0; depth < 10; depth += 1) {
    const file = join(directory, 'package.json')
    if (existsSync(file)) {
      try {
        const manifest = JSON.parse(readFileSync(file, 'utf8'))
        if (typeof manifest.name === 'string' && typeof manifest.version === 'string') {
          return { packageName: manifest.name, version: manifest.version, packagePath: file }
        }
      } catch {
        /* a malformed package.json is not this package's owner */
      }
    }
    const parent = dirname(directory)
    if (parent === directory) return null
    directory = parent
  }
  return null
}

/**
 * The owning package's name/version for a host specifier, memoized.
 * @param {string} specifier - package or package subpath specifier.
 * @returns {{packageName: string, version: string, packagePath: string}|null} package facts, or null.
 */
export function hostPackageInfo(specifier) {
  const cached = packageInfoCache.get(specifier)
  if (cached !== undefined) return cached
  let info = null
  try {
    info = packageInfoAt(hostResolve(specifier))
  } catch {
    info = null
  }
  packageInfoCache.set(specifier, info)
  return info
}

/**
 * The version of the running DSH CLI package (`@deepseek-ai/dsh`), memoized.
 * @returns {string|null} the version, or null when it cannot be determined.
 */
export function runningDshVersion() {
  if (runningDshInfoCache !== undefined) return runningDshInfoCache === null ? null : runningDshInfoCache.version
  // The CLI package has no root export (only `bin`), so resolve its manifest
  // explicitly: `@deepseek-ai/dsh/package.json` is exported by the package.
  try {
    const manifestPath = hostResolve('@deepseek-ai/dsh/package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    runningDshInfoCache = {
      packageName: typeof manifest.name === 'string' ? manifest.name : '@deepseek-ai/dsh',
      version: typeof manifest.version === 'string' ? manifest.version : null,
      packagePath: manifestPath,
    }
  } catch {
    runningDshInfoCache = null
  }
  return runningDshInfoCache === null || runningDshInfoCache.version === null ? null : runningDshInfoCache.version
}

/**
 * Check one resolved `@deepseek-ai/dsh-*` package against the running DSH CLI
 * version. A different copy (the plugin's own node_modules, a symlinked peer,
 * a stale global install) can hand back classes from another release while all
 * local tests still pass — class identity and seam contracts then break at
 * runtime in hard-to-attribute ways, so a mismatch is a hard load error unless
 * the operator sets {@link ALLOW_VERSION_MISMATCH_ENV}=1.
 *
 * Pure: tests drive every combination without a second installation.
 * @param {{specifier: string, packageName: string, version: string, expectedVersion: string|null, allowMismatch?: boolean}} input - resolved facts.
 * @returns {boolean} true when the package matches (or no expected version is known).
 * @throws {Error} with code {@link HOST_MODULE_VERSION_MISMATCH} on a mismatch.
 */
export function assertCompatibleHostPackageVersion({ specifier, packageName, version, expectedVersion, allowMismatch = false }) {
  const expectedName = packageNameOf(specifier)
  if (expectedVersion === null || expectedVersion === undefined) return true
  if (packageName === expectedName && version === expectedVersion) return true
  if (allowMismatch === true) return false
  const error = new Error(
    `dsh-gitbash-win: ホストパッケージ "${specifier}" が稼働中の DSH と異なるビルドから解決されました ` +
      `(${packageName}@${version}、期待: ${expectedName}@${expectedVersion})。` +
      'プラグインの node_modules やシンボリックリンクされた peer 依存が原因の可能性があります。' +
      '同じ DSH インストールから解決されるよう整理するか、意図的な混在の場合は ' +
      `${ALLOW_VERSION_MISMATCH_ENV}=1 を設定してください（非推奨・クラス同一性が壊れます）。`,
  )
  error.code = HOST_MODULE_VERSION_MISMATCH
  error.specifier = specifier
  error.found = { packageName, version }
  error.expected = { packageName: expectedName, version: expectedVersion }
  throw error
}

/**
 * Guard one import: verify that a `@deepseek-ai/dsh-*` package shares the
 * running DSH version. Non-DSH packages (cordis, schemastery) are skipped.
 * @param {string} specifier - the imported specifier.
 */
function verifyHostPackageVersion(specifier) {
  if (!specifier.startsWith('@deepseek-ai/dsh-')) return
  const found = hostPackageInfo(specifier)
  if (found === null) return
  assertCompatibleHostPackageVersion({
    specifier,
    packageName: found.packageName,
    version: found.version,
    expectedVersion: runningDshVersion(),
    allowMismatch: process.env[ALLOW_VERSION_MISMATCH_ENV] === '1',
  })
}

/**
 * Drop the resolution and import caches. Used by tests and by diagnostics
 * that must observe a changed installation; the plugin itself never needs it.
 */
export function clearHostModuleCache() {
  importCache.clear()
  resolveCache.clear()
  packageInfoCache.clear()
  runningDshInfoCache = undefined
  requireChain = undefined
}
