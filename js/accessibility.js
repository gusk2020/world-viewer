// A tiny, reusable helper so a toggle-like button's visual selected/active
// state and its `aria-pressed` attribute can never drift apart from each
// other -- every call site that flips the CSS class flips the attribute in
// the same statement, instead of each control writing the string itself.

// Sets one button's pressed state.
export function setPressed(button, pressed) {
  button.setAttribute("aria-pressed", pressed ? "true" : "false");
}

// Applies `isPressed` to every button in a group in one pass -- for the
// segmented (radio-like) controls where exactly one button is selected at a
// time, and for cycling a NodeList/array without a manual loop at each call
// site.
export function syncPressedGroup(buttons, isPressed) {
  buttons.forEach((button) => setPressed(button, isPressed(button)));
}
