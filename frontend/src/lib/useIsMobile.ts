import { useEffect, useState } from "react";

const MQ = "(max-width: 767px)";

export function useIsMobile(): boolean {
  const [matches, setMatches] = useState<boolean>(() =>
    typeof window !== "undefined" ? window.matchMedia(MQ).matches : false
  );

  useEffect(() => {
    const mql = window.matchMedia(MQ);
    const fn = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", fn);
    return () => mql.removeEventListener("change", fn);
  }, []);

  return matches;
}
