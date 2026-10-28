/** Context menu requests carry executable application callbacks, never model-provided code. */
/** One menu row can execute an action or open a finite submenu. */
export interface MenuItem {
  label: string;
  run?: () => void | Promise<void>;
  children?: MenuItem[];
  disabled?: boolean;
  danger?: boolean;
  color?: string;
}
const handled = new WeakSet<Event>();
/** Let a rich editor override the generic clipboard menu without losing its model selection. */
export function openContextMenu(event: MouseEvent, items: MenuItem[]) {
  event.preventDefault();
  handled.add(event);
  window.dispatchEvent(
    new CustomEvent("zhinexus:context-menu", {
      detail: {
        x: event.clientX,
        y: event.clientY,
        items,
        keyboard: event.clientX === 0 && event.clientY === 0,
      },
    }),
  );
}
/** Determine whether the target already supplied a more specific menu. */
export const contextMenuHandled = (event: Event) => handled.has(event);
