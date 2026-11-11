/**
 * Tests for `lib/host-modules.js` — host DSH package resolution.
 *
 * These assertions run against the live DSH 0.2.2-rc.1 installation on this
 * host: the plugin cannot work unless the createRequire chain actually reaches
 * `<dsh>/node_modules/@deepseek-ai/*`, so the proof is "resolve a real file,
 * import a real module, keep class identity".
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import {
  ALLOW_VERSION_MISMATCH_ENV,
  HOST_MODULE_NOT_FOUND,
  HOST_MODULE_VERSION_MISMATCH,
  assertCompatibleHostPackageVersion,
  clearHostModuleCache,
  hostImport,
  hostPackageInfo,
  hostResolve,
  packageNameOf,
  runningDshVersion,
} from '../lib/host-modules.js'

/** Host packages this plugin depends on at runtime, plus one it only knows about. */
const HOST_PACKAGES = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/schemastery',
  '@deepseek-ai/dsh-timeout',
  '@deepseek-ai/dsh-sandbox',
  '@deepseek-ai/dsh-subprocess-local',
  '@deepseek-ai/dsh-bash-local',
  '@deepseek-ai/dsh-bash-sandbox',
  '@deepseek-ai/dsh-tool-bash',
]

test('hostResolve returns an absolute existing file for every host package it needs', () => {
  for (const specifier of HOST_PACKAGES) {
    const resolved = hostResolve(specifier)
    assert.equal(typeof resolved, 'string', `${specifier} must resolve to a string`)
    assert.ok(isAbsolute(resolved), `${specifier} must resolve to an absolute path, got ${resolved}`)
    assert.ok(existsSync(resolved), `${specifier} must resolve to an existing file, got ${resolved}`)
    assert.ok(statSync(resolved).isFile(), `${specifier} must resolve to a file, got ${resolved}`)
  }
})

test('hostResolve memoizes each specifier to the same absolute path', () => {
  const first = hostResolve('@deepseek-ai/dsh-bash-sandbox')
  const second = hostResolve('@deepseek-ai/dsh-bash-sandbox')
  assert.equal(first, second)
  // The resolution must come from the installed DSH tree, not a lookalike.
  assert.match(first.replace(/\\/g, '/'), /@deepseek-ai\/dsh-bash-sandbox\/lib\/index\.js$/)
})

test('hostResolve throws an explicit host error for an unknown package', () => {
  const specifier = '@deepseek-ai/dsh-this-package-does-not-exist'
  assert.throws(
    () => hostResolve(specifier),
    (error) => {
      assert.equal(error.code, HOST_MODULE_NOT_FOUND)
      assert.equal(error.specifier, specifier)
      assert.ok(error.message.includes(specifier), 'message must name the missing package')
      assert.ok(error.message.includes('DSH'), 'message must say DSH itself could not be reached')
      assert.ok(Array.isArray(error.tried) && error.tried.length > 0, 'the attempted anchors must be reported')
      return true
    },
  )
})

test('hostResolve rejects empty and non-string specifiers', () => {
  for (const specifier of ['', '   ', undefined, null, 42]) {
    assert.throws(() => hostResolve(specifier), (error) => error.code === HOST_MODULE_NOT_FOUND)
  }
})

test('hostImport returns the official sandbox executor class', async () => {
  const namespace = await hostImport('@deepseek-ai/dsh-bash-sandbox')
  assert.equal(typeof namespace.SandboxBashExecutor, 'function')
  assert.equal(namespace.default, namespace.SandboxBashExecutor)
})

test('hostImport caches the module instance per specifier', async () => {
  const first = await hostImport('@deepseek-ai/dsh-bash-sandbox')
  const second = await hostImport('@deepseek-ai/dsh-bash-sandbox')
  assert.equal(first, second, 'repeated imports must hand back one module instance (class identity matters)')
})

test('hostImport loads cordis and schemastery through the same chain', async () => {
  const cordis = await hostImport('@deepseek-ai/cordis')
  assert.equal(typeof cordis.Context, 'function')
  const context = new cordis.Context()
  assert.equal(cordis.Context.is(context), true)

  const schemastery = await hostImport('@deepseek-ai/schemastery')
  assert.equal(typeof schemastery.default, 'function')
  const schema = schemastery.default.object({ value: schemastery.default.number().default(7) })
  assert.equal(schema({}).value, 7)
})

