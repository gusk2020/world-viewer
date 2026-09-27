import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 393, height: 851 }, deviceScaleFactor: 1,
  isMobile: true, hasTouch: true });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => {
  if (message.type() === 'error') errors.push(message.text());
});
page.on('response', response => {
  if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
});
const ready = async name => {
  try {
    await page.waitForFunction(label => document.getElementById('world-cycle').textContent.includes(label) &&
      document.getElementById('loading').classList.contains('hidden'), name, { timeout: 45000 });
  } catch (error) {
    console.log('Waiting for:', name, 'current:', await page.locator('#world-cycle').textContent(),
      'loading:', await page.locator('#loading').textContent(), 'page errors:', errors);
    await page.screenshot({ path: '/tmp/smoke-failure.png' });
    throw error;
  }
};
const click = async selector => page.locator(selector).click({ timeout: 15000 });
try {
  await page.goto('http://127.0.0.1:8765/anti-kytera/viewer/', { waitUntil: 'domcontentloaded' });
  await ready('地球');
  for (const name of ['月', '火星', '水星', '金星']) {
    await click('#world-cycle');
    await ready(name);
    if (name !== '水星' && name !== '金星') continue;
    for (const stage of ['bed', 'sea', 't2m', 'hum', 'precip', 'ice', 'veg']) {
      await click(`[data-surface="${stage}"]`);
      await page.waitForFunction(() => document.getElementById('ak-readout').textContent.includes('教師') &&
        !document.getElementById('ak-info').hidden);
      if (!(await page.locator('#ak-readout').textContent()).includes('教師'))
        throw Error(`${name} ${stage}: no centre readout`);
    }
    if (!await page.locator('#ak-score').textContent().then(t => t.includes('教師なし')))
      throw Error(`${name}: teacher disclosure missing`);
    await page.screenshot({ path: `/tmp/${name}-3d.png` });
    await page.locator('#sea-level-slider').evaluate(el => { el.value = '10'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.locator('#climate-temp-slider').evaluate(el => { el.value = '18'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    if (await page.locator('#ak-condition').isHidden()) throw Error(`${name}: slider limitation hidden`);
    await click('#view-toggle');
    await page.waitForFunction(() => document.getElementById('view-toggle').textContent.includes('3D'));
    // Software WebGL keeps the top panel moving between frames in CI; invoke
    // the same button handler directly after confirming the 2D mode is open.
    await page.locator('[data-surface="sea"]').evaluate(el => el.click());
    await page.waitForFunction(() => document.querySelector('[data-surface="sea"]').classList.contains('selected'));
    await page.locator('#sea-level-slider').evaluate(el => { el.value = '-10'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `/tmp/${name}.png` });
    await click('#view-toggle');
  }
  await click('#world-cycle');
  await ready('地球');
  await click('[data-surface="veg"]');
  await page.waitForFunction(() => !document.getElementById('ak-info').hidden);
  if (errors.length) throw Error(errors.join('\n'));
  console.log('Mobile smoke passed: Earth, Moon, Mars, Mercury, Venus; 7 stages; 2D/3D; sliders; Earth return.');
} finally {
  await browser.close();
}
