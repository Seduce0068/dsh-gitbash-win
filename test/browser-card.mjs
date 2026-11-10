/**
 * Real-browser test for the Git Bash settings card.
 *
 * Opens the DSH Web UI in a Chromium-based browser (Microsoft Edge by default),
 * walks Settings → Plugins → "Git Bash", checks the detection panel and the
 * four editable fields, saves a changed command timeout, verifies the profile
 * patch was written, reloads the page and verifies the value came back from the
 * Host settings document.
 *
 * Usage (the caller boots the Web host and passes its token URL):
 *   node test/browser-card.mjs \
 *     --url "http://127.0.0.1:<port>/?token=<token>" \
 *     --patch-file <profile>/cordis.patch.yml \
 *     --platform win32|linux \
 *     [--timeout-ms 130000] [--expect-path <regex source>] [--channel msedge]
 *
 * playwright-core must be resolvable (CI installs it with npm --no-save).
 * Exits 0 on success, 1 on a failed assertion, 2 on an environment problem.
 */
import { existsSync, readFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const args = new Map()
for (let index = 2; index < process.argv.length; index += 1) {
  const token = process.argv[index]
  if (!token.startsWith('--')) continue
  const key = token.slice(2)
  const value = process.argv[index + 1]
  if (value !== undefined && !value.startsWith('--')) {
    args.set(key, value)
    index += 1
  } else {
    args.set(key, 'true')
  }
}
const url = args.get('url')
const patchFile = args.get('patch-file')
const platform = args.get('platform') ?? process.platform
const timeoutMs = args.get('timeout-ms') ?? '130000'
const expectedPath = args.get('expect-path')
const channel = args.get('channel') ?? process.env.BROWSER_CHANNEL ?? 'msedge'
if (url === undefined || patchFile === undefined) {
  console.error('browser-card: --url and --patch-file are required')
  process.exit(2)
}

const require = createRequire(import.meta.url)
let chromium
try {
  ;({ chromium } = require('playwright-core'))
} catch (error) {
  console.error(`browser-card: playwright-core is not installed (${String(error.message)})`)
  process.exit(2)
}

const log = (message) => console.log(`[browser-card] ${message}`)
let activePage
const fail = async (message) => {
  console.error(`[browser-card] FAIL: ${message}`)
  try {
    if (activePage !== undefined) {
      const file = join(process.cwd(), 'browser-card-failure.png')
      await activePage.screenshot({ path: file, fullPage: true })
      const body = (await activePage.locator('body').innerText()).replace(/\n{2,}/g, '\n').slice(0, 1200)
      const controls = await activePage.evaluate(() =>
        [...document.querySelectorAll('button,[role="button"],[role="menuitem"],[role="tab"]')]
          .slice(0, 50)
          .map((el) => `${el.tagName.toLowerCase()}|${(el.getAttribute('aria-label') ?? '').slice(0, 40)}|${(el.innerText ?? '').replace(/\s+/g, ' ').slice(0, 50)}`),
      )
      console.error(`[browser-card] screenshot: ${file}`)
      console.error(`[browser-card] body: ${body}`)
      console.error(`[browser-card] controls: ${JSON.stringify(controls)}`)
    }
  } catch (error) {
    console.error(`[browser-card] dump failed: ${String(error.message)}`)
  }
  process.exit(1)
}

/** Launch environment that keeps a Linux crashpad/XDG path inside a scratch dir. */
function launchEnv() {
  if (process.platform !== 'linux') return undefined
  const home = mkdtempSync(join(tmpdir(), 'dsh-browser-card-'))
  return {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_CACHE_HOME: join(home, '.cache'),
    XDG_DATA_HOME: join(home, '.local', 'share'),
  }
}

/** Dispatch a DOM click from page JS (bypasses actionability overlays). */
async function domClick(page, expression, label) {
  const clicked = await page.evaluate((expr) => {
    const target = eval(expr) // eslint-disable-line no-eval - test-local selector expression
    if (target === null || target === undefined) return false
    target.click()
    return true
  }, expression)
  if (!clicked) await fail(`${label} not found`)
  await page.waitForTimeout(250)
}

const buttonByAria = (aria) => `[...document.querySelectorAll('button,[role="button"],[role="menuitem"]')].find((el) => (el.getAttribute('aria-label') ?? '').trim() === ${JSON.stringify(aria)} && el.getClientRects().length > 0)`
const buttonByText = (text) => `[...document.querySelectorAll('button,[role="button"],[role="menuitem"],a')].find((el) => ((el.innerText ?? '').trim() === ${JSON.stringify(text)} || (el.getAttribute('aria-label') ?? '').trim() === ${JSON.stringify(text)}) && el.getClientRects().length > 0)`
// Portal menu items append their keyboard shortcut to innerText on some builds
// ("Settings Ctrl + Alt + ,"), so match a whole-word prefix as well.
const menuItemByLabel = (labels) => `[...document.querySelectorAll('[role="menuitem"],button')].find((el) => {
  if (!(el.getClientRects().length > 0)) return false
  const text = ((el.innerText ?? '') + ' ' + (el.getAttribute('aria-label') ?? '')).replace(/\\s+/g, ' ').trim()
  return ${JSON.stringify(labels)}.some((label) => text === label || text.startsWith(label + ' '))
})`

/** Dismiss the preview notice if it is shown. */
async function dismissNotice(page) {
  for (const text of ['Continue', '続ける']) {
    const visible = await page.evaluate((expr) => eval(expr) !== undefined, buttonByText(text))
    if (visible) {
      await domClick(page, buttonByText(text), `preview notice ${text}`)
      return
    }
  }
}

/** Close a blocking dialog (Get started / preview / sign-in) if one is shown. */
async function closeBlockingDialogs(page) {
  const closed = await page.evaluate(() => {
    const closers = [...document.querySelectorAll('button')].filter((el) => {
      const aria = (el.getAttribute('aria-label') ?? '').trim()
      const text = (el.innerText ?? '').trim()
      return el.getClientRects().length > 0 && (aria === 'Close' || aria === '閉じる' || text === 'Continue' || text === '続ける' || text === 'Close' || text === '閉じる')
    })
    if (closers.length === 0) return false
    closers[closers.length - 1].click()
    return true
  })
  if (closed) await page.waitForTimeout(600)
  return closed
}

/** Open Settings via the account menu (with retries; the menu renders in a portal). */
async function openSettings(page) {
  const menuAria = (await page.evaluate(() => document.querySelector('button[aria-label="Account menu"]') !== null)) ? 'Account menu' : 'アカウントメニュー'
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await closeBlockingDialogs(page)
    log(`opening settings (attempt ${attempt + 1})`)
    await domClick(page, buttonByAria(menuAria), `account menu (${menuAria})`)
    // The menu is portalled and animates in; wait for either label to appear.
    try {
      await page.waitForFunction(
        (labels) => [...document.querySelectorAll('[role="menuitem"],button')].some((el) => {
          if (!(el.getClientRects().length > 0)) return false
          const text = ((el.innerText ?? '') + ' ' + (el.getAttribute('aria-label') ?? '')).replace(/\s+/g, ' ').trim()
          return labels.some((label) => text === label || text.startsWith(label + ' '))
        }),
        ['Settings', '設定'],
        { timeout: 8000 },
      )
    } catch {
      const labels = await page.evaluate(() =>
        [...document.querySelectorAll('[role="menuitem"],button')]
          .filter((el) => el.getClientRects().length > 0)
          .map((el) => ((el.getAttribute('aria-label') ?? '').trim() + '/' + (el.innerText ?? '').replace(/\s+/g, ' ').trim()).slice(0, 50))
          .slice(0, 25),
      )
      log(`menu item not visible; visible controls: ${JSON.stringify(labels)}`)
      continue
    }
    await domClick(page, menuItemByLabel(['Settings', '設定']), 'settings menu item')
    // Settings replaced the main view: wait for its navigation entries.
    try {
      await page.waitForFunction(
        (labels) => [...document.querySelectorAll('button')].some((el) => {
          if (!(el.getClientRects().length > 0)) return false
          const text = ((el.innerText ?? '') + ' ' + (el.getAttribute('aria-label') ?? '')).replace(/\s+/g, ' ').trim()
          return labels.some((label) => text === label || text.startsWith(label + ' '))
        }),
        ['General', '一般', 'Models', 'モデル'],
        { timeout: 20000 },
      )
      return
    } catch {
      log('settings panel not visible yet; retrying')
      // fall through and retry the whole open
    }
  }
  await fail('Settings panel did not open')
}

