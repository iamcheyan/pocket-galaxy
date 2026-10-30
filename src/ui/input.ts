// Unified input layer. Touch, mouse, DPad/keyboard and gamepad all resolve into
// the same semantic actions, so gameplay code has exactly one input contract and
// the settings debug panel can display what any device actually produced.

export type ActionId =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'confirm'
  | 'back'
  | 'scan'
  | 'details'
  | 'zoomIn'
  | 'zoomOut'
  | 'pause'
  | 'perf'
  | 'navPrev'
  | 'navNext';

export type InputSource = 'keyboard' | 'gamepad' | 'touch' | 'mouse' | 'pointer';

export interface InputEventRecord {
  source: InputSource;
  action: ActionId | 'pan' | 'zoom' | 'tap' | 'longpress' | 'hover' | 'contextmenu';
  detail: string;
  at: number;
}

export interface GestureState {
  panX: number;
  panY: number;
  zoomFactor: number;
  tapX: number;
  tapY: number;
  longPress: boolean;
  /** Right-click or touch long-press request for the app-drawn menu. */
  contextMenu: boolean;
}

export const DEFAULT_GAMEPAD_ACTIONS: Record<ActionId, number> = {
  up: 12,
  down: 13,
  left: 14,
  right: 15,
  confirm: 0,
  back: 1,
  scan: 2,
  details: 3,
  zoomOut: 4,
  zoomIn: 5,
  perf: 8,
  pause: 9,
  navPrev: 6,
  navNext: 7,
};

export const GAMEPAD_BUTTON_NAMES: Record<number, string> = {
  0: 'A / Cross',
  1: 'B / Circle',
  2: 'X / Square',
  3: 'Y / Triangle',
  4: 'L1 / LB',
  5: 'R1 / RB',
  6: 'L2 / LT',
  7: 'R2 / RT',
  8: 'Select / Back',
  9: 'Start',
  10: 'L3',
  11: 'R3',
  12: 'D-Pad Up',
  13: 'D-Pad Down',
  14: 'D-Pad Left',
  15: 'D-Pad Right',
  16: 'Home',
};

export const KEY_ACTIONS: Record<string, ActionId> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Enter: 'confirm',
  ' ': 'confirm',
  Escape: 'back',
  Backspace: 'back',
  z: 'scan',
  x: 'details',
  '=': 'zoomIn',
  '+': 'zoomIn',
  '-': 'zoomOut',
  p: 'pause',
  f: 'perf',
  '[': 'navPrev',
  ']': 'navNext',
};

export interface InputHandlers {
  onAction(action: ActionId, source: InputSource): void;
  onLog(record: InputEventRecord): void;
  onGesture(gesture: GestureState): void;
  /**
   * Called for every newly pressed gamepad button before action dispatch.
   * Returning true consumes the press (used by the rebinding UI).
   */
  onGamepadButton?(button: number): boolean;
}

interface Point {
  x: number;
  y: number;
}

const AXIS_DEADZONE = 0.55;

/** Tracks held keys so OS auto-repeat does not fire multiple confirmations. */
export class InputRouter {
  private readonly handlers: InputHandlers;
  private readonly held = new Set<string>();
  private gamepadMask = 0;
  private gamepadAxes = { x: 0, y: 0 };
  private gamepadMap: Record<ActionId, number>;
  private pointers = new Map<number, Point>();
  private dragOrigin: Point | null = null;
  private dragLast: Point | null = null;
  private pinchDistance = 0;
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private longPressFired = false;
  private lastTapAt = 0;
  private attached = false;
  private gestureHost: HTMLElement | null = null;

  constructor(handlers: InputHandlers, gamepadMap?: Record<string, number>) {
    this.handlers = handlers;
    this.gamepadMap = { ...DEFAULT_GAMEPAD_ACTIONS };
    if (gamepadMap) {
      for (const [key, value] of Object.entries(gamepadMap)) {
        if (key in this.gamepadMap && typeof value === 'number') {
          this.gamepadMap[key as ActionId] = value;
        }
      }
    }
  }

  /**
   * Restricts pointer gestures to one element (the map stage). Without this,
   * a tap on a button would also register as a map tap and rebuild the screen
   * mid-click.
   */
  setGestureHost(host: HTMLElement | null): void {
    this.gestureHost = host;
  }

