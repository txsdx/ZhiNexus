/** Restrained semantic colors stored as tokens, never arbitrary CSS from models or imported knowledge. */
export const entryColors = [
  "none",
  "red",
  "green",
  "blue",
  "yellow",
  "purple",
] as const;
/** Shared palette contract used by menus, validation and Agent tools. */
export type EntryColor = (typeof entryColors)[number];
