import { Capacitor } from '@capacitor/core'
import { startNativeScanner } from '@/lib/scanners/native-scanner'
import { startWebScanner } from '@/lib/scanners/web-scanner'

export type BarcodeScanSession = {
  stop: () => Promise<void>
}

export function usesNativeBarcodeScanner(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

export function scannerImplementationLabel(): string {
  return usesNativeBarcodeScanner() ? 'камера приложения Android' : 'камера браузера'
}

export async function startBarcodeScanner(options: {
  elementId: string
  onCode: (value: string) => void
}): Promise<BarcodeScanSession> {
  if (usesNativeBarcodeScanner()) return startNativeScanner(options.onCode)
  return startWebScanner(options.elementId, options.onCode)
}
