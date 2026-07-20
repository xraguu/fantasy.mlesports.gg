"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface Position {
  top: number;
  left: number;
  align: "left" | "center" | "right";
  placement: "above" | "below";
}

/**
 * Wraps an abbreviated table column header (e.g. "Fprk") so hovering it
 * shows the spelled-out label (e.g. "Fantasy Points Rank") in a small
 * tooltip. Meant to be dropped straight inside a <th>.
 *
 * Renders the tooltip through a portal into document.body, positioned with
 * `fixed` coordinates computed from the trigger's real screen position on
 * hover — most of the tables this sits in scroll horizontally inside an
 * `overflow-x: auto` wrapper, and an absolutely-positioned tooltip nested
 * inside one of those gets clipped by it. Escaping to a portal sidesteps
 * that entirely. Position is also clamped so tooltips near a screen edge
 * flip alignment (or flip below instead of above) instead of running off.
 */
export default function HeaderTooltip({
  label,
  full,
}: {
  label: string;
  full: string;
}) {
  const [pos, setPos] = useState<Position | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);

  const show = () => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const gap = 8;
    // No DOM measurement of the tooltip itself yet (it isn't rendered
    // until `pos` is set) — a rough per-character estimate is close enough
    // at this font size to decide whether it'd clip a screen edge.
    const estimatedWidth = full.length * 6.5 + 26;

    let align: Position["align"] = "center";
    const centeredLeft = rect.left + rect.width / 2 - estimatedWidth / 2;
    if (centeredLeft < 8) {
      align = "left";
    } else if (centeredLeft + estimatedWidth > window.innerWidth - 8) {
      align = "right";
    }

    const placement: Position["placement"] =
      rect.top < 56 ? "below" : "above";

    setPos({
      top: placement === "above" ? rect.top - gap : rect.bottom + gap,
      left:
        align === "left"
          ? rect.left
          : align === "right"
          ? rect.right
          : rect.left + rect.width / 2,
      align,
      placement,
    });
  };

  const hide = () => setPos(null);

  // The tooltip's position is computed once, on hover-in, from the
  // trigger's screen coordinates at that moment — if the page (or any
  // scrollable ancestor, e.g. a table's own overflow-x wrapper) scrolls
  // while it's still showing, those coordinates go stale and it visually
  // detaches from its trigger until the mouse moves enough to fire
  // mouseleave. Simplest correct fix: just dismiss it on any scroll, same
  // as most tooltip implementations do, rather than continuously
  // recomputing position to track the trigger. `capture: true` so this
  // catches scrolling on an inner container too, not just the window.
  useEffect(() => {
    if (!pos) return;
    const dismiss = () => setPos(null);
    window.addEventListener("scroll", dismiss, { capture: true, passive: true });
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("scroll", dismiss, { capture: true });
      window.removeEventListener("resize", dismiss);
    };
  }, [pos]);

  return (
    <span
      ref={triggerRef}
      onMouseEnter={show}
      onMouseLeave={hide}
      style={{
        position: "relative",
        display: "inline-block",
        cursor: "help",
        borderBottom: "1px dotted currentColor",
      }}
    >
      {label}
      {pos &&
        typeof document !== "undefined" &&
        createPortal(
          <span
            role="tooltip"
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              transform: `translate(${
                pos.align === "left" ? "0" : pos.align === "right" ? "-100%" : "-50%"
              }, ${pos.placement === "above" ? "-100%" : "0"})`,
              backgroundColor: "#1a1a2e",
              color: "#f5f6f7",
              padding: "0.35rem 0.65rem",
              borderRadius: "6px",
              fontSize: "0.75rem",
              fontWeight: 600,
              textTransform: "none",
              letterSpacing: "normal",
              whiteSpace: "nowrap",
              zIndex: 9999,
              boxShadow: "0 4px 12px rgba(0,0,0,0.35)",
              border: "1px solid rgba(255,255,255,0.15)",
              pointerEvents: "none",
            }}
          >
            {full}
          </span>,
          document.body
        )}
    </span>
  );
}
