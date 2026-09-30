/**
 * The prompt keep: a crenellated keep with a terminal prompt above the gate. Drawn on a
 * 64-unit grid in one 4u stroke, coloured by currentColor so the caller picks the token.
 *
 * Below ~32px the gate is dropped and the stroke thickened; the 16px favicon is a
 * separate pixel-fitted drawing in public/icons.
 */
export function LogoMark({ size = 32 }: { size?: number }) {
  const small = size < 32;
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={small ? 5 : 4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 56V8h8v6h8V8h8v6h8V8h8v48" />
      <path d="M6 56h52" />
      <path d="M21 24l7 5.5-7 5.5" />
      <path d="M32 35h11" />
      {!small && <path d="M26 56v-7a6 6 0 0 1 12 0v7" />}
    </svg>
  );
}

/** Mark plus wordmark. "Copper" carries the brand colour; "keep" stays --fg. */
export function Logo({ size = 28, as: Tag = "span" }: { size?: number; as?: "span" | "h1" }) {
  return (
    <Tag className="logo">
      <span className="logo__mark">
        <LogoMark size={size} />
      </span>
      <span className="logo__word">
        <span className="logo__copper">Copper</span>keep
      </span>
    </Tag>
  );
}
