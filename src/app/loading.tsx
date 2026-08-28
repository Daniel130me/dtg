export default function Loading() {
  return (
    <main className="min-h-[50vh] grid place-items-center" aria-busy="true" aria-live="polite">
      <p className="text-sm text-muted-foreground">Loading…</p>
    </main>
  );
}
