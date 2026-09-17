// Focused tests for js/accessibility.js -- the helper that keeps a
// toggle-like button's `aria-pressed` attribute in sync with its visual
// selected/active state. No DOM library is available in this project (no
// build step, no node_modules), so these use a minimal fake "button" object
// carrying only what the helper actually touches: `setAttribute`.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { setPressed, syncPressedGroup } from "../js/accessibility.js";

const here = dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(join(here, "..", "index.html"), "utf8");
const mainJs = readFileSync(join(here, "..", "js", "main.js"), "utf8");

function fakeButton() {
  return {
    attrs: {},
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
    },
  };
}

test("setPressed writes the string 'true' when pressed", () => {
  const button = fakeButton();
  setPressed(button, true);
  assert.equal(button.getAttribute("aria-pressed"), "true");
});

test("setPressed writes the string 'false' when not pressed", () => {
  const button = fakeButton();
  setPressed(button, false);
  assert.equal(button.getAttribute("aria-pressed"), "false");
});

test("setPressed coerces a truthy/falsy value rather than storing it raw", () => {
  const truthyButton = fakeButton();
  setPressed(truthyButton, 1);
  assert.equal(truthyButton.getAttribute("aria-pressed"), "true");

  const falsyButton = fakeButton();
  setPressed(falsyButton, 0);
  assert.equal(falsyButton.getAttribute("aria-pressed"), "false");
});

test("setPressed can flip a button back and forth", () => {
  const button = fakeButton();
  setPressed(button, true);
  assert.equal(button.getAttribute("aria-pressed"), "true");
  setPressed(button, false);
  assert.equal(button.getAttribute("aria-pressed"), "false");
});

test("syncPressedGroup marks exactly one button pressed in a segmented group", () => {
  const buttons = [fakeButton(), fakeButton(), fakeButton()];
  buttons[0].id = "standard";
  buttons[1].id = "rock";
  buttons[2].id = "climate";

  syncPressedGroup(buttons, (b) => b.id === "rock");

  assert.equal(buttons[0].getAttribute("aria-pressed"), "false");
  assert.equal(buttons[1].getAttribute("aria-pressed"), "true");
  assert.equal(buttons[2].getAttribute("aria-pressed"), "false");
});

test("syncPressedGroup can select none of the buttons", () => {
  const buttons = [fakeButton(), fakeButton()];
  syncPressedGroup(buttons, () => false);
  for (const button of buttons) {
    assert.equal(button.getAttribute("aria-pressed"), "false");
  }
});

test("syncPressedGroup works over a NodeList-like value (has forEach, not an Array)", () => {
  // document.querySelectorAll() returns a NodeList, which has forEach but is
  // not an Array -- confirm the helper doesn't assume array methods beyond it.
  const items = [fakeButton(), fakeButton()];
  const nodeListLike = {
    forEach(callback) {
      items.forEach(callback);
    },
  };
  syncPressedGroup(nodeListLike, (b) => b === items[1]);
  assert.equal(items[0].getAttribute("aria-pressed"), "false");
  assert.equal(items[1].getAttribute("aria-pressed"), "true");
});

test("syncPressedGroup re-run with a different predicate moves the pressed button", () => {
  const buttons = [fakeButton(), fakeButton(), fakeButton()];
  buttons.forEach((b, i) => {
    b.index = i;
  });

  syncPressedGroup(buttons, (b) => b.index === 0);
  assert.deepEqual(buttons.map((b) => b.getAttribute("aria-pressed")), ["true", "false", "false"]);

  syncPressedGroup(buttons, (b) => b.index === 2);
  assert.deepEqual(buttons.map((b) => b.getAttribute("aria-pressed")), ["false", "false", "true"]);
});

// -- Initial HTML state (acceptance criterion 2: accurate before JS runs) --
//
// The helper above can only prove `setPressed`/`syncPressedGroup` work in
// isolation; it says nothing about the attribute values already written
// into index.html, which is what a screen reader sees for the very first
// render, before main.js has had a chance to run at all.

function htmlButtonTags(html) {
  return html.match(/<button\b[^>]*>/g) || [];
}

function attr(tag, name) {
  const match = tag.match(new RegExp(`${name}="([^"]*)"`));
  return match ? match[1] : null;
}

function hasClass(tag, className) {
  const classAttr = attr(tag, "class") || "";
  return classAttr.split(/\s+/).includes(className);
}

test("index.html: every button's initial aria-pressed matches its selected/active class", () => {
  const tags = htmlButtonTags(indexHtml).filter((tag) => attr(tag, "aria-pressed") !== null);
  assert.ok(tags.length > 0, "expected at least one button with an initial aria-pressed value");
  for (const tag of tags) {
    const pressed = attr(tag, "aria-pressed");
    assert.ok(pressed === "true" || pressed === "false", `unexpected aria-pressed value in: ${tag}`);
    const looksSelected = hasClass(tag, "selected") || hasClass(tag, "active");
    assert.equal(
      pressed === "true",
      looksSelected,
      `aria-pressed does not match the selected/active class in: ${tag}`
    );
  }
});

