export function FullScreenStatus({ title }: { title: string }) {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-6">
      <p className="text-sm text-muted-foreground">{title}</p>
    </div>
  )
}
