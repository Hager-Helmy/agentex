'use strict';

// Locators are private adapter data. Refs are allocated by the gateway, never by a parser.
function publicElement(element) {
  const keys = ['ref', 'role', 'label', 'text', 'accessibilityId', 'resourceId',
    'contentDescription', 'clickable', 'focusable', 'scrollable', 'enabled', 'visible',
    'password', 'bounds'];
  return Object.fromEntries(keys.filter((key) => element[key] !== undefined && element[key] !== '')
    .map((key) => [key, element[key]]));
}

function centerOf(bounds) {
  return { x: Math.round((bounds.left + bounds.right) / 2), y: Math.round((bounds.top + bounds.bottom) / 2) };
}

class ElementRefs {
  constructor() { this.next = 1; }
  replace(elements) {
    const visible = elements.map((element) => ({ ...element, ref: `@e${this.next++}` }));
    this.latest = new Map(visible.map((element) => [element.ref, element]));
    return visible;
  }
  invalidate() { this.latest = undefined; }
  get(ref) {
    if (!this.latest) throw new Error('No fresh UI refs are available. Run dump immediately before this action.');
    if (typeof ref !== 'string' || !/^@e\d+$/.test(ref)) throw new Error('Target must be a fresh UI ref such as @e5.');
    const element = this.latest.get(ref);
    if (!element) throw new Error(`Unknown or stale UI ref: ${ref}`);
    if (!element.enabled) throw new Error(`Target is disabled: ${ref}`);
    return element;
  }
}

module.exports = { publicElement, centerOf, ElementRefs };