test("index.html: the surface-mode group starts on 標準 (standard) alone", () => {
  const tags = htmlButtonTags(indexHtml).filter((tag) => attr(tag, "data-surface") !== null);
  assert.equal(tags.length, 4);
  for (const tag of tags) {
    const expected = attr(tag, "data-surface") === "standard" ? "true" : "false";
    assert.equal(attr(tag, "aria-pressed"), expected, tag);
  }
});

test("index.html: the seabed-style group starts on 写真 (photo) alone", () => {
  const tags = htmlButtonTags(indexHtml).filter((tag) => attr(tag, "data-style") !== null);
  assert.equal(tags.length, 4);
  for (const tag of tags) {
    const expected = attr(tag, "data-style") === "photo" ? "true" : "false";
    assert.equal(attr(tag, "aria-pressed"), expected, tag);
  }
});

test("index.html: the axis and graticule pill buttons start un-pressed", () => {
  const axisTag = htmlButtonTags(indexHtml).find((tag) => attr(tag, "id") === "axis-toggle");
  const graticuleTag = htmlButtonTags(indexHtml).find((tag) => attr(tag, "id") === "graticule-toggle");
  assert.ok(axisTag && graticuleTag, "expected to find both the axis-toggle and graticule-toggle buttons");
  assert.equal(attr(axisTag, "aria-pressed"), "false");
  assert.equal(attr(graticuleTag, "aria-pressed"), "false");
});

// -- Dynamic synchronization call sites (js/main.js) --
//
// This project has no DOM library to actually run these click handlers
// against (no build step, no node_modules -- see the file header above), so
// these check the source directly: every place that flips a button's visual
// "selected" or "active" class must call the aria-pressed helper in the
// same block. A future toggle that changes the class but forgets the
// attribute would still pass every test above this point -- these are the
// tests that would catch it.

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start !== -1, `marker not found in js/main.js: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end !== -1, `marker not found in js/main.js: ${endMarker}`);
  return source.slice(start, end);
}

function assertPaired(block, description) {
  const hasClassToggle = /classList\.toggle\(\s*["'](selected|active)["']/.test(block);
  const hasSync = /\b(setPressed|syncPressedGroup)\(/.test(block);
  assert.ok(hasClassToggle, `${description}: expected a selected/active class toggle in this block`);
  assert.ok(hasSync, `${description}: expected a setPressed/syncPressedGroup call alongside it`);
}

test("main.js: applySurfaceButtons pairs its selected-class toggle with syncPressedGroup", () => {
  const block = sliceBetween(mainJs, "function applySurfaceButtons() {", "function applyClimateCompareLine(id) {");
  assertPaired(block, "applySurfaceButtons");
});

test("main.js: applyClimateSetButtons pairs its selected-class toggle with syncPressedGroup", () => {
  const block = sliceBetween(mainJs, "function applyClimateSetButtons(id) {", "// Repainting the seabed");
  assertPaired(block, "applyClimateSetButtons");
});

test("main.js: the seabed-style click handler pairs its selected-class toggle with syncPressedGroup", () => {
  const block = sliceBetween(
    mainJs,
    'const seabedButtons = document.querySelectorAll("#seabed-style button");',
    'seaLevelSlider.addEventListener("input", applySeaLevel);'
  );
  assertPaired(block, "the seabed-style click handler");
});

test("main.js: applyAxis pairs its active-class toggle with setPressed", () => {
  const block = sliceBetween(mainJs, "function applyAxis({ recentre }) {", "function atZeroPose() {");
  assertPaired(block, "applyAxis");
});

test("main.js: applyGraticule pairs its active-class toggle with setPressed", () => {
  const block = sliceBetween(mainJs, "function applyGraticule() {", 'graticuleButton.addEventListener("click"');
  assertPaired(block, "applyGraticule");
});

test("main.js: loadWorld pairs the world-switch selected-class toggle with syncPressedGroup", () => {
  const block = sliceBetween(
    mainJs,
    'const worldButtonEls = worldButtons.querySelectorAll("button");',
    "applySeaLevel();"
  );
  assertPaired(block, "loadWorld's world-switch sync");
});

test("main.js: buttons built at runtime (no index.html markup to check) get an initial aria-pressed before they can be clicked", () => {
  // The climate-set and world-switch buttons don't exist in index.html at
  // all -- js/main.js builds them from each world's own data -- so their
  // only "initial state" is whatever the creation code sets before the
  // button is attached to the page and can receive a click.
  const setCreation = sliceBetween(mainJs, "button.dataset.set = set.id;", "if (set.note) button.title = set.note;");
  assert.match(setCreation, /setPressed\(button, false\)/);

  const worldCreation = sliceBetween(mainJs, "button.dataset.world = entry.id;", 'button.addEventListener("click"');
  assert.match(worldCreation, /setPressed\(button, false\)/);
});
