export function PageLoading() {
  return (
    <div className="mx-auto w-full max-w-2xl animate-pulse space-y-4 px-4 py-10" aria-busy="true" aria-label="Memuat">
      <div className="h-8 w-1/2 rounded bg-stone-200" />
      <div className="h-4 w-2/3 rounded bg-stone-200" />
      <div className="h-40 rounded-xl bg-stone-200" />
    </div>
  );
}
