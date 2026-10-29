/** basename для BrowserRouter. У Vite BASE_URL со слэшем на конце, роутеру он не нужен. */
export function routerBasename(): string | undefined {
  const base = import.meta.env.BASE_URL
  if (!base || base === '/') return undefined
  const trimmed = base.endsWith('/') ? base.slice(0, -1) : base
  return trimmed || undefined
}
