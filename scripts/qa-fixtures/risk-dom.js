export class FakeElement {
  constructor(tagName = 'div') { this.tagName = tagName; this.children = []; this.listeners = new Map(); this.dataset = {}; this.className = ''; this.disabled = false; this.value = ''; this.type = ''; this.parentNode = null; this._text = ''; }
  set value(value) { this._value = String(value); }
  get value() { return this._value; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text; }
  appendChild(node) { node.parentNode = this; this.children.push(node); return node; }
  append(...nodes) { nodes.forEach(node => this.appendChild(node)); }
  add(node) { this.appendChild(node); if (this.tagName === 'select' && (node.selected || this.children.length === 1)) this.value = node.value; }
  addEventListener(type, listener) { const handlers = this.listeners.get(type) || []; handlers.push(listener); this.listeners.set(type, handlers); }
  dispatch(type) { const event = { target: this, preventDefault() { this.defaultPrevented = true; } }; (this.listeners.get(type) || []).forEach(listener => listener(event)); return event; }
  click() { this.dispatch('click'); if (this.type === 'submit') { let parent = this.parentNode; while (parent && parent.tagName !== 'form') parent = parent.parentNode; parent?.dispatch('submit'); } }
  setAttribute(name, value) { this[name] = String(value); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  showModal() { this.open = true; }
  close() { this.open = false; queueMicrotask(() => this.dispatch('close')); }
  dispatchEvent(event) { (this.listeners.get(event.type) || []).forEach(listener => listener(event)); return !event.defaultPrevented; }
  querySelectorAll(selector) { return all(this, node => node !== this && (selector.startsWith('.') ? node.className.split(/\s+/).includes(selector.slice(1)) : node.tagName === selector)); }
  remove() { const siblings = this.parentNode?.children || []; const index = siblings.indexOf(this); if (index >= 0) siblings.splice(index, 1); this.parentNode = null; }
}
export class FakeOption extends FakeElement {
  constructor(text, value, defaultSelected = false, selected = false) { super('option'); this.textContent = text; this.value = value; this.defaultSelected = defaultSelected; this.selected = selected; }
}
export const find = (root, predicate) => {
  if (predicate(root)) return root;
  for (const child of root.children) { const hit = find(child, predicate); if (hit) return hit; }
  return null;
};
export const byText = (root, text) => find(root, node => node._text === text);
export const byButtonText = (root, text) => {
  const found = [];
  const visit = node => { if (node.tagName === 'button' && node._text === text) found.push(node); node.children.forEach(visit); };
  visit(root); return found.at(-1) || null;
};
export const byName = (root, name) => find(root, node => node.name === name);
export const byClass = (root, token) => find(root, node => node.className.split(/\s+/).includes(token));
export const all = (root, predicate) => {
  const found = [];
  const visit = node => { if (predicate(node)) found.push(node); node.children.forEach(visit); };
  visit(root); return found;
};
export const renderedText = node => `${node._text}${node.children.map(renderedText).join('')}`;
