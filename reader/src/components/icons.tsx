/** Hearth Noir's bundled 24px monochrome stroke set.
 * Every glyph uses currentColor and the same 1.5px optical weight. */
import type { ReactNode } from "react";

type IconProps = {
  size?: number;
  className?: string;
  children?: ReactNode;
};

function StrokeIcon({ size = 24, className, children }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return <StrokeIcon {...props}><circle cx="10.8" cy="10.8" r="5.8" /><path d="m15.2 15.2 4.2 4.2" /></StrokeIcon>;
}

export function ContentsIcon(props: IconProps) {
  return <StrokeIcon {...props}><path d="M5 6h14M5 12h14M5 18h14" /><circle cx="3" cy="6" r=".65" fill="currentColor" stroke="none" /><circle cx="3" cy="12" r=".65" fill="currentColor" stroke="none" /><circle cx="3" cy="18" r=".65" fill="currentColor" stroke="none" /></StrokeIcon>;
}

export function BookmarkIcon({ filled = false, ...props }: IconProps & { filled?: boolean }) {
  return (
    <svg
      className={props.className}
      width={props.size ?? 24}
      height={props.size ?? 24}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M6 4.25A1.25 1.25 0 0 1 7.25 3h9.5A1.25 1.25 0 0 1 18 4.25V21l-6-3.75L6 21V4.25Z" />
    </svg>
  );
}

export function SettingsIcon(props: IconProps) {
  return <StrokeIcon {...props}><circle cx="12" cy="12" r="3" /><path d="M19 13.5v-3l-2-.55a7 7 0 0 0-.7-1.7l1.05-1.8-2.1-2.1-1.8 1.05a7 7 0 0 0-1.7-.7L11.2 3h-3l-.55 2a7 7 0 0 0-1.7.7l-1.8-1.05-2.1 2.1 1.05 1.8a7 7 0 0 0-.7 1.7l-2 .55v3l2 .55a7 7 0 0 0 .7 1.7l-1.05 1.8 2.1 2.1 1.8-1.05a7 7 0 0 0 1.7.7l.55 2h3l.55-2a7 7 0 0 0 1.7-.7l1.8 1.05 2.1-2.1-1.05-1.8a7 7 0 0 0 .7-1.7l2-.55Z" /></StrokeIcon>;
}

export function TypeIcon(props: IconProps) {
  return <StrokeIcon {...props}><path d="M5 5h10M10 5v14M7 19h6M15.5 12h5M18 12v7M16.5 19h3" /></StrokeIcon>;
}

export function ChevronLeftIcon(props: IconProps) {
  return <StrokeIcon {...props}><path d="m14.5 5-7 7 7 7" /></StrokeIcon>;
}

export function ChevronRightIcon(props: IconProps) {
  return <StrokeIcon {...props}><path d="m9.5 5 7 7-7 7" /></StrokeIcon>;
}

export function BackIcon(props: IconProps) {
  return <StrokeIcon {...props}><path d="M19 12H5M11 6l-6 6 6 6" /></StrokeIcon>;
}

export function ReturnIcon(props: IconProps) {
  return <StrokeIcon {...props}><path d="M9 7H5l3-3M5 7h8a5 5 0 0 1 0 10H9" /></StrokeIcon>;
}

export function CloseIcon(props: IconProps) {
  return <StrokeIcon {...props}><path d="m6 6 12 12M18 6 6 18" /></StrokeIcon>;
}

export function PlusIcon(props: IconProps) {
  return <StrokeIcon {...props}><path d="M12 5v14M5 12h14" /></StrokeIcon>;
}

export function MinusIcon(props: IconProps) {
  return <StrokeIcon {...props}><path d="M5 12h14" /></StrokeIcon>;
}

export function SortIcon(props: IconProps) {
  return <StrokeIcon {...props}><path d="M6 5h12M6 12h8M6 19h4" /><path d="m17 15 3 3-3 3M20 18h-6" /></StrokeIcon>;
}

export function FilterIcon(props: IconProps) {
  return <StrokeIcon {...props}><path d="M4 5h16l-6.3 7.1v5.2L10.3 19v-6.9L4 5Z" /></StrokeIcon>;
}

export function GridIcon(props: IconProps) {
  return <StrokeIcon {...props}><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></StrokeIcon>;
}

export function ListIcon(props: IconProps) {
  return <StrokeIcon {...props}><path d="M8 6h12M8 12h12M8 18h12" /><path d="M4 6h.01M4 12h.01M4 18h.01" /></StrokeIcon>;
}

export function DownloadIcon(props: IconProps) {
  return <StrokeIcon {...props}><path d="M12 4v11M8 11l4 4 4-4M5 20h14" /></StrokeIcon>;
}

export function StarIcon({ filled = false, ...props }: IconProps & { filled?: boolean }) {
  return <StrokeIcon {...props}><path d="m12 3 2.75 5.6 6.2.9-4.48 4.35 1.06 6.15L12 17.1l-5.53 2.9 1.06-6.15L3.05 9.5l6.2-.9L12 3Z" fill={filled ? "currentColor" : "none"} /></StrokeIcon>;
}

export function ServerIcon(props: IconProps) {
  return <StrokeIcon {...props}><rect x="4" y="4" width="16" height="6" rx="1" /><rect x="4" y="14" width="16" height="6" rx="1" /><path d="M7 7h.01M7 17h.01M11 7h6M11 17h6" /></StrokeIcon>;
}

export function TagIcon(props: IconProps) {
  return <StrokeIcon {...props}><path d="M4 5v6l9 9 7-7-9-9H5a1 1 0 0 0-1 1Z" /><circle cx="8" cy="8" r="1" /></StrokeIcon>;
}

export function ShareIcon(props: IconProps) {
  return <StrokeIcon {...props}><circle cx="18" cy="5" r="2.25" /><circle cx="6" cy="12" r="2.25" /><circle cx="18" cy="19" r="2.25" /><path d="m8 11 7.8-4.5M8 13l7.8 4.5" /></StrokeIcon>;
}

export function MoreIcon(props: IconProps) {
  return <StrokeIcon {...props}><circle cx="6" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="18" cy="12" r="1" fill="currentColor" stroke="none" /></StrokeIcon>;
}

export function HeartIcon({ filled = false, ...props }: IconProps & { filled?: boolean }) {
  return <StrokeIcon {...props}><path d="M12 20s-7-4.35-7-9.4A3.6 3.6 0 0 1 12 8a3.6 3.6 0 0 1 7 2.6C19 15.65 12 20 12 20Z" fill={filled ? "currentColor" : "none"} /></StrokeIcon>;
}

export function CheckIcon(props: IconProps) {
  return <StrokeIcon {...props}><path d="m5 12 4.5 4.5L19 7" /></StrokeIcon>;
}

/** Compatibility name for existing bookmark callers. */
export function RibbonIcon({ size = 15, fill = "currentColor" }: { size?: number; fill?: string }) {
  return <BookmarkIcon size={size} filled={fill !== "none"} />;
}
