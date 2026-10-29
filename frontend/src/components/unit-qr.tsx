import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { qrPayload } from '@/lib/label-templates'

export function UnitQr({
  code,
  pixels = 512,
  millimetres,
  className,
}: {
  code: string
  pixels?: number
  millimetres?: number
  className?: string
}) {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void QRCode.toDataURL(qrPayload(code), {
      margin: 0,
      width: pixels,
      errorCorrectionLevel: 'M',
    })
      .then((url) => {
        if (!cancelled) setSrc(url)
      })
      .catch(() => {
        if (!cancelled) setSrc(null)
      })
    return () => {
      cancelled = true
    }
  }, [code, pixels])

  const style = millimetres
    ? { width: `${millimetres}mm`, height: `${millimetres}mm` }
    : { width: 112, height: 112 }

  if (!src) {
    return <div className={className} style={style} aria-hidden="true" />
  }

  return <img src={src} alt="" className={className} style={style} draggable={false} />
}
