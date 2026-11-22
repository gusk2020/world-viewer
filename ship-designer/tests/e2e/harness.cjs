// Shared Playwright harness: serves ship-designer from disk and the two CDN scripts from a local three@0.128.0 copy
// (this sandbox cannot reach the CDNs; the phone can). THREE_DIR = folder holding three's npm "package".
const path = require("path"), fs = require("fs");
const { chromium, devices } = require("playwright");
const ROOT = path.resolve(__dirname, "../..");
const THREE_DIR = process.env.THREE_DIR;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

async function open(opts = {}) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices["Pixel 7"], ...(opts.context || {}) });
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.includes("three.min.js")) return route.fulfill({ path: path.join(THREE_DIR, "package/build/three.min.js"), contentType: "text/javascript" });
    if (url.includes("OrbitControls.js")) return route.fulfill({ path: path.join(THREE_DIR, "package/examples/js/controls/OrbitControls.js"), contentType: "text/javascript" });
    const m = url.match(/^http:\/\/ship\.test\/(.*?)(\?.*)?$/);
    if (m) { const f = path.join(ROOT, m[1] || "index.html"); if (fs.existsSync(f)) return route.fulfill({ path: f, contentType: TYPES[path.extname(f)] || "application/octet-stream" }); return route.fulfill({ status: 404, body: "nf" }); }
    return route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto("http://ship.test/" + (opts.file || "index.html"));
  await page.waitForFunction(() => window.ShipApp && window.ShipApp.metrics);
  await page.waitForTimeout(300);
  return { browser, context, page, errors };
}
module.exports = { open, ROOT };
