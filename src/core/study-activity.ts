/** Learning activity is derived from real immutable creation/completion records, never card priors or AI estimates. */
import type { Doc } from "./types";
/** One real action can be inspected without exposing deleted entry content. */
export interface StudyEvent {
  id: string;
  entryId: string;
  kind: "created" | "reviewed";
  title: string;
  deleted: boolean;
}
/** Calendar days use the device's local timezone and calendar arithmetic across DST. */
export interface StudyDay {
  key: string;
  date: Date;
  events: StudyEvent[];
}
/** Produce a stable local calendar key instead of UTC's occasionally different date. */
export function studyDayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
/** Reconstruct 26 weeks, including deleted history as non-navigable records, and exclude future/unfinished work. */
export function studyActivity(docs: Doc[], now = new Date()) {
  const buckets = new Map<string, StudyEvent[]>(),
    entries = new Map(
      docs
        .filter((doc) => doc.collection === "entry")
        .map((doc) => [doc.id, doc]),
    );
  const add = (at: unknown, event: StudyEvent) => {
    if (
      typeof at !== "string" ||
      !Number.isFinite(Date.parse(at)) ||
      Date.parse(at) > now.getTime()
    )
      return;
    const key = studyDayKey(new Date(at));
    buckets.set(key, [...(buckets.get(key) ?? []), event]);
  };
  for (const doc of docs) {
    if (doc.collection === "entry")
      add(doc.fields.createdAt, {
        id: "created:" + doc.id,
        entryId: doc.id,
        kind: "created",
        title: String(doc.fields.title ?? doc.id),
        deleted: doc.fields.deleted === true,
      });
    if (
      doc.collection === "review" &&
      doc.fields.phase === "done" &&
      doc.fields.deleted !== true
    ) {
      const entry = entries.get(String(doc.fields.entryId)),
        completion =
          doc.fields.completedAt ??
          doc.history
            .filter((event) => event.op.patch.phase === "done")
            .map((event) => event.op.at)
            .sort()[0];
      add(completion, {
        id: "review:" + doc.id,
        entryId: String(doc.fields.entryId),
        kind: "reviewed",
        title: String(entry?.fields.title ?? doc.fields.entryId),
        deleted: !entry || entry.fields.deleted === true,
      });
    }
  }
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()),
    start = new Date(today);
  start.setDate(start.getDate() - start.getDay() - 25 * 7);
  const days: StudyDay[] = [];
  for (
    let date = new Date(start);
    date <= today;
    date.setDate(date.getDate() + 1)
  ) {
    const key = studyDayKey(date);
    days.push({ key, date: new Date(date), events: buckets.get(key) ?? [] });
  }
  let streak = 0;
  const cursor = new Date(today);
  if (!buckets.has(studyDayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (buckets.has(studyDayKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return {
    days,
    streak,
    activeDays: days.filter((day) => day.events.length).length,
    created: days.reduce(
      (count, day) =>
        count + day.events.filter((event) => event.kind === "created").length,
      0,
    ),
    reviewed: days.reduce(
      (count, day) =>
        count + day.events.filter((event) => event.kind === "reviewed").length,
      0,
    ),
  };
}
