// Minimal DOM construction helpers. No framework: every screen builds once and
// updates in place, so the map's rAF loop never touches the DOM tree shape.

type EventHandler = (event: Event) => void;
type AttrValue = string | number | boolean | null | undefined | EventHandler;
type Attrs = Record<string, AttrValue>;
type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2), value as EventListener);
    } else if (key.startsWith('on') && typeof value === 'string') {
      node.setAttribute(key, value);
    } else if (typeof value === 'boolean') {
      if (value) node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function replaceChildren(node: HTMLElement, children: Child[]): void {
  clear(node);
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

export function formatNumber(value: number): string {
  if (Math.abs(value) >= 10000) return `${Math.round(value / 100) / 10}k`;
  return String(Math.round(value * 10) / 10);
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
