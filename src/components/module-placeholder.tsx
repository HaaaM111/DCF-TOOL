export function ModulePlaceholder({ title }: { title: string }) {
  return <section className="rounded-lg border border-terminal-line bg-terminal-surface p-5 sm:p-6">
    <h2 className="text-base font-semibold text-terminal-ink">{title}</h2>
    <p className="mt-2 text-sm text-terminal-muted">模块占位，内容将在下一阶段迁入。</p>
  </section>;
}
