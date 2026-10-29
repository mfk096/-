import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'ru.factory.inventory',
  appName: 'Инвентаризация',
  webDir: 'dist',
  android: {
    allowMixedContent: true,
  },
  server: {
    // Схема https, чтобы WebView считался безопасным контекстом.
    // Cleartext и mixed content разрешают ходить на http:// сервера завода.
    androidScheme: 'https',
    cleartext: true,
  },
}

export default config
