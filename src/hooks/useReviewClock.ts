/** Minute-resolution review UI updates also catch up immediately after a hidden window resumes. */
import { useEffect, useState } from "react";
/** Recalculate future due thresholds without relying on an unrelated database mutation to rerender. */
export function useReviewClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date()),
      id = setInterval(tick, 60000);
    const visible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  return now;
}
