/**
 * Patch-layer contract tests for dsh-gitbash-win.
 *
 * `cordis.patch.yml` is the ONLY way this package enters a DSH composition, so
 * the tests check it as data (not as text): a top-level loader patch list with
 * one additive `insert` entry. The DSH loader parses patch files with js-yaml,
 * but neither js-yaml nor the `yaml` package is resolvable from this project
 * directory and adding a dependency just for a test is not acceptable — so this
 * file carries a tiny independent parser for the YAML subset the patch uses
 * (block sequences/mappings, quoted and plain scalars, and the `!!js`-tagged
 * JavaScript expression) and asserts the resulting structure.
 *
 * The `!!js` expression is then evaluated exactly as the loader evaluates it
 * (`eval` semantics with the host globals) against both a Windows and a
 * non-Windows platform, so "disabled on non-win32" is proven behaviorally
 * rather than by string match.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { Config } from '../lib/executor.js'
import { hostResolve } from '../lib/host-modules.js'

const PATCH_PATH = fileURLToPath(new URL('../cordis.patch.yml', import.meta.url))
const PATCH_TEXT = readFileSync(PATCH_PATH, 'utf8')

/** The `!!js` marker shape the DSH entry-list YAML dialect produces. */
const isJsExpr = (value) => value !== null && typeof value === 'object' && '__jsExpr' in value

/**
 * Parse the YAML subset used by cordis.patch.yml.
 *
 * Supported: full-line `#` comments, block sequences (`- `), block mappings
 * (`key: value`, `key:` + nested block), single/double quoted strings, plain
 * strings, integers, `true`/`false`/`null`, and `!!js <expression>` scalars
 * (returned as `{ __jsExpr }`, the loader's inert marker).
 * @param {string} text - YAML source.
 * @returns {unknown} the parsed document.
 */
function parseYamlSubset(text) {
  const tokens = []
  const sourceLines = text.split(/\r?\n/)
  for (const [index, rawLine] of sourceLines.entries()) {
    const content = rawLine.trim()
    if (content === '' || content.startsWith('#') || content === '---') continue
    tokens.push({ indent: rawLine.length - rawLine.trimStart().length, content, line: index + 1 })
  }
  let pos = 0

  /** Throw with the offending source line for anything this subset can't parse. */
  const fail = (token, detail) => {
    throw new Error(`patch YAML line ${token.line}: ${detail}: ${JSON.stringify(token.content)}`)
  }

  /** Parse the scalar after `key:`/`- `. */
  function parseScalar(value) {
    if (value.startsWith('!!js')) {
      const expression = value.slice(4).trim()
      if (expression === '') throw new Error('patch YAML: empty !!js expression')
      return { __jsExpr: expression }
    }
    const quoted = value.match(/^(?:'([^']*)'|"([^"]*)")$/)
    if (quoted) return quoted[1] ?? quoted[2]
    if (value === 'true') return true
    if (value === 'false') return false
    if (value === 'null' || value === '~') return null
    if (value === '[]') return []
    if (value === '{}') return {}
    if (/^-?\d+$/.test(value)) return Number.parseInt(value, 10)
    if (/^-?\d+\.\d+$/.test(value)) return Number.parseFloat(value)
    return value
  }

  /** Split `key: value` / `key:` and assign it (recursing into a nested block). */
  function assignEntry(map, content, indent, token) {
    const match = content.match(/^([^:]+?)\s*:(?:\s+(.*))?$/)
    if (!match) fail(token, 'expected a mapping entry')
    const key = match[1].trim()
    const rest = match[2]
    if (rest !== undefined && rest !== '') {
      map[key] = parseScalar(rest)
      return
    }
    const next = tokens[pos]
    map[key] = next !== undefined && next.indent > indent ? parseNode(next.indent) : null
  }

  /** Consume consecutive mapping entries at one indentation level. */
  function consumeMapping(map, indent) {
    while (pos < tokens.length) {
      const token = tokens[pos]
      if (token.indent !== indent || /^-(?:\s|$)/.test(token.content)) break
      pos += 1
      assignEntry(map, token.content, indent, token)
    }
    return map
  }

  /** Parse a block sequence at one indentation level. */
  function parseSequence(indent) {
    const list = []
    while (pos < tokens.length) {
      const token = tokens[pos]
      if (token.indent !== indent || !/^-(?:\s|$)/.test(token.content)) break
      const rest = token.content.replace(/^-\s*/, '')
      pos += 1
      if (rest === '') {
        const next = tokens[pos]
        list.push(next !== undefined && next.indent > indent ? parseNode(next.indent) : null)
        continue
      }
      // `- key: value` opens a mapping item whose entries sit under the key column.
      if (/^[^\s:][^:]*:(?:\s|$)/.test(rest)) {
        const map = {}
        assignEntry(map, rest, indent + 2, token)
        consumeMapping(map, indent + 2)
        list.push(map)
        continue
      }
      list.push(parseScalar(rest))
    }
    return list
  }

  /** Parse either a sequence or a mapping block. */
  function parseNode(indent) {
    const token = tokens[pos]
    if (token === undefined) return null
    return /^-(?:\s|$)/.test(token.content) ? parseSequence(indent) : consumeMapping({}, indent)
  }

  const document = parseNode(tokens[0]?.indent ?? 0)
  if (pos !== tokens.length) throw new Error(`patch YAML: unparsed content at line ${tokens[pos].line}`)
  return document
}

/** Evaluate one `!!js` expression with the loader's semantics for a platform. */
function evaluateDisabled(expression, platform) {
  return new Function('process', `return (${expression})`)({ platform })
}

const patches = parseYamlSubset(PATCH_TEXT)

