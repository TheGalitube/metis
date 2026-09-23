import { cn } from "@/lib/utils";

export function JarvisWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("jarvis-wordmark", className)} role="img" aria-label="J.A.R.V.I.S. Mk3.1">
      <svg className="jarvis-wordmark-mark" viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <circle cx="16" cy="16" r="13.5" stroke="currentColor" strokeWidth="1" opacity="0.45" />
        <circle cx="16" cy="16" r="9.5" stroke="currentColor" strokeWidth="1.5" opacity="0.85" />
        <circle cx="16" cy="16" r="4" fill="currentColor" />
        <path d="M16 1v4m0 22v4M1 16h4m22 0h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <span className="jarvis-wordmark-copy">
        <span className="jarvis-wordmark-name">J.A.R.V.I.S.</span>
        <span className="jarvis-wordmark-version">MK3.1</span>
      </span>
    </span>
  );
}
