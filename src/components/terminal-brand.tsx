export function TerminalBrand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-3 text-terminal-ink">
      <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-terminal-line bg-terminal-canvas font-mono text-xs font-semibold">DCF</span>
      <span className={compact ? "sr-only" : "truncate text-sm font-semibold"}>DCF 估值终端</span>
    </span>
  );
}
