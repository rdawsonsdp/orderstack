"use client";

import { useEffect } from "react";

/** Pops the OS print dialog on load; the button covers re-prints. */
export function PrintTrigger() {
  useEffect(() => {
    const id = setTimeout(() => window.print(), 300);
    return () => clearTimeout(id);
  }, []);
  return <button onClick={() => window.print()}>🖨 Print again</button>;
}