/** Close the Settings panel. */
async function closeSettings(page) {
  const closed = await page.evaluate(() => {
    const closers = [...document.querySelectorAll('button')].filter((el) => {
      const aria = (el.getAttribute('aria-label') ?? '').trim()
      const text = (el.innerText ?? '').trim()
      return (aria === 'Close' || aria === '閉じる' || text === 'Close' || text === '閉じる') && el.getClientRects().length > 0
    })
    if (closers.length === 0) return false
    closers[closers.length - 1].click()
    return true
  })
  if (!closed) await fail('settings Close button not found')
  await page.waitForTimeout(500)
}

/** Navigate the sidebar to the Plugins page. */
async function openPluginsPage(page) {
  const aria = (await page.evaluate(() => document.querySelector('button[aria-label="Plugins"]') !== null)) ? 'Plugins' : 'プラグイン'
  await domClick(page, buttonByAria(aria), `sidebar ${aria}`)
  await page.waitForSelector('button[aria-label="View Git Bash"]', { timeout: 20000 })
  await page.waitForTimeout(300)
}

/** Open the Git Bash settings card page. */
async function openGitBashCard(page) {
  await domClick(page, buttonByAria('View Git Bash'), 'View Git Bash')
  await page.waitForSelector('[data-plugin="dsh-gitbash-win"]', { timeout: 20000 })
  await page.waitForTimeout(500)
}