  private onHost(target: EventTarget | null): boolean {
    // No map on screen → no map gestures. Returning true here would let a tap on
    // a settings button register as a map tap and rebuild the screen mid-click.
    if (!this.gestureHost) return false;
    return target instanceof Node && this.gestureHost.contains(target);
  }

  setGamepadMap(map: Record<string, number>): void {
    for (const [key, value] of Object.entries(map)) {
      if (key in this.gamepadMap && typeof value === 'number') this.gamepadMap[key as ActionId] = value;
    }
    this.gamepadMask = 0;
  }

  gamepadMapState(): Record<string, number> {
    return { ...this.gamepadMap };
  }

  attach(target: HTMLElement): void {
    if (this.attached) return;
    this.attached = true;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.resetHeld);
    target.addEventListener('pointerdown', this.onPointerDown);
    target.addEventListener('pointermove', this.onPointerMove);
    target.addEventListener('pointerup', this.onPointerUp);
    target.addEventListener('pointercancel', this.onPointerCancel);
    target.addEventListener('pointerleave', this.onPointerUp);
    target.addEventListener('wheel', this.onWheel, { passive: false });
    target.addEventListener('contextmenu', this.onContextMenu);
  }

  detach(target: HTMLElement): void {
    if (!this.attached) return;
    this.attached = false;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.resetHeld);
    target.removeEventListener('pointerdown', this.onPointerDown);
    target.removeEventListener('pointermove', this.onPointerMove);
    target.removeEventListener('pointerup', this.onPointerUp);
    target.removeEventListener('pointercancel', this.onPointerCancel);
    target.removeEventListener('pointerleave', this.onPointerUp);
    target.removeEventListener('wheel', this.onWheel);
    target.removeEventListener('contextmenu', this.onContextMenu);
    this.clearLongPress();
  }

  private resetHeld = (): void => {
    this.held.clear();
  };

  private log(
    source: InputSource,
    action: InputEventRecord['action'],
    detail: string,
  ): void {
    this.handlers.onLog({ source, action, detail, at: Date.now() });
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    const action = KEY_ACTIONS[event.key] ?? KEY_ACTIONS[event.key.toLowerCase()];
    if (!action) return;
    event.preventDefault();
    if (this.held.has(event.code)) return;
    this.held.add(event.code);
    this.log('keyboard', action, `${event.key} down`);
    this.handlers.onAction(action, 'keyboard');
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.held.delete(event.code);
  };

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.onHost(event.target)) return;
    const stage = event.currentTarget as HTMLElement;
    stage.setPointerCapture?.(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 2) {
      const [a, b] = Array.from(this.pointers.values());
      if (!a || !b) return;
      this.pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
      this.clearLongPress();
      return;
    }
    if (this.pointers.size === 1) {
      this.dragOrigin = { x: event.clientX, y: event.clientY };
      this.dragLast = { x: event.clientX, y: event.clientY };
      this.longPressFired = false;
      this.longPressTimer = setTimeout(() => {
        this.longPressFired = true;
        this.handlers.onGesture({
          panX: 0,
          panY: 0,
          zoomFactor: 1,
          tapX: this.dragOrigin?.x ?? 0,
          tapY: this.dragOrigin?.y ?? 0,
          longPress: true,
          contextMenu: true,
        });
        this.log('touch', 'longpress', `held at ${this.dragOrigin?.x},${this.dragOrigin?.y}`);
      }, 480);
    }
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.onHost(event.target) && !this.pointers.has(event.pointerId)) return;
    const previous = this.pointers.get(event.pointerId);
    if (!previous) {
      if (event.pointerType === 'mouse') {
        this.handlers.onGesture({
          panX: 0,
          panY: 0,
          zoomFactor: 1,
          tapX: event.clientX,
          tapY: event.clientY,
          longPress: false,
          contextMenu: false,
        });
        this.log('mouse', 'hover', `${Math.round(event.clientX)},${Math.round(event.clientY)}`);
      }
      return;
    }
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 2) {
      const [a, b] = Array.from(this.pointers.values());
      if (!a || !b) return;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinchDistance > 0 && distance > 0) {
        const factor = distance / this.pinchDistance;
        this.pinchDistance = distance;
        this.handlers.onGesture({
          panX: 0,
          panY: 0,
          zoomFactor: factor,
          tapX: event.clientX,
          tapY: event.clientY,
          longPress: false,
          contextMenu: false,
        });
        this.log('touch', 'zoom', `pinch ${factor.toFixed(3)}`);
      }
      return;
    }
    if (!this.dragLast) return;
    const dx = event.clientX - this.dragLast.x;
    const dy = event.clientY - this.dragLast.y;
    this.dragLast = { x: event.clientX, y: event.clientY };
    const travelled = this.dragOrigin
      ? Math.hypot(event.clientX - this.dragOrigin.x, event.clientY - this.dragOrigin.y)
      : 0;
    if (travelled > 6) this.clearLongPress();
    if (Math.abs(dx) + Math.abs(dy) < 0.5) return;
    this.handlers.onGesture({
      panX: dx,
      panY: dy,
      zoomFactor: 1,
      tapX: event.clientX,
      tapY: event.clientY,
      longPress: false,
      contextMenu: false,
    });
    if (event.pointerType === 'mouse' && (event.buttons & 1) === 0 && (event.buttons & 2) === 0) return;
    const source: InputSource = event.pointerType === 'mouse' ? 'mouse' : 'touch';
    this.log(source, 'pan', `${dx.toFixed(1)},${dy.toFixed(1)}`);
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (!this.pointers.has(event.pointerId)) return;
    const stage = event.currentTarget as HTMLElement;
    stage.releasePointerCapture?.(event.pointerId);
    this.clearLongPress();
    const had = this.pointers.has(event.pointerId);
    this.pointers.delete(event.pointerId);
    if (this.pointers.size < 2) this.pinchDistance = 0;
    if (!had) return;
    const origin = this.dragOrigin;
    const travelled = origin
      ? Math.hypot(event.clientX - origin.x, event.clientY - origin.y)
      : 0;
    this.dragOrigin = null;
    this.dragLast = null;
    if (travelled > 10 || this.longPressFired) return;
    const now = Date.now();
    const doubleTap = now - this.lastTapAt < 320;
    this.lastTapAt = now;
    const source: InputSource = event.pointerType === 'mouse' ? 'mouse' : 'touch';
    // Right-click arrives as button 2. Synthetic input (remote devtools, some
    // embedded engines) never fires `contextmenu`, so the pointer path opens the
    // menu itself; `onContextMenu` still covers real browsers.
    const wantsMenu = event.button === 2;
    if (wantsMenu) {
      this.log(source, 'contextmenu', `${Math.round(event.clientX)},${Math.round(event.clientY)}`);
    } else {
      this.log(source, 'tap', doubleTap ? `double-tap zoom @${Math.round(event.clientX)}` : `tap @${Math.round(event.clientX)},${Math.round(event.clientY)}`);
    }
    this.handlers.onGesture({
      panX: 0,
      panY: 0,
      zoomFactor: wantsMenu ? 1 : doubleTap ? 1.5 : 1,
      tapX: event.clientX,
      tapY: event.clientY,
      longPress: false,
      contextMenu: wantsMenu,
    });
  };

  private onPointerCancel = (event: PointerEvent): void => {
    this.clearLongPress();
    this.pointers.delete(event.pointerId);
    this.dragOrigin = null;
    this.dragLast = null;
  };

  private onWheel = (event: WheelEvent): void => {
    if (!this.onHost(event.target)) return;
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    this.handlers.onGesture({
      panX: 0,
      panY: 0,
      zoomFactor: factor,
      tapX: event.clientX,
      tapY: event.clientY,
      longPress: false,
      contextMenu: false,
    });
    this.log('mouse', 'zoom', `wheel ${event.deltaY}`);
  };

  private onContextMenu = (event: MouseEvent): void => {
    if (!this.onHost(event.target)) return;
    event.preventDefault();
    this.log('mouse', 'contextmenu', `${Math.round(event.clientX)},${Math.round(event.clientY)}`);
    this.handlers.onGesture({
      panX: 0,
      panY: 0,
      zoomFactor: 1,
      tapX: event.clientX,
      tapY: event.clientY,
      longPress: false,
      contextMenu: true,
    });
  };

  private clearLongPress(): void {
    if (this.longPressTimer !== null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  /** Call from the rAF loop; polls gamepads and turns edges into actions. */
  pollGamepad(): { connected: boolean; id: string; axes: { x: number; y: number }; buttons: number[] } {
    const nav = navigator as Navigator & { getGamepads?: () => ArrayLike<Gamepad | null> };
    if (typeof nav.getGamepads !== 'function') {
      return { connected: false, id: '', axes: { x: 0, y: 0 }, buttons: [] };
    }
    const pads = nav.getGamepads();
    for (const pad of Array.from(pads)) {
      if (!pad) continue;
      const mask = pad.buttons.reduce(
        (acc, button, index) => (button.pressed ? acc | (1 << index) : acc),
        0,
      );
      const edge = mask & ~this.gamepadMask;
      this.gamepadMask = mask;
      let consumed = false;
      for (let button = 0; button < 32; button++) {
        if (!(edge & (1 << button))) continue;
        const handled = this.handlers.onGamepadButton?.(button) ?? false;
        if (handled) consumed = true;
        else {
          for (const [action, mapped] of Object.entries(this.gamepadMap) as Array<[ActionId, number]>) {
            if (mapped !== button) continue;
            this.log('gamepad', action, `${GAMEPAD_BUTTON_NAMES[button] ?? `button ${button}`} on "${pad.id}"`);
            this.handlers.onAction(action, 'gamepad');
          }
        }
      }
      void consumed;
      const axes = { x: pad.axes[0] ?? 0, y: pad.axes[1] ?? 0 };
      const axisEdgeX = Math.abs(axes.x) > AXIS_DEADZONE && Math.abs(this.gamepadAxes.x) <= AXIS_DEADZONE;
      const axisEdgeY = Math.abs(axes.y) > AXIS_DEADZONE && Math.abs(this.gamepadAxes.y) <= AXIS_DEADZONE;
      const axisReleasedX = Math.abs(axes.x) <= AXIS_DEADZONE;
      const axisReleasedY = Math.abs(axes.y) <= AXIS_DEADZONE;
      if (axisEdgeY) {
        const action: ActionId = axes.y < 0 ? 'up' : 'down';
        this.log('gamepad', action, `axis ${axes.y.toFixed(2)}`);
        this.handlers.onAction(action, 'gamepad');
      }
      if (axisEdgeX) {
        const action: ActionId = axes.x < 0 ? 'left' : 'right';
        this.log('gamepad', action, `axis ${axes.x.toFixed(2)}`);
        this.handlers.onAction(action, 'gamepad');
      }
      if (axisReleasedX || axisReleasedY) {
        this.gamepadAxes = { x: axes.x, y: axes.y };
      } else {
        this.gamepadAxes = { x: axes.x, y: axes.y };
      }
      return {
        connected: true,
        id: pad.id,
        axes,
        buttons: pad.buttons.map((button) => (button.pressed ? 1 : 0)),
      };
    }
    this.gamepadMask = 0;
    return { connected: false, id: '', axes: { x: 0, y: 0 }, buttons: [] };
  }

  /** Simulated DPad press for tests: identical path to a real keyboard event. */
  simulate(action: ActionId, source: InputSource = 'keyboard'): void {
    this.log(source, action, 'simulated');
    this.handlers.onAction(action, source);
  }

  simulateGamepadButton(button: number, id = 'Pocket Galaxy Probe Pad (standard)'): void {
    const pad = {
      id,
      index: 0,
      connected: true,
      mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, (_, index) => ({
        pressed: index === button,
        touched: index === button,
        value: index === button ? 1 : 0,
      })),
      timestamp: performance.now(),
      vibrationActuator: null,
    };
    const original = navigator.getGamepads;
    // The injected pad must look exactly like a browser-provided one, otherwise
    // the probe would only prove the probe.
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      writable: true,
      value: () => [pad],
    });
    this.pollGamepad();
    // Release: the next poll sees no pressed buttons and re-arms the edge.
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      writable: true,
      value: () => [
        { ...pad, buttons: pad.buttons.map((button) => ({ ...button, pressed: false, value: 0 })) },
      ],
    });
    this.pollGamepad();
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      writable: true,
      value: original ?? (() => []),
    });
  }
}
