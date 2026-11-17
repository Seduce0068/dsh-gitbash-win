/**
 * Keep the declared DSH compatibility list and the CI version matrix in sync.
 *
 * `dsh.compatibility.dshReleases` is declarative metadata (it does not gate
 * runtime loading), so a release can be silently added there without ever
 * being exercised. These tests make the CI matrix the enforcement point.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const declared = Object.entries(manifest.dsh.compatibility.dshReleases)
  .filter(([, verdict]) => verdict === 'compatible')
  .map(([version]) => version)

test('at least the three rc releases are declared compatible', () => {
  assert.deepEqual(
    [...declared].sort(),
    ['0.2.2-rc.1', '0.2.2-rc.2', '0.2.2-rc.3'],
    'rc.1 / rc.2 / rc.3 must all be declared and exercised',
  )
})

test('every declared compatible release is present in both CI matrices', () => {
  for (const workflow of ['linux-tests.yml', 'windows-smoke.yml']) {
    const text = readFileSync(join(root, '.github', 'workflows', workflow), 'utf8')
    assert.match(text, /fail-fast:\s*false/, `${workflow} must run all matrix legs to completion`)
    assert.match(text, /matrix:\s*\n\s*dsh-version:/, `${workflow} must have a dsh-version matrix`)
    for (const version of declared) {
      assert.ok(
        text.includes(`'${version}'`),
        `${workflow} must test declared-compatible DSH ${version}`,
      )
    }
  }
})
