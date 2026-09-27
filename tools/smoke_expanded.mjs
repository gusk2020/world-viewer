import { chromium } from 'playwright';

const URL = process.env.PREVIEW_URL || 'http://127.0.0.1:8765/anti-kytera/viewer/';
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
const ready = async id => page.waitForFunction(x =>
  document.getElementById('world-select')?.value === x &&
  document.getElementById('loading')?.classList.contains('hidden'), id, { timeout: 90000 });
try {
  // A fresh Pages deployment normally takes a little longer than the
  // publisher's push. Wait for its exact URL, not an old or cached build.
  for (let n = 0; n < 20; n++) {
    const r = await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (r?.ok()) break;
    if (n === 19) throw Error(`preview unavailable: ${r?.status()}`);
    errors.length = 0;
    await page.waitForTimeout(10000);
  }
  await ready('kasoku-sekai');
  for (const id of ['moon', 'mars', 'mercury', 'venus', 'kasoku-sekai']) {
    await page.selectOption('#world-select', id);
    await ready(id);
    await page.locator('[data-surface="standard"]').click();
    if (id === 'kasoku-sekai') {
      await page.locator('[data-surface="elevation"]').click();
      if (!(await page.locator('#ak-score').textContent()).includes('標高色')) throw Error('Earth elevation legend missing');
    }
    for (const stage of ['bed', 'sea', 't2m', 'hum', 'precip', 'ice', 'veg']) {
      await page.locator(`[data-surface="${stage}"]`).click();
      await page.waitForFunction(() => document.querySelector('#ak-readout')?.textContent.includes('教師'));
    }
    await page.locator('[data-veg-style="simple"]').click();
    if (!(await page.locator('#ak-score').textContent()).includes(id === 'kasoku-sekai' ? '簡略5区分' : '教師なし'))
      throw Error(`${id} simple vegetation or teacher label missing`);
    await page.locator('#sea-level-slider').evaluate(el => { el.value = '10'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.locator('#climate-temp-slider').evaluate(el => { el.value = '18'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    if (await page.locator('#ak-condition').isHidden()) throw Error(`${id} missing slider notice`);
    await page.locator('#view-toggle').click();
    await page.waitForFunction(() => document.querySelector('#view-toggle')?.textContent.includes('3D'));
    await page.locator('[data-surface="standard"]').evaluate(el => el.click());
    await page.waitForTimeout(300);
    await page.screenshot({ path: `/tmp/${id}-expanded.png` });
    await page.locator('#view-toggle').click();
  }
  if (errors.length) throw Error(errors.join('\n'));
  console.log('Phone-width preview passed: five bodies, image/elevation, seven stages, simple vegetation, 2D/3D, sliders.');
} catch (error) {
  await page.screenshot({ path: '/tmp/expanded-failure.png' });
  console.error('World:', await page.locator('#world-select').inputValue().catch(() => '?'),
    'loading:', await page.locator('#loading').textContent().catch(() => '?'), errors);
  throw error;
} finally { await browser.close(); }
