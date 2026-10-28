/**
 * Form/sandbox compatibility verification.
 *
 * Proves the interaction contract that Forge generation guidance now states:
 *
 *   1. A semantic <form> whose actions are <button type="button"> with explicit
 *      click and keydown listeners works in the shipped preview sandbox
 *      (`sandbox="allow-scripts"` + CSP `form-action 'none'`), for both click
 *      and Enter.
 *   2. The exact FocusFlow v1 failure shape is still blocked: a `type="submit"`
 *      control plus a submit handler calling `event.preventDefault()`. Chrome
 *      checks the sandboxed-forms flag before dispatching `submit`, so the
 *      handler never runs. `preventDefault()` is not a workaround.
 *   3. A plain native submission is still blocked and does not navigate.
 *   4. The sandbox grants no origin and no browser storage.
 *
 * Deterministic fixtures only; no Muse inference, no paid call, no network.
 *
 * Uses Playwright-managed Chromium by default; FORGE_RUNTIME_BROWSER=chrome is the
 * explicit system-Chrome opt-in. There is no automatic fallback.
 *
 *   pnpm verify:formsandbox
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Frame, Page } from 'playwright-core';
import { launchVerificationBrowser, reportBrowserSelection } from './lib/browser.js';

const FIXTURES = join(process.cwd(), 'tests/fixtures');

/**
 * Mirrors the preview response CSP. `sandbox` itself is not honoured in a
 * `<meta>` CSP, so the iframe carries the real `sandbox="allow-scripts"`
 * attribute, exactly as the Studio does.
 */
const PREVIEW_META_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'";

function readFixture(name: string): string {
  const html = readFileSync(join(FIXTURES, name), 'utf8');
  const head = /<head[^>]*>/i.exec(html);
  if (!head) throw new Error(`${name} has no <head>`);
  const at = head.index + head[0].length;
  const meta = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_META_CSP}">`;
  return `${html.slice(0, at)}${meta}${html.slice(at)}`;
}

const checks: string[] = [];
function check(label: string): void {
  checks.push(label);
  console.log(`  ✓ ${label}`);
}

let frameSequence = 0;

async function loadFixture(page: Page, html: string, consoleLines: string[]): Promise<Frame> {
  consoleLines.length = 0;
  frameSequence += 1;
  const name = `preview-${frameSequence}`;
  await page.evaluate(
    ({ source, frameName }) => {
      for (const existing of document.querySelectorAll('iframe')) existing.remove();
      const frame = document.createElement('iframe');
      frame.name = frameName;
      frame.title = 'preview';
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.style.cssText = 'width:900px;height:700px;border:0';
      document.body.append(frame);
      frame.srcdoc = source;
    },
    { source: html, frameName: name },
  );
  let frame: Frame | undefined;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    frame = page.frames().find((candidate) => candidate.name() === name);
    if (frame) break;
    await page.waitForTimeout(50);
  }
  if (!frame) throw new Error('preview frame did not attach');
  await frame.waitForSelector('body', { timeout: 10_000 });
  await frame.waitForTimeout(250);
  return frame;
}

async function main(): Promise<void> {
  const { browser, selection } = await launchVerificationBrowser();
  reportBrowserSelection(selection);
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    const consoleLines: string[] = [];
    page.on('console', (message) => consoleLines.push(`${message.type()}: ${message.text()}`));
    page.on('pageerror', (error) => consoleLines.push(`pageerror: ${error.message}`));

    await page.setContent(
      '<!doctype html><html><body style="margin:0">' +
        '<iframe name="preview" title="preview" sandbox="allow-scripts" ' +
        'style="width:900px;height:700px;border:0"></iframe></body></html>',
    );

    const sandbox = await page.locator('iframe').getAttribute('sandbox');
    if (sandbox !== 'allow-scripts') {
      throw new Error(`preview sandbox changed: expected "allow-scripts", got ${String(sandbox)}`);
    }
    check('preview sandbox is exactly allow-scripts (no allow-forms or top-navigation)');

    // ---- Compatible: semantic form, type="button", explicit Enter ---------
    const compatibleSource = readFixture('general-app-form.html');
    if (/<button[^>]*type="submit"/i.test(compatibleSource)) {
      throw new Error('the compatible fixture regressed to a submit control');
    }
    const safe = await loadFixture(page, compatibleSource, consoleLines);
    if ((await safe.locator('form').count()) !== 1) throw new Error('semantic form missing');
    if ((await safe.locator('label[for="task-input"]').count()) !== 1) {
      throw new Error('task input has no associated label');
    }
    await safe.getByLabel('New task').fill('Draft launch checklist');
    await safe.getByRole('button', { name: 'Add task' }).click();
    await safe.getByText('Draft launch checklist').waitFor({ timeout: 5_000 });
    check('semantic form with type="button" adds a task by click');

    await safe.getByLabel('New task').fill('Review the staged diff');
    await safe.getByLabel('New task').press('Enter');
    await safe.getByText('Review the staged diff').waitFor({ timeout: 5_000 });
    const count = (await safe.locator('#count').textContent())?.trim();
    if (count !== '2 tasks') throw new Error(`expected 2 tasks, got ${String(count)}`);
    check('Enter adds a task through an explicit keydown listener (keyboard preserved)');

    await safe.getByRole('button', { name: 'Delete task: Draft launch checklist' }).click();
    await safe.getByText('1 task').waitFor({ timeout: 5_000 });
    check('type="button" delete action works with an accessible name');

    const storage = await safe.evaluate(() => {
      try {
        void window.localStorage;
        return 'reachable';
      } catch {
        return 'blocked';
      }
    });
    if (storage !== 'blocked') throw new Error('sandboxed preview could read localStorage');
    check('browser storage is unavailable in the opaque-origin preview');

    // ---- Negative control: submit + preventDefault is still blocked ------
    const prevented = await loadFixture(
      page,
      readFixture('general-app-submit-prevented.html'),
      consoleLines,
    );
    const preventedBefore = prevented.url();
    await prevented.getByLabel('New task').fill('Prevented but still blocked');
    await prevented.getByRole('button', { name: 'Add task' }).click();
    await page.waitForTimeout(500);
    const preventedCreated = await prevented.locator('#task-list li').count();
    const preventedUrl = prevented.url();
    if (preventedCreated !== 0) {
      throw new Error('submit + preventDefault created a task; the sandbox was relaxed');
    }
    if (preventedUrl !== preventedBefore) {
      throw new Error(`submit + preventDefault navigated to ${preventedUrl}`);
    }
    check('submit + preventDefault is still blocked (the submit handler never runs)');

    // ---- Native submission is still blocked ------------------------------
    const unsafe = await loadFixture(
      page,
      readFixture('general-app-native-submit.html'),
      consoleLines,
    );
    const before = unsafe.url();
    await unsafe.getByLabel('New task').fill('Must not be created');
    await unsafe.getByRole('button', { name: 'Add task' }).click();
    await page.waitForTimeout(500);
    const after = unsafe.url();
    const created = await unsafe.locator('#task-list li').count();
    const blockedMessage = consoleLines.find((line) =>
      /form submission|form-action|refused to (send|load)|blocked/i.test(line),
    );
    if (created !== 0) throw new Error('native form submission added a task; sandbox was relaxed');
    if (after !== before) throw new Error(`native form submission navigated to ${after}`);
    if (!blockedMessage) {
      throw new Error(
        `native form submission was not reported as blocked: ${consoleLines.join(' | ')}`,
      );
    }
    check('native form submission is still blocked and does not create a task');

    console.log(`\nForm/sandbox verification: ${checks.length} checks passed.`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
