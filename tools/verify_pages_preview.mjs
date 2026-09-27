import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true });
const failures = [];
page.on('pageerror', e => failures.push(e.message));
page.on('response', r => { if (r.status() >= 400) failures.push(`${r.status()} ${r.url()}`); });
page.on('console', m => { if (m.type() === 'error') failures.push(m.text()); });
const ready = async label => page.waitForFunction(x =>
  document.getElementById('world-cycle')?.textContent.includes(x) &&
  document.getElementById('loading')?.classList.contains('hidden'), label, { timeout: 90000 });
try {
  await page.goto('https://gusk2020.github.io/world-viewer/previews/anti-kyterra-v2/anti-kytera/viewer/index.html',
    { waitUntil: 'domcontentloaded', timeout: 45000 });
  await ready('地球');
  for (const label of ['月', '火星', '水星', '金星']) {
    await page.locator('#world-cycle').click();
    await ready(label);
    if (label === '水星' || label === '金星') {
      await page.locator('[data-surface="ice"]').click();
      await page.waitForFunction(() => document.getElementById('ak-readout')?.textContent.includes('教師'));
      if (!(await page.locator('#ak-score').textContent()).includes('教師なし'))
        throw Error(`${label}: teacher disclosure absent`);
    }
  }
  if (failures.length) throw Error(failures.join('\n'));
  console.log('Public phone URL loaded Earth, Mercury and Venus with real assets.');
} catch (error) {
  await page.screenshot({ path: '/tmp/pages-preview-failure.png' });
  console.log('Current world:', await page.locator('#world-cycle').textContent(),
    'loading:', await page.locator('#loading').textContent(), 'errors:', failures);
  throw error;
} finally {
  await browser.close();
}
