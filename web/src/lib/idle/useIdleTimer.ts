"use client";

import { useEffect, useRef } from "react";

const ACTIVITY_EVENTS = ["mousemove", "keydown", "click", "scroll"] as const;

/**
 * Fires `onIdle` once after `timeoutMs` of no DOM activity (mousemove,
 * keydown, click, scroll); any of those events resets the timer. Pure
 * timeout-minutes-agnostic primitive — reads no localStorage itself, the
 * call site (Sidebar/page.tsx) supplies the configured timeout.
 */
export function useIdleTimer(timeoutMs: number, onIdle: () => void): void {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function reset() {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(onIdle, timeoutMs);
    }

    reset();

    for (const eventName of ACTIVITY_EVENTS) {
      window.addEventListener(eventName, reset, { passive: true });
    }

    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
      }
      for (const eventName of ACTIVITY_EVENTS) {
        window.removeEventListener(eventName, reset);
      }
    };
  }, [timeoutMs, onIdle]);
}
