"use client";

import { useRef, useState } from "react";

interface UserOption {
  id: string;
  displayName: string;
}

/**
 * A type-to-search replacement for a long <select> of users: typing filters
 * the list by display name, and picking one (click, or arrow keys + Enter)
 * sets it. `users` should already be sorted the way the list should show.
 */
export default function UserSearchSelect({
  users,
  value,
  onChange,
  placeholder = "Search for a user...",
}: {
  users: UserOption[];
  value: string;
  onChange: (userId: string) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = users.find((user) => user.id === value) ?? null;
  const matches = users.filter((user) =>
    user.displayName.toLowerCase().includes(query.trim().toLowerCase()),
  );

  const pick = (user: UserOption) => {
    onChange(user.id);
    setQuery("");
    setOpen(false);
    // Leave the field so typing again starts a fresh search
    inputRef.current?.blur();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlighted((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      // Never submit the surrounding form from here
      e.preventDefault();
      if (open && matches[highlighted]) pick(matches[highlighted]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div style={{ position: "relative" }}>
      <input
        ref={inputRef}
        type="text"
        value={open ? query : selected?.displayName ?? ""}
        placeholder={selected ? selected.displayName : placeholder}
        onFocus={() => {
          setQuery("");
          setHighlighted(0);
          setOpen(true);
        }}
        // Delay so a click on a list item lands before the list closes
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setQuery(e.target.value);
          setHighlighted(0);
          setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        style={{
          width: "100%",
          padding: "0.6rem",
          background: "rgba(255,255,255,0.1)",
          border: "1px solid rgba(255,255,255,0.2)",
          borderRadius: "6px",
          color: "var(--text-main)",
          fontSize: "0.9rem",
        }}
      />
      {open && (
        <div
          role="listbox"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            maxHeight: "240px",
            overflowY: "auto",
            background: "#1a1a2e",
            border: "1px solid rgba(255,255,255,0.2)",
            borderRadius: "6px",
            boxShadow: "0 8px 20px rgba(0,0,0,0.4)",
            zIndex: 10,
          }}
        >
          {matches.length === 0 ? (
            <div style={{ padding: "0.6rem", fontSize: "0.85rem", color: "var(--text-muted)" }}>
              No users match &quot;{query}&quot;
            </div>
          ) : (
            matches.map((user, i) => (
              <div
                key={user.id}
                role="option"
                aria-selected={user.id === value}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(user);
                }}
                onMouseEnter={() => setHighlighted(i)}
                style={{
                  padding: "0.5rem 0.6rem",
                  fontSize: "0.9rem",
                  cursor: "pointer",
                  color: user.id === value ? "var(--accent)" : "var(--text-main)",
                  fontWeight: user.id === value ? 700 : 400,
                  background: i === highlighted ? "rgba(255,255,255,0.08)" : "transparent",
                }}
              >
                {user.displayName}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
