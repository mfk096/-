import { Html5Qrcode } from 'html5-qrcode'
import type { BarcodeScanSession } from '@/lib/scanner'

export async function startWebScanner(
  elementId: string,
  onCode: (value: string) => void,
): Promise<BarcodeScanSession> {
  const element = document.getElementById(elementId)
  if (!element) throw new Error('Не найдено окно камеры.')

  const scanner = new Html5Qrcode(elementId, false)
  await scanner.start(
    { facingMode: 'environment' },
    { fps: 8, qrbox: { width: 220, height: 220 } },
    (text) => onCode(text),
    () => undefined,
  )

  return {
    stop: async () => {
      try {
        if (scanner.isScanning) await scanner.stop()
      } catch {
        // Камера уже остановлена.
      }
      try {
        scanner.clear()
      } catch {
        // Контейнер уже пуст.
      }
    },
  }
}

export function cameraErrorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/[А-Яа-яЁё]/.test(message)) return message
  if (/NotAllowed|Permission/i.test(message)) {
    return 'Браузер не дал доступ к камере. Разрешите камеру или введите код вручную.'
  }
  if (/NotFound|no camera|Camera not found/i.test(message)) {
    return 'Камера не найдена. Введите код вручную.'
  }
  if (/NotReadable|Could not start|in use/i.test(message)) {
    return 'Камера занята другим приложением.'
  }
  if (/secure context|https|only secure/i.test(message)) {
    return 'Этот браузер открывает камеру только на localhost или по HTTPS. В приложении Android камера работает без HTTPS.'
  }
  return 'Не удалось запустить камеру. Введите код вручную.'
}