test('hostImport rejects an unknown host package with the explicit host error', async () => {
  await assert.rejects(hostImport('@deepseek-ai/dsh-this-package-does-not-exist'), (error) => {
    assert.equal(error.code, HOST_MODULE_NOT_FOUND)
    return true
  })
})

test('clearHostModuleCache re-resolves the same physical module without breaking imports', async () => {
  const before = hostResolve('@deepseek-ai/dsh-bash-sandbox')
  const loadedBefore = await hostImport('@deepseek-ai/dsh-bash-sandbox')
  clearHostModuleCache()
  const after = hostResolve('@deepseek-ai/dsh-bash-sandbox')
  const loadedAfter = await hostImport('@deepseek-ai/dsh-bash-sandbox')
  assert.equal(after, before)
  assert.equal(loadedAfter, loadedBefore, 'Node still caches the module by URL, so identity is preserved')
})

test('packageNameOf maps subpath specifiers to their owning package', () => {
  assert.equal(packageNameOf('@deepseek-ai/dsh-tool-bash'), '@deepseek-ai/dsh-tool-bash')
  assert.equal(packageNameOf('@deepseek-ai/dsh-tool-bash/lib/index.js'), '@deepseek-ai/dsh-tool-bash')
  assert.equal(packageNameOf('plain-package/sub/path'), 'plain-package')
})

test('the host version guard accepts the running build and rejects a foreign copy', () => {
  const expectedVersion = runningDshVersion()
  assert.ok(typeof expectedVersion === 'string' && expectedVersion.length > 0, 'the running DSH version is discoverable')
  assert.equal(
    assertCompatibleHostPackageVersion({
      specifier: '@deepseek-ai/dsh-tool-bash',
      packageName: '@deepseek-ai/dsh-tool-bash',
      version: expectedVersion,
      expectedVersion,
    }),
    true,
  )
  assert.throws(
    () =>
      assertCompatibleHostPackageVersion({
        specifier: '@deepseek-ai/dsh-tool-bash',
        packageName: '@deepseek-ai/dsh-tool-bash',
        version: '9.9.9-foreign',
        expectedVersion,
      }),
    (error) => {
      assert.equal(error.code, HOST_MODULE_VERSION_MISMATCH)
      assert.deepEqual(error.expected, { packageName: '@deepseek-ai/dsh-tool-bash', version: expectedVersion })
      assert.match(String(error.message), /異なるビルド/)
      assert.ok(String(error.message).includes(ALLOW_VERSION_MISMATCH_ENV))
      return true
    },
  )
  // A package that resolves to a *different* package name is also a mismatch.
  assert.throws(
    () =>
      assertCompatibleHostPackageVersion({
        specifier: '@deepseek-ai/dsh-tool-bash',
        packageName: '@deepseek-ai/dsh-tool-pwsh',
        version: expectedVersion,
        expectedVersion,
      }),
    (error) => error.code === HOST_MODULE_VERSION_MISMATCH,
  )
  // Unknown expected version and explicit override are non-fatal.
  assert.equal(assertCompatibleHostPackageVersion({ specifier: '@deepseek-ai/dsh-x', packageName: '@deepseek-ai/dsh-x', version: '1.0.0', expectedVersion: null }), true)
  assert.equal(
    assertCompatibleHostPackageVersion({
      specifier: '@deepseek-ai/dsh-x',
      packageName: '@deepseek-ai/dsh-x',
      version: '1.0.0',
      expectedVersion: '2.0.0',
      allowMismatch: true,
    }),
    false,
  )
})

test('hostImport passes the version guard against the real installation', async () => {
  const expectedVersion = runningDshVersion()
  for (const specifier of ['@deepseek-ai/dsh-tool-bash', '@deepseek-ai/dsh-bash-sandbox', '@deepseek-ai/dsh-bash-local', '@deepseek-ai/dsh-sandbox']) {
    await hostImport(specifier)
    const info = hostPackageInfo(specifier)
    assert.ok(info !== null, `${specifier} package info is discoverable`)
    assert.equal(info.version, expectedVersion, `${specifier} resolves from the running DSH build`)
    assert.equal(info.packageName, specifier)
  }
  // cordis/schemastery are not DSH-release packages and must not be version-gated.
  const cordis = hostPackageInfo('@deepseek-ai/cordis')
  assert.ok(cordis !== null)
})