/**
 * Parse the same document with the parser the DSH launcher actually uses: the
 * host-resolved `js-yaml` plus the `!!js` scalar type `dsh-app-boot` installs
 * (tag `tag:yaml.org,2002:js` -> `{ __jsExpr }`). Nothing is installed for
 * this: the module already belongs to the running DSH installation, and when it
 * is not resolvable the independent parser above remains authoritative.
 * @returns {Promise<unknown|undefined>} the parsed document, or undefined.
 */
async function parseWithDshDialect() {
  let jsYaml
  try {
    jsYaml = await import(pathToFileURL(hostResolve('js-yaml')).href)
  } catch {
    return undefined
  }
  const yaml = jsYaml.default ?? jsYaml
  const jsExprType = new yaml.Type('tag:yaml.org,2002:js', {
    kind: 'scalar',
    resolve: (data) => typeof data === 'string',
    construct: (data) => ({ __jsExpr: data }),
    predicate: (data) => data instanceof Object && '__jsExpr' in data,
    represent: (data) => data.__jsExpr,
  })
  return yaml.load(PATCH_TEXT, { schema: yaml.JSON_SCHEMA.extend(jsExprType) })
}

const dshDialectPatches = await parseWithDshDialect()

test('the DSH YAML dialect parses cordis.patch.yml exactly like the independent parser', (t) => {
  if (dshDialectPatches === undefined) {
    t.diagnostic('host js-yaml is not resolvable here; the independent parser is authoritative')
    return
  }
  assert.deepEqual(patches, dshDialectPatches, 'both parsers must produce the same loader patch tree')
})

test('cordis.patch.yml parses as a top-level loader patch list', () => {
  assert.ok(Array.isArray(patches), 'patch document must be a top-level YAML array')
  assert.equal(patches.length, 1, 'the bundle ships exactly one patch entry')
  assert.ok(
    patches.every((entry) => entry !== null && typeof entry === 'object' && !Array.isArray(entry)),
    'every patch entry is a mapping',
  )
})

test('the patch is additive only: one insert list and no row overrides', () => {
  const [entry] = patches
  assert.deepEqual(Object.keys(entry), ['insert'], 'a patch entry may only insert; it must not target an existing row')

  const insert = entry.insert
  assert.ok(Array.isArray(insert), 'insert must be a list of rows')
  assert.equal(insert.length, 1, 'the bundle inserts exactly one row')
  assert.equal(insert[0].id, 'gitbash-win')
  assert.equal(insert[0].name, 'dsh-gitbash-win')
  assert.equal(
    /^-\s+id:/m.test(PATCH_TEXT),
    false,
    'no non-insert patch entry may disable or rewrite an official row by id',
  )
})

test('the inserted row is disabled outside Windows through a !!js expression', () => {
  const [row] = patches[0].insert

  assert.ok(isJsExpr(row.disabled), 'disabled must be a !!js expression, not a literal boolean')
  assert.equal(row.disabled.__jsExpr, "process.platform !== 'win32'")

  assert.equal(evaluateDisabled(row.disabled.__jsExpr, 'win32'), false, 'row stays enabled on Windows')
  assert.equal(evaluateDisabled(row.disabled.__jsExpr, 'linux'), true, 'row is disabled on Linux')
  assert.equal(evaluateDisabled(row.disabled.__jsExpr, 'darwin'), true, 'row is disabled on macOS')
})

test('the row config matches the executor schema field names and DESIGN defaults', () => {
  const [row] = patches[0].insert
  const config = row.config

  assert.ok(config !== null && typeof config === 'object' && !Array.isArray(config), 'row config must be a mapping')

  // The row schema and the executor schema are the same schema (DESIGN §3.1).
  assert.equal(Config?.['~standard']?.vendor, 'schemastery', 'executor.Config must be a schemastery schema')
  const schemaFieldNames = Object.keys(Config.dict ?? {})
  assert.ok(schemaFieldNames.length > 0, 'executor schema exposes its fields')
  for (const field of [
    'cwd',
    'timeoutMs',
    'maxTimeoutMs',
    'maxOutputBytes',
    'maxSpillBytes',
    'graceMs',
    'bashPath',
    'initScript',
    'sandboxFallback',
  ]) {
    assert.ok(schemaFieldNames.includes(field), `executor schema is missing "${field}" (DESIGN §3.1)`)
  }
  for (const key of Object.keys(config)) {
    assert.ok(schemaFieldNames.includes(key), `patch config key "${key}" is not declared by the executor schema`)
  }

  // DESIGN §8 pins these defaults; changing them changes first-run behavior.
  assert.deepEqual(config, {
    bashPath: '',
    initScript: '',
    sandboxFallback: 'fail',
    timeoutMs: 120000,
    maxOutputBytes: 64000,
  })

  // The schema must accept exactly this patch config (defaults fill the rest).
  const validated = Config['~standard'].validate(config)
  assert.equal(validated.issues, undefined, `schema rejected the patch config: ${JSON.stringify(validated.issues)}`)
  assert.equal(validated.value.sandboxFallback, 'fail', 'fail-closed stays the default (DESIGN §10.1)')
  assert.equal(validated.value.bashPath, '', 'empty bashPath means auto-detection')
})

test('the patch file is self-contained and Windows-gated only through the expression', () => {
  // A stray second YAML document or a hard-coded `disabled: true` would silently
  // disable the feature on Windows, so prove neither exists.
  assert.equal(/^---$/m.test(PATCH_TEXT), false, 'the patch must stay a single YAML document')
  const disabledLiterals = PATCH_TEXT.match(/^\s+disabled:.*$/gm) ?? []
  assert.equal(disabledLiterals.length, 1, 'exactly one disabled line (the row gate)')
  assert.match(disabledLiterals[0], /!!js\s+process\.platform !== 'win32'/)
})
