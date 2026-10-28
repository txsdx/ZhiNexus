/** Interactive past/future FSRS recall curves, with wheel panning and entry navigation. */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  curvePalette,
  curveHistory,
  curveRecall,
} from "../core/forgetting-curves";
import { memoryEstimate } from "../core/knowledge-view";
import { reviewTarget } from "../core/review-policy";
import { useKnowledge, useT } from "../components/common";
import { useReviewClock } from "../hooks/useReviewClock";
import { store } from "../core/store";
const day = 86400000,
  left = 58,
  top = 26,
  right = 22,
  bottom = 46;
let rememberedOffset = 0;
/** Chart controls are device-local and autosaved; historical curves never guess unrecorded learning. */
export function ForgettingCurves({
  onOpen,
  notify,
}: {
  onOpen: (id: string) => void;
  notify: (message: string) => void;
}) {
  const s = useKnowledge(),
    t = useT(),
    now = useReviewClock(),
    saved = s.device.curveView;
  const [limit, setLimit] = useState(saved?.limit ?? 20),
    [maxRecall, setMaxRecall] = useState(saved?.maxRecall ?? 100),
    [past, setPast] = useState(saved?.past ?? 14),
    [future, setFuture] = useState(saved?.future ?? 30),
    [offset, setOffset] = useState(rememberedOffset);
  const [size, setSize] = useState({ width: 1200, height: 540 });
  const { width, height } = size;
  const [hover, setHover] = useState<{
      id: string;
      title: string;
      at: number;
      r: number;
      x: number;
      y: number;
    } | null>(null),
    plot = useRef<SVGSVGElement>(null),
    target = reviewTarget(s.docs);
  useEffect(() => {
    const node = plot.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      const next = {
        width: Math.max(320, Math.round(entry.contentRect.width)),
        height: Math.max(260, Math.round(entry.contentRect.height)),
      };
      setSize((previous) =>
        previous.width === next.width && previous.height === next.height
          ? previous
          : next,
      );
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const initial = useRef(JSON.stringify({ limit, maxRecall, past, future }));
  const span = (past + future) * day,
    start = now.getTime() - past * day + offset * day,
    end = start + span,
    plotWidth = width - left - right,
    plotHeight = height - top - bottom;
  const curves = useMemo(() => {
    const docs = new Map(
      s.docs.filter((d) => d.collection === "entry").map((d) => [d.id, d]),
    );
    return s.entries
      .map((entry) => ({ entry, r: memoryEstimate(entry, now) }))
      .filter((curve) => curve.r !== null && curve.r * 100 <= maxRecall)
      .sort((a, b) => a.r! - b.r!)
      .slice(0, limit)
      .map(({ entry }) => ({
        entry,
        cards: curveHistory(
          entry,
          docs.has(entry.id) ? [docs.get(entry.id)!] : [],
        ),
      }));
  }, [s.entries, s.docs, now, maxRecall, limit]);
  useEffect(() => {
    rememberedOffset = offset;
  }, [offset]);
  useEffect(() => {
    const value = { limit, maxRecall, past, future },
      signature = JSON.stringify(value);
    if (signature === initial.current) return;
    const timer = setTimeout(
      () =>
        void store.updateDevice({ curveView: value }).then(
          () => {
            initial.current = signature;
          },
          (error) => notify(String(error.message)),
        ),
      500,
    );
    return () => clearTimeout(timer);
  }, [limit, maxRecall, past, future]);
  useEffect(() => {
    const node = plot.current;
    if (!node) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const multiplier = event.deltaY > 0 ? 1.15 : 1 / 1.15;
        setPast((value) =>
          Math.max(1, Math.min(365, Math.round(value * multiplier))),
        );
        setFuture((value) =>
          Math.max(1, Math.min(365, Math.round(value * multiplier))),
        );
      } else
        setOffset(
          (value) =>
            value + ((event.deltaX || event.deltaY) / 600) * (past + future),
        );
      setHover(null);
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, [past, future]);
  const x = (at: number) => left + ((at - start) / span) * plotWidth,
    y = (r: number) => top + (1 - r) * plotHeight;
  const paths = useMemo(() => {
    const palette = curvePalette(curves.map((curve) => curve.entry.id));
    return curves.map(({ entry, cards }) => {
      const times = new Set(
        Array.from({ length: 181 }, (_, i) => start + (i * span) / 180),
      );
      for (const card of cards) {
        const at = card.last_review!.getTime();
        if (at >= start && at <= end) {
          times.add(at - 1);
          times.add(at);
        }
      }
      let drawing = false;
      const path = [...times]
        .sort((a, b) => a - b)
        .map((at) => {
          const r = curveRecall(cards, at);
          if (r === null) {
            drawing = false;
            return "";
          }
          const command = drawing ? "L" : "M";
          drawing = true;
          return `${command}${x(at).toFixed(2)},${y(r).toFixed(2)}`;
        })
        .join(" ");
      return { entry, path, color: palette.get(entry.id)! };
    });
  }, [curves, start, end, span, width, height]);
  const nearest = (event: React.MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect(),
      px = ((event.clientX - rect.left) / rect.width) * width,
      py = ((event.clientY - rect.top) / rect.height) * height;
    if (px < left || px > width - right || py < top || py > height - bottom)
      return null;
    const at = start + ((px - left) / plotWidth) * span;
    let best: {
        id: string;
        title: string;
        at: number;
        r: number;
        x: number;
        y: number;
      } | null = null,
      distance = 12;
    for (const { entry, cards } of curves) {
      const r = curveRecall(cards, at);
      if (r === null) continue;
      const delta = Math.abs(y(r) - py);
      if (delta < distance) {
        distance = delta;
        best = {
          id: entry.id,
          title: entry.title,
          at,
          r,
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        };
      }
    }
    return best;
  };
  return (
    <div className="page curves-page">
      <div className="page-heading">
        <h1>{t("遗忘曲线", "Forgetting curves")}</h1>
        <button onClick={() => setOffset(0)}>{t("回到今天", "Today")}</button>
      </div>
      <div className="curve-controls">
        <label>
          {t("展示条目数量", "Entry limit")}
          <input
            aria-label={t("展示条目数量", "Entry limit")}
            type="number"
            min={1}
            max={100}
            value={limit}
            onChange={(e) =>
              setLimit(Math.max(1, Math.min(100, Number(e.target.value) || 1)))
            }
          />
        </label>
        <label>
          {t("当前回忆概率上限", "Current recall ceiling")}
          <input
            aria-label={t("当前回忆概率上限", "Current recall ceiling")}
            type="number"
            min={0}
            max={100}
            value={maxRecall}
            onChange={(e) =>
              setMaxRecall(Math.max(0, Math.min(100, Number(e.target.value))))
            }
          />
          %
        </label>
        <label>
          {t("过去天数", "Past days")}
          <input
            aria-label={t("过去天数", "Past days")}
            type="number"
            min={1}
            max={365}
            value={past}
            onChange={(e) =>
              setPast(Math.max(1, Math.min(365, Number(e.target.value) || 1)))
            }
          />
        </label>
        <label>
          {t("未来天数", "Future days")}
          <input
            aria-label={t("未来天数", "Future days")}
            type="number"
            min={1}
            max={365}
            value={future}
            onChange={(e) =>
              setFuture(Math.max(1, Math.min(365, Number(e.target.value) || 1)))
            }
          />
        </label>
        <span>
          {t(
            `复习目标 ${Math.round(target * 100)}%`,
            `Review target ${Math.round(target * 100)}%`,
          )}
        </span>
      </div>
      <div className="curve-plot">
        <svg
          ref={plot}
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={t(
            "预计回忆概率随时间变化，滚轮平移时间轴",
            "Predicted recall over time; scroll to pan time",
          )}
          onMouseMove={(e) => setHover(nearest(e))}
          onMouseLeave={() => setHover(null)}
          onClick={(event) => {
            const curve = nearest(event);
            if (curve) onOpen(curve.id);
          }}
        >
          <defs>
            <clipPath id="curve-area">
              <rect x={left} y={top} width={plotWidth} height={plotHeight} />
            </clipPath>
          </defs>
          {Array.from({ length: 6 }, (_, i) => {
            const r = i / 5;
            return (
              <g key={r}>
                <line
                  x1={left}
                  x2={width - right}
                  y1={y(r)}
                  y2={y(r)}
                  stroke="var(--border)"
                />
                <text x={left - 10} y={y(r) + 4} textAnchor="end">
                  {Math.round(r * 100)}%
                </text>
              </g>
            );
          })}
          {Array.from({ length: 7 }, (_, i) => {
            const at = start + (i * span) / 6;
            return (
              <text
                key={i}
                x={x(at)}
                y={height - 17}
                textAnchor="middle"
                data-axis-time={at}
              >
                {new Date(at).toLocaleDateString(undefined, {
                  month: "2-digit",
                  day: "2-digit",
                })}
              </text>
            );
          })}
          <g clipPath="url(#curve-area)">
            <rect
              x={Math.max(left, x(now.getTime()))}
              y={top}
              width={Math.max(
                0,
                width - right - Math.max(left, x(now.getTime())),
              )}
              height={plotHeight}
              fill="var(--soft)"
              opacity={0.28}
            />
            <line
              x1={left}
              x2={width - right}
              y1={y(target)}
              y2={y(target)}
              stroke="#bf5151"
              strokeDasharray="7 5"
              data-review-threshold={target}
            />
            {paths.map(({ entry, path, color }) => (
              <path
                key={entry.id}
                d={path}
                fill="none"
                stroke={color}
                strokeWidth={hover?.id === entry.id ? 3 : 1.7}
                opacity={hover && hover.id !== entry.id ? 0.65 : 1}
                tabIndex={0}
                role="link"
                aria-label={entry.title}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onOpen(entry.id);
                  }
                }}
              >
                <title>{entry.title}</title>
              </path>
            ))}
            <line
              x1={x(now.getTime())}
              x2={x(now.getTime())}
              y1={top}
              y2={height - bottom}
              stroke="var(--text)"
              strokeDasharray="3 5"
            />
          </g>
          {x(now.getTime()) >= left && x(now.getTime()) <= width - right && (
            <text x={x(now.getTime()) + 5} y={top + 14}>
              {t("现在", "Now")}
            </text>
          )}
        </svg>
        {hover && (
          <div
            className="curve-tooltip"
            style={{
              left: Math.max(
                4,
                Math.min(
                  hover.x + 12,
                  (plot.current?.clientWidth ?? 300) - 240,
                ),
              ),
              top: Math.max(4, hover.y - 65),
            }}
          >
            <strong>{hover.title}</strong>
            <span>
              {new Date(hover.at).toLocaleString()} ·{" "}
              {(hover.r * 100).toFixed(1)}%
            </span>
          </div>
        )}
        {!curves.length && (
          <div className="curve-empty">
            {t(
              "当前筛选下没有可计算的学习记录",
              "No recorded learning matches the current filters",
            )}
          </div>
        )}
      </div>
      <div className="curve-legend">
        {paths.map(({ entry, color }) => (
          <button key={entry.id} onClick={() => onOpen(entry.id)}>
            <i style={{ background: color }} />
            {entry.title}
          </button>
        ))}
      </div>
      <small>
        {t(
          "曲线是 FSRS 估计，右侧为未来预测。滚轮平移，Ctrl+滚轮缩放；初始记录按“已学习”假设建立，实际复习会更新估计。",
          "FSRS estimates; the right side projects the future. Scroll to pan, Ctrl+scroll to zoom. Initial records assume prior learning; actual reviews refine the estimate.",
        )}
      </small>
    </div>
  );
}
