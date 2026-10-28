/** Bounded navigation history independent of browser document URLs and application persistence. */
/** Stable availability snapshot for shortcut buttons. */
export interface TrailState {
  canBack: boolean;
  canForward: boolean;
}
/** Store page and document positions, preserving the current end position before a new visit. */
export class NavigationTrail<T> {
  private values: T[] = [];
  private index = -1;
  private listeners = new Set<() => void>();
  private state: TrailState = { canBack: false, canForward: false };
  constructor(
    private key: (value: T) => string,
    private limit = 150,
  ) {}
  /** Read the active location without mutating the trail. */
  current = () => this.values[this.index];
  /** Stable shortcut availability, independent of editor keystroke renders. */
  getSnapshot = () => this.state;
  /** Observe changes to available back/forward destinations. */
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private emit() {
    this.state = {
      canBack: this.index > 0,
      canForward: this.index + 1 < this.values.length,
    };
    for (const listener of this.listeners) listener();
  }
  /** Replace the current location's latest caret/scroll state without creating another history step. */
  replace(value: T) {
    if (this.index >= 0) this.values[this.index] = value;
  }
  /** A new visit drops the forward branch; equivalent locations refresh in place. */
  visit(value: T) {
    if (this.current() && this.key(this.current()) === this.key(value)) {
      this.replace(value);
      return;
    }
    this.values = [...this.values.slice(0, this.index + 1), value].slice(
      -this.limit,
    );
    this.index = this.values.length - 1;
    this.emit();
  }
  /** Return one earlier/later location, leaving bounds unchanged when there is no destination. */
  step(direction: -1 | 1): T | undefined {
    const next = this.index + direction;
    if (next < 0 || next >= this.values.length) return;
    this.index = next;
    this.emit();
    return this.current();
  }
}
