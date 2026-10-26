/** Typed context keeps configuration panels modular without duplicating state or persistence. */
import { createContext, useContext } from "react";
import type { SettingsValue } from "./controller";
export const SettingsContext = createContext<SettingsValue | null>(null);
/** Require the settings state provider before accessing configuration drafts. */
/** useSettings exposes one focused settings workflow. */
export function useSettings() {
  const value = useContext(SettingsContext);
  if (!value) throw Error("Settings provider missing");
  return value;
}
