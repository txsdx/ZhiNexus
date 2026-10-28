/** FSRS curve reconstruction uses recorded card states, with future projections explicitly separated from history. */
import { fsrs, type Card } from "ts-fsrs";
import type { Doc, Entry } from "./types";
import { reviveCard } from "./review";
const predictor = fsrs({ enable_fuzz: false });
/** One recorded learning state; no values are invented before the first known learning/review event. */
export function curveHistory(entry: Entry, docs: Doc[]): Card[] {
  const cards = new Map<number, Card>();
  const latest = entry.card.last_review?.getTime();
  if (!latest) return [];
  for (const event of docs.find(
    (d) => d.collection === "entry" && d.id === entry.id,
  )?.history ?? []) {
    const raw = event.op.patch.card;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const card = reviveCard(raw as unknown as Card),
        at = card.last_review?.getTime();
      if (
        at &&
        at <= latest &&
        Number.isFinite(at) &&
        card.stability > 0 &&
        card.reps > 0
      )
        cards.set(at, card);
    }
  }
  if (entry.card.last_review && entry.card.stability > 0 && entry.card.reps > 0)
    cards.set(entry.card.last_review.getTime(), entry.card);
  return [...cards.values()].sort(
    (a, b) => a.last_review!.getTime() - b.last_review!.getTime(),
  );
}
/** Evaluate the newest state known at that point in time; elapsed time is continuous days. */
export function curveRecall(cards: Card[], at: number): number | null {
  let card: Card | undefined;
  for (const candidate of cards) {
    if (candidate.last_review!.getTime() > at) break;
    card = candidate;
  }
  if (!card) return null;
  const value = predictor.forgetting_curve(
    (at - card.last_review!.getTime()) / 86400000,
    card.stability,
  );
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null;
}
/** Stable distinct hues identify the same entry across view counts and ordering changes. */
function hue(id: string) {
  let hash = 0;
  for (const char of id) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) | 0;
  return Math.abs(hash) % 360;
}
/** Resolve collisions and nearby hues so the currently visible curves remain distinguishable. */
export function curvePalette(ids: string[]): Map<string, string> {
  const used: number[] = [],
    result = new Map<string, string>(),
    gap = Math.min(35, 260 / Math.max(1, ids.length));
  for (const id of [...ids].sort()) {
    let color = hue(id);
    for (
      let attempts = 0;
      attempts < 2000 &&
      used.some(
        (other) =>
          Math.min(Math.abs(other - color), 360 - Math.abs(other - color)) <
          gap,
      );
      attempts++
    )
      color = (color + 137.508) % 360;
    used.push(color);
    result.set(id, `hsl(${color.toFixed(3)} 62% var(--curve-lightness, 44%))`);
  }
  return result;
}
