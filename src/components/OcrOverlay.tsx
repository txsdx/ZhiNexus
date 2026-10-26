/** Database-free screenshot overlay mapping logical pointer coordinates onto captured physical pixels. */
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
interface Frame {
  id: string;
  width: number;
  height: number;
  image: string;
}
interface Point {
  x: number;
  y: number;
}
/** Drag a region or press Escape; a screenshot remains transient until its result is saved as an entry. */
export function OcrOverlay() {
  const [frame, setFrame] = useState<Frame | null>(null),
    [start, setStart] = useState<Point | null>(null),
    [end, setEnd] = useState<Point | null>(null),
    [error, setError] = useState("");
  const image = useRef<HTMLImageElement>(null),
    busy = useRef(false);
  const cancel = () =>
    void invoke("cancel_ocr_capture").catch((e) => setError(String(e)));
  useEffect(() => {
    void invoke<Frame>("ocr_frame")
      .then(setFrame)
      .catch((e) => setError(String(e)));
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const point = (event: React.PointerEvent): Point => {
    const rect = image.current!.getBoundingClientRect();
    return {
      x: Math.min(rect.width, Math.max(0, event.clientX - rect.left)),
      y: Math.min(rect.height, Math.max(0, event.clientY - rect.top)),
    };
  };
  return (
    <div
      className="ocr-overlay"
      onPointerDown={(event) => {
        if (!frame || busy.current || event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        const p = point(event);
        setStart(p);
        setEnd(p);
      }}
      onPointerMove={(event) => {
        if (start && !busy.current) setEnd(point(event));
      }}
      onPointerUp={(event) => {
        if (!frame || !start || busy.current) return;
        const end = point(event),
          rect = image.current!.getBoundingClientRect();
        const x = Math.floor(
            (Math.min(start.x, end.x) * frame.width) / rect.width,
          ),
          y = Math.floor(
            (Math.min(start.y, end.y) * frame.height) / rect.height,
          );
        const right = Math.min(
            frame.width,
            Math.ceil((Math.max(start.x, end.x) * frame.width) / rect.width),
          ),
          bottom = Math.min(
            frame.height,
            Math.ceil((Math.max(start.y, end.y) * frame.height) / rect.height),
          );
        if (right - x < 4 || bottom - y < 4) {
          setStart(null);
          setEnd(null);
          return;
        }
        busy.current = true;
        void invoke("finish_ocr_capture", {
          id: frame.id,
          x,
          y,
          width: right - x,
          height: bottom - y,
        }).catch((e) => {
          setError(String(e));
          busy.current = false;
          setStart(null);
          setEnd(null);
        });
      }}
    >
      {frame && (
        <img
          ref={image}
          draggable={false}
          src={frame.image}
          alt="Screenshot selection"
        />
      )}
      {start && end && (
        <div
          className="ocr-region"
          style={{
            left: Math.min(start.x, end.x),
            top: Math.min(start.y, end.y),
            width: Math.abs(end.x - start.x),
            height: Math.abs(end.y - start.y),
          }}
        />
      )}
      <div className="ocr-guide" onPointerDown={(e) => e.stopPropagation()}>
        拖动框选识别区域 · Drag to select · Esc{" "}
        {error && <p role="alert">{error}</p>}
        <button onClick={cancel}>取消 / Cancel</button>
      </div>
    </div>
  );
}
