// Focused tests for js/accessibility.js -- the helper that keeps a
// toggle-like button's `aria-pressed` attribute in sync with its visual
// selected/active state. No DOM library is available in this project (no
// build step, no node_modules), so these use a minimal fake "button" object
// carrying only what the helper actually touches: `setAttribute`.

import test from "node:test";
import assert from "node:assert/strict";
import { setPressed, syncPressedGroup } from "../js/accessibility.js";

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
