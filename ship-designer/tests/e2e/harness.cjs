// Shared Playwright harness: serves ship-designer from disk (three.js r128 is vendored in vendor/, so no CDN is needed).
// BASE_URL=https://... runs the same page against a published URL instead.
const path = require("path"), fs = require("fs");
const { chromium, devices } = require("playwright");
const ROOT = path.resolve(__dirname, "../..");

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

async function open(opts = {}) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices["Pixel 7"], ...(opts.context || {}) });
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    const m = url.match(/^http:\/\/ship\.test\/(.*?)(\?.*)?$/);
    if (m) { const f = path.join(ROOT, m[1] || "index.html"); if (fs.existsSync(f)) return route.fulfill({ path: f, contentType: TYPES[path.extname(f)] || "application/octet-stream" }); return route.fulfill({ status: 404, body: "nf" }); }
    return route.abort();
  });
  const page = await context.newPage();
  if (process.env.BASE_URL) { await context.unroute("**/*"); }
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto((process.env.BASE_URL || "http://ship.test/") + (opts.file || "index.html"));
  await page.waitForFunction(() => window.ShipApp && window.ShipApp.metrics);
  await page.waitForTimeout(300);
  return { browser, context, page, errors };
}
module.exports = { open, ROOT };
