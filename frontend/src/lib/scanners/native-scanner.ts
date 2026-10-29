import { BarcodeFormat, BarcodeScanner } from '@capacitor-mlkit/barcode-scanning'
import type { BarcodeScanSession } from '@/lib/scanner'

const ACTIVE_CLASS = 'barcode-scanner-active'

export async function startNativeScanner(
  onCode: (value: string) => void,
): Promise<BarcodeScanSession> {
  const supported = await BarcodeScanner.isSupported()
  if (!supported.supported) {
    throw new Error('На этом телефоне сканер недоступен. Введите код вручную.')
  }

  const permission = await BarcodeScanner.requestPermissions()
  if (permission.camera !== 'granted' && permission.camera !== 'limited') {
    throw new Error(
      'Нет доступа к камере. Разрешите камеру в настройках телефона или введите код вручную.',
    )
  }

  document.body.classList.add(ACTIVE_CLASS)
  const listener = await BarcodeScanner.addListener('barcodesScanned', (event) => {
    for (const barcode of event.barcodes) {
      const value = barcode.rawValue || barcode.displayValue
      if (value) onCode(value)
    }
  })

  try {
    await BarcodeScanner.startScan({ formats: [BarcodeFormat.QrCode] })
  } catch (error) {
    document.body.classList.remove(ACTIVE_CLASS)
    await listener.remove()
    throw error
  }

  return {
    stop: async () => {
      document.body.classList.remove(ACTIVE_CLASS)
      await listener.remove()
      try {
        await BarcodeScanner.stopScan()
      } catch {
        // Сессия камеры уже закрыта.
      }
    },
  }
}
