/** In-app page/caret/selection history for keyboard and mouse-side buttons; browser document navigation is suppressed. */
import { NavigationTrail } from "../core/navigation";
/** Routes contain only application identifiers; no imported URL is navigated. */
export interface AppLocation {
  page: string;
  entryId: string;
  chatEntry: string;
  chatTopic: string;
  settingsTab: string;
  reviewSession: string;
}
interface Bookmark {
  selector: string;
  path: number[];
  offset: number;
}
interface Position {
  route: AppLocation;
  start?: Bookmark;
  end?: Bookmark;
  input?: { selector: string; from: number; to: number };
  scroll: [string, number, number][];
  y: number;
  sidebar: boolean;
}
const trail = new NavigationTrail<Position>((p) =>
  JSON.stringify([p.route, p.start, p.end, p.input]),
);
let reader: (() => AppLocation) | undefined,
  apply: ((route: AppLocation, sidebar: boolean) => boolean) | undefined,
  restoring = false,
  pendingDirection: -1 | 1 | undefined,
  cancelPosition: (() => void) | undefined;
function selector(element: Element): string {
  if (element.id) return "#" + CSS.escape(element.id);
  if (element instanceof HTMLElement && element.dataset.blockid)
    return `[data-blockid="${CSS.escape(element.dataset.blockid)}"]`;
  if (element.getAttribute("aria-label"))
    return `${element.tagName.toLowerCase()}[aria-label="${CSS.escape(element.getAttribute("aria-label")!)}"]`;
  if (element === document.body) return "body";
  const parent = element.parentElement;
  return parent
    ? selector(parent) +
        ">" +
        element.tagName.toLowerCase() +
        `:nth-child(${[...parent.children].indexOf(element) + 1})`
    : "body";
}
function bookmark(node: Node, offset: number): Bookmark | undefined {
  const element = node instanceof Element ? node : node.parentElement;
  if (!element) return;
  const root = element.closest("[data-blockid]") ?? element;
  const path: number[] = [];
  for (let current: Node = node; current !== root;) {
    const parent = current.parentNode;
    if (!parent) return;
    path.unshift([...parent.childNodes].indexOf(current as ChildNode));
    current = parent;
  }
  return { selector: selector(root), path, offset };
}
function resolve(value: Bookmark): Node | null {
  let node: Node | null = document.querySelector(value.selector);
  for (const index of value.path) node = node?.childNodes[index] ?? null;
  return node;
}
function capture(): Position | undefined {
  if (!reader) return;
  const position: Position = {
    route: reader(),
    scroll: [],
    y: window.scrollY,
    sidebar: !!document.querySelector(".entry-chat-panel"),
  };
  for (const name of [
    ".main",
    ".chat-page .messages",
    ".chat-page .topic-items",
    ".knowledge-table-scroll",
  ]) {
    const node = document.querySelector<HTMLElement>(name);
    if (node) position.scroll.push([name, node.scrollLeft, node.scrollTop]);
  }
  const input = document.activeElement;
  if (
    (input instanceof HTMLInputElement ||
      input instanceof HTMLTextAreaElement) &&
    input.selectionStart !== null
  )
    position.input = {
      selector: selector(input),
      from: input.selectionStart,
      to: input.selectionEnd ?? input.selectionStart,
    };
  else {
    const range = window.getSelection()?.rangeCount
      ? window.getSelection()!.getRangeAt(0)
      : undefined;
    if (range && !document.querySelector('[role="dialog"],[role="menu"]')) {
      position.start = bookmark(range.startContainer, range.startOffset);
      position.end = bookmark(range.endContainer, range.endOffset);
    }
  }
  return position;
}
const frame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
/** Restore with instant scroll, preserving selection direction-independent offsets even after a lazy page mounts. */
async function restore(position: Position) {
  window.dispatchEvent(
    new CustomEvent("zhinexus:restore-position", {
      detail: {
        entryId: position.route.entryId,
        selector: position.start?.selector,
      },
    }),
  );
  for (let attempt = 0; attempt < 40; attempt++) {
    await frame();
    if (attempt === 2)
      window.dispatchEvent(
        new CustomEvent("zhinexus:restore-position", {
          detail: {
            entryId: position.route.entryId,
            selector: position.start?.selector,
          },
        }),
      );
    const input =
      position.input &&
      document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        position.input.selector,
      );
    const start = position.start && resolve(position.start),
      end = position.end && resolve(position.end);
    if ((position.input && !input) || (position.start && (!start || !end)))
      continue;
    if (input && position.input) {
      input.focus({ preventScroll: true });
      try {
        input.setSelectionRange(position.input.from, position.input.to);
      } catch {}
    } else if (start && end && position.start && position.end) {
      try {
        const range = document.createRange();
        const bound = (node: Node, n: number) =>
          Math.min(
            n,
            node.nodeType === Node.TEXT_NODE
              ? (node.textContent?.length ?? 0)
              : node.childNodes.length,
          );
        range.setStart(start, bound(start, position.start.offset));
        range.setEnd(end, bound(end, position.end.offset));
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      } catch {}
    }
    break;
  }
  for (const [name, left, top] of position.scroll)
    document.querySelector(name)?.scrollTo({ left, top, behavior: "instant" });
  window.scrollTo({ top: position.y, behavior: "instant" });
}
/** Global trail commands and availability shared by buttons, Alt-arrows and mouse-side buttons. */
export const navigationHistory = {
  subscribe: trail.subscribe,
  getSnapshot: trail.getSnapshot,
  captureCurrent() {
    if (restoring) return;
    const current = capture();
    if (
      current &&
      trail.current() &&
      JSON.stringify(current.route) === JSON.stringify(trail.current()!.route)
    ) {
      if (!current.input && trail.current()!.input) {
        current.input = trail.current()!.input;
        delete current.start;
        delete current.end;
      }
      trail.replace(current);
    }
  },
  record() {
    if (!restoring) {
      const next = capture();
      if (next) trail.visit(next);
    }
  },
  async go(direction: -1 | 1) {
    if (document.querySelector('[role="dialog"],[role="menu"]')) return;
    if (restoring) {
      pendingDirection = direction;
      return;
    }
    cancelPosition?.();
    const current = capture();
    if (
      current &&
      JSON.stringify(current.route) !== JSON.stringify(trail.current()?.route)
    )
      trail.visit(current);
    this.captureCurrent();
    const next = trail.step(direction);
    if (!next) return;
    restoring = true;
    try {
      if (apply?.(next.route, next.sidebar) === false) {
        trail.step(direction === -1 ? 1 : -1);
        return;
      }
      await restore(next);
    } finally {
      restoring = false;
      if (pendingDirection) {
        const pending = pendingDirection;
        pendingDirection = undefined;
        void this.go(pending);
      }
    }
  },
};
/** Connect route restoration once; native side buttons never fall through to browser Back/Forward. */
export function startNavigationHistory(
  read: () => AppLocation,
  navigate: (route: AppLocation, sidebar: boolean) => boolean,
) {
  reader = read;
  apply = navigate;
  let timer: ReturnType<typeof setTimeout> | undefined,
    lastEdit = 0;
  cancelPosition = () => clearTimeout(timer);
  const key = (event: KeyboardEvent) => {
    if (
      event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      ["ArrowLeft", "ArrowRight"].includes(event.key)
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (!event.isComposing && !event.repeat)
        void navigationHistory.go(event.key === "ArrowLeft" ? -1 : 1);
    }
  };
  const side = (event: MouseEvent) => {
    if (event.button === 3 || event.button === 4) {
      event.preventDefault();
      event.stopPropagation();
      if (event.type === "mousedown")
        void navigationHistory.go(event.button === 3 ? -1 : 1);
    }
  };
  const position = (event: Event) => {
    if (restoring || document.querySelector('[role="dialog"],[role="menu"]'))
      return;
    if (
      (event.target as HTMLElement | null)?.closest?.(
        "button,a,select,nav,.sidebar,.topbar,.entry-tabs",
      )
    )
      return;
    if (event instanceof MouseEvent && event.button !== 0) return;
    if (
      event instanceof KeyboardEvent &&
      (event.altKey ||
        event.isComposing ||
        ![
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown",
          "Home",
          "End",
        ].includes(event.key))
    )
      return;
    clearTimeout(timer);
    const originalRoute = JSON.stringify(reader?.());
    timer = setTimeout(
      () => {
        if (restoring || originalRoute !== JSON.stringify(reader?.())) return;
        const next = capture();
        if (!next) return;
        if (
          event.type === "input" &&
          Date.now() - lastEdit < 1500 &&
          JSON.stringify(next.route) === JSON.stringify(trail.current()?.route)
        )
          trail.replace(next);
        else trail.visit(next);
        lastEdit = event.type === "input" ? Date.now() : 0;
      },
      event.type === "input" ? 500 : 30,
    );
  };
  const scroll = () => {
    if (!restoring) navigationHistory.captureCurrent();
  };
  document.addEventListener("keydown", key, true);
  for (const name of ["mousedown", "mouseup", "auxclick"] as const)
    document.addEventListener(name, side, true);
  document.addEventListener("mouseup", position);
  document.addEventListener("keyup", position);
  document.addEventListener("input", position);
  window.addEventListener("scroll", scroll, true);
  navigationHistory.record();
  return () => {
    clearTimeout(timer);
    cancelPosition = undefined;
    pendingDirection = undefined;
    reader = undefined;
    apply = undefined;
    document.removeEventListener("keydown", key, true);
    for (const name of ["mousedown", "mouseup", "auxclick"] as const)
      document.removeEventListener(name, side, true);
    document.removeEventListener("mouseup", position);
    document.removeEventListener("keyup", position);
    document.removeEventListener("input", position);
    window.removeEventListener("scroll", scroll, true);
  };
}
