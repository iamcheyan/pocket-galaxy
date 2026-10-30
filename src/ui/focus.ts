// DPad/keyboard focus ring. Elements opt in with [data-focusable]; the ring
// walks them in DOM order inside the active scope, which makes every screen
// operable with four directions + confirm + back and keeps tab order equal to
// visual order. Focus is applied with .focus() so native scroll-into-view works.

export class FocusRing {
  private scope: HTMLElement | null = null;
  private index = -1;
  private lastFocused: HTMLElement | null = null;

  setScope(scope: HTMLElement | null): void {
    if (this.scope === scope) return;
    this.scope = scope;
    this.index = -1;
    this.applyGlow(null);
    if (scope) {
      const items = this.items();
      const preferred = this.lastFocused && items.includes(this.lastFocused) ? this.lastFocused : items[0];
      if (preferred) this.focusElement(preferred);
    }
  }

  items(): HTMLElement[] {
    const root = this.scope ?? document.body;
    const nodes = Array.from(root.querySelectorAll<HTMLElement>('[data-focusable]'));
    return nodes.filter((node) => {
      if (node.hasAttribute('disabled') || node.getAttribute('aria-disabled') === 'true') return false;
      if (node.hidden) return false;
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
  }

  current(): HTMLElement | null {
    return this.index >= 0 ? (this.items()[this.index] ?? null) : null;
  }

  focusIndex(index: number): HTMLElement | null {
    const items = this.items();
    if (items.length === 0) return null;
    const wrapped = ((index % items.length) + items.length) % items.length;
    this.index = wrapped;
    this.focusElement(items[wrapped] as HTMLElement);
    return items[wrapped] as HTMLElement;
  }

  move(delta: number): HTMLElement | null {
    return this.focusIndex(this.index + delta);
  }

  focusElement(element: HTMLElement): void {
    const items = this.items();
    const found = items.indexOf(element);
    if (found >= 0) this.index = found;
    this.lastFocused = element;
    element.focus({ preventScroll: false });
    this.applyGlow(element);
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  private applyGlow(element: HTMLElement | null): void {
    for (const previous of document.querySelectorAll<HTMLElement>('.focused')) {
      previous.classList.remove('focused');
    }
    element?.classList.add('focused');
  }

  /** Confirm: clicks buttons, calls canvas activation handlers, toggles rows. */
  activate(): boolean {
    const target = this.current();
    if (!target) return false;
    target.click();
    return true;
  }

  /** Explicit pointer focus, so mouse/touch and DPad share one focus model. */
  focusFromEvent(target: EventTarget | null): void {
    if (!(target instanceof HTMLElement)) return;
    const holder = target.closest<HTMLElement>('[data-focusable]');
    if (holder && this.scope?.contains(holder)) this.focusElement(holder);
  }
}
