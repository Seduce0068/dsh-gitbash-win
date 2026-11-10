/**
 * Windows ACL sandbox probe (diagnostic, not part of `node --test`).
 *
 * The one Windows-specific behaviour this repository cannot verify on POSIX is
 * whether the official ACL restricted-token runner can start a Git for Windows
 * bash. This script mounts the REAL `@deepseek-ai/dsh-sandbox-local` provider
 * (the same one the Windows composition uses) behind the private executor and
 * reports exactly one of:
 *
 *   - `confined-ok`     : the runner started Git Bash and the file policy held
 *                         (write inside the workspace allowed, write outside
 *                         denied). This is the ideal outcome.
 *   - `fail-closed`     : the runner could not start Git Bash; the executor
 *                         refused to run the command with SANDBOX_UNAVAILABLE
 *                         (the documented fail-closed behaviour).
 *   - `acl-incompatible`: the ACL runner started, but Git Bash died during
 *                         process initialization with a known MSYS +
 *                         restricted-token NTSTATUS (e.g. 0xC0000142
 *                         STATUS_DLL_INIT_FAILED). Nothing ran, which is the
 *                         fail-safe outcome; the plugin converts this to the
 *                         same SANDBOX_UNAVAILABLE guidance for the model.
 *   - `UNEXPECTED`      : none of the above (exit 2) — a bug to investigate.
 *
 * It never weakens the policy silently: if a command runs it must be confined;
 * the outside-write check is the evidence. The GitHub Actions windows-smoke
 * workflow runs this step as a non-blocking diagnostic.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

if (process.platform !== 'win32') {
  console.log('ACL probe: skipped (not a Windows host)')
  process.exit(0)
}

const { hostImport } = await import('../lib/host-modules.js')
const { GitBashExecutor } = await import('../lib/executor.js')
const { resolveGitBash } = await import('../lib/detect.js')
const { Context, Service } = await hostImport('@deepseek-ai/cordis')
const subprocess = await hostImport('@deepseek-ai/dsh-subprocess-local')
const sandboxLocal = await hostImport('@deepseek-ai/dsh-sandbox-local')

const detection = await resolveGitBash({ cache: false })
if (!detection.ok) {
  console.log(`ACL probe: no Git Bash to test (${detection.report})`)
  process.exit(0)
}

const workspace = await mkdtemp(join(tmpdir(), 'dsh-gitbash-win-acl-'))
const outside = join(tmpdir(), `dsh-gitbash-win-acl-outside-${process.pid}.txt`)

class StubSandboxPolicy extends Service {
  constructor(ctx) {
    super(ctx, 'sandboxPolicy')
    this.defaultMode = 'workspace-write'
  }
  resolve() {
    return { mode: 'workspace-write', workspaceRoot: workspace }
  }
}

const root = new Context()
await root.plugin(subprocess.default, {})
await root.plugin(sandboxLocal.default, {})
await root.plugin(StubSandboxPolicy, {})
const scope = root.isolate('shell')
await scope.plugin(GitBashExecutor, {
  bashPath: detection.path,
  sandboxFallback: 'fail',
  cwd: workspace,
  timeoutMs: 120000,
  maxTimeoutMs: 600000,
  maxOutputBytes: 64000,
})
const shell = scope.get('shell')

const policy = { mode: 'workspace-write', workspaceRoot: workspace }
const toPosix = (path) =>
  execFileSync(detection.path, ['-c', 'cygpath -u "$1"', '--', path], { encoding: 'utf8' }).trim()
const insideFile = join(workspace, 'inside.txt')

/** MSYS/bash crash codes observed when a restricted token breaks CRT init. */
const KNOWN_RESTRICTED_TOKEN_CRASHES = new Set([0xc0000142, 0xc0000005, 0xc00000fd].map((code) => code >>> 0))
const asUnsigned = (exitCode) => (Number.isInteger(exitCode) ? exitCode >>> 0 : undefined)

let outcome
let confinedExit = null
try {
  const spec = shell.resolve({
    command: 'echo inside > ./inside.txt && echo confined-write-ok',
    sandboxPolicy: policy,
  })
  const result = await (await shell.execute(spec)).result()
  confinedExit = asUnsigned(result.exitCode)
  const insideOk = result.exitCode === 0 && existsSync(insideFile)
  console.log(`ACL probe: confined run exit=${result.exitCode} enforcement=${result.sandbox?.enforcement ?? 'none'} insideWrite=${insideOk}`)

  let outsideDenied = true
  let outsideDetail = 'not attempted'
  try {
    const outsideSpec = shell.resolve({
      command: `echo outside > "${toPosix(outside)}" ; echo write-exit=$?`,
      sandboxPolicy: policy,
    })
    const outsideResult = await (await shell.execute(outsideSpec)).result()
    outsideDenied = !existsSync(outside)
    outsideDetail = `exit=${outsideResult.exitCode} fileExists=${!outsideDenied}`
  } catch (error) {
    outsideDenied = true
    outsideDetail = `runner/executor error: ${error?.code ?? error?.message ?? String(error)}`
  }
  console.log(`ACL probe: outside write denied=${outsideDenied} (${outsideDetail})`)

  if (insideOk && outsideDenied) {
    outcome = 'confined-ok'
  } else if (!insideOk && KNOWN_RESTRICTED_TOKEN_CRASHES.has(confinedExit)) {
    outcome = 'acl-incompatible'
    console.log(`ACL probe: Git Bash crashed during initialization under the ACL restricted token (exit 0x${confinedExit.toString(16)}); no command ran (fail-safe)`)
  } else {
    outcome = 'UNEXPECTED'
  }
} catch (error) {
  const code = error?.code ?? ''
  if (code === 'SANDBOX_UNAVAILABLE') {
    outcome = 'fail-closed'
    console.log(`ACL probe: fail-closed — ${String(error.message).split('\n')[0]}`)
    console.log('ACL probe: the ACL runner could not start Git Bash; no command ran (expected possible outcome, documented in docs/security.md)')
  } else {
    outcome = 'UNEXPECTED'
    console.log(`ACL probe: unexpected error ${code || '(no code)'}: ${error?.message ?? String(error)}`)
  }
}

try {
  await root.fiber.dispose()
} catch {
  // disposal is best-effort in this diagnostic
}
await rm(workspace, { recursive: true, force: true })
await rm(outside, { force: true })

switch (outcome) {
  case 'confined-ok':
    console.log('ACL probe: RESULT=confined-ok')
    process.exit(0)
    break
  case 'fail-closed':
    console.log('ACL probe: RESULT=fail-closed')
    process.exit(0)
    break
  case 'acl-incompatible':
    console.log('ACL probe: RESULT=acl-incompatible')
    process.exit(0)
    break
  default:
    console.log('ACL probe: RESULT=UNEXPECTED')
    process.exit(2)
}
