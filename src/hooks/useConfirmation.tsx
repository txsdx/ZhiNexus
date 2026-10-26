/** Application-owned confirmation UI that never treats a pending Promise as consent. */
import { useEffect, useRef, useState } from "react";
import { Modal, useT } from "../components/common";
import { runConfirmed } from "../core/confirmation";

/** Await a clear choice; dismissals and unmounts cancel, while failures go to the caller's feedback. */
export function useConfirmation(
  onError: (message: string) => void,
  options: { title?: string; confirmLabel?: string } = {},
) {
  const t = useT();
  const [description, setDescription] = useState<string | null>(null);
  const pending = useRef<((ok: boolean) => void) | null>(null);
  const working = useRef(false);
  useEffect(
    () => () => {
      pending.current?.(false);
      pending.current = null;
    },
    [],
  );

  const settle = (ok: boolean) => {
    const resolve = pending.current;
    pending.current = null;
    setDescription(null);
    resolve?.(ok);
  };
  const ask = (text: string): Promise<boolean> => {
    if (pending.current) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      pending.current = resolve;
      setDescription(text);
    });
  };
  const request = async (text: string, action: () => Promise<void>) => {
    if (working.current) return;
    working.current = true;
    try {
      await runConfirmed(() => ask(text), action);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      working.current = false;
    }
  };

  const dialog =
    description === null ? null : (
      <Modal
        title={options.title ?? t("确认删除", "Confirm deletion")}
        onClose={() => settle(false)}
      >
        <p>{description}</p>
        <div className="actions">
          <button autoFocus onClick={() => settle(false)}>
            {t("取消", "Cancel")}
          </button>
          <button className="danger" onClick={() => settle(true)}>
            {options.confirmLabel ?? t("确认删除", "Confirm deletion")}
          </button>
        </div>
      </Modal>
    );
  return { ask, request, dialog };
}