/** Wait for a predicate against the page with a timeout. */
async function waitFor(page, fn, timeout, label) {
  const start = Date.now()
  let last
  while (Date.now() - start < timeout) {
    try {
      last = await fn()
      if (last !== undefined && last !== false) return last
    } catch (error) {
      last = error
    }
    await page.waitForTimeout(300)
  }
  await fail(`timed out waiting for ${label}${last instanceof Error ? `: ${String(last.message)}` : ''}`)
}

const browser = await chromium.launch({ channel, headless: true, env: launchEnv() })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' })
const page = await context.newPage()
activePage = page
const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(String(error).slice(0, 400)))
page.on('console', (message) => {
  if (message.type() === 'error') pageErrors.push(message.text().slice(0, 400))
})

try {
  log(`navigating to ${url.replace(/token=[^&]+/, 'token=<redacted>')}`)
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForSelector('button[aria-label="New session"], button[aria-label="新規セッション"]', { timeout: 60000 })
  await dismissNotice(page)
  await openSettings(page)
  await closeSettings(page)
  await openPluginsPage(page)
  await openGitBashCard(page)
  log('settings card opened')

  const card = page.locator('[data-plugin="dsh-gitbash-win"]')
  const cardText = await card.innerText()
  const pathPattern = expectedPath === undefined
    ? platform === 'win32' ? /git[\\/]+bin[\\/]+bash\.exe/i : /(bin[\\/]+bash|bash\.exe)/i
    : new RegExp(expectedPath, 'i')
  if (!pathPattern.test(cardText)) await fail(`detection panel does not show the resolved bash path (${pathPattern}): ${cardText.slice(0, 400)}`)
  for (const id of ['gitbash-win-bashPath', 'gitbash-win-initScript', 'gitbash-win-timeoutMs', 'gitbash-win-maxOutputBytes', 'gitbash-win-save']) {
    if (!(await page.locator(`#${id}`).count())) await fail(`missing control #${id}`)
  }
  log('detection panel and four fields are rendered')

  await page.locator('#gitbash-win-timeoutMs').fill(timeoutMs)
  await domClick(page, buttonByText('Save'), 'Save')
  await waitFor(page, async () => /Saved|保存しました/.test(await card.innerText()), 15000, 'saved feedback')
  await waitFor(page, () => (existsSync(patchFile) && readFileSync(patchFile, 'utf8').includes(`timeoutMs: ${timeoutMs}`)), 20000, `profile patch timeoutMs: ${timeoutMs}`)
  log(`saved command timeout ${timeoutMs} and the profile patch was written`)

  // Reload and verify the value round-trips through the Host settings document.
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('button[aria-label="New session"], button[aria-label="新規セッション"]', { timeout: 60000 })
  await dismissNotice(page)
  await openPluginsPage(page)
  await openGitBashCard(page)
  const persisted = await waitFor(page, async () => {
    const value = await page.locator('#gitbash-win-timeoutMs').inputValue()
    return value === timeoutMs ? value : false
  }, 20000, `persisted timeout ${timeoutMs} after reload`)
  log(`timeout persisted across reload: ${persisted}`)

  if (pageErrors.length > 0) await fail(`page errors: ${JSON.stringify(pageErrors.slice(0, 5))}`)
  console.log('[browser-card] BROWSER CARD PASS')
} finally {
  await browser.close()
}
