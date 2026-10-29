import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import { BrowserRouter } from 'react-router-dom'
import { routerBasename } from '@/lib/router-base'
import { Toaster } from '@/components/ui/sonner'
import { AndroidBackButton } from '@/components/android-back-button'
import { AuthProvider } from '@/providers/auth-provider'
import { ConnectionProvider } from '@/providers/connection-provider'
import { queryClient } from '@/providers/query-client'
import App from '@/App'
import '@fontsource/manrope/cyrillic-400.css'
import '@fontsource/manrope/cyrillic-500.css'
import '@fontsource/manrope/cyrillic-600.css'
import '@fontsource/manrope/cyrillic-700.css'
import '@fontsource/manrope/latin-400.css'
import '@fontsource/manrope/latin-500.css'
import '@fontsource/manrope/latin-600.css'
import '@fontsource/manrope/latin-700.css'
import './index.css'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Не найден корневой элемент #root')
}

createRoot(rootElement).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      <ConnectionProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <BrowserRouter basename={routerBasename()}>
              <AndroidBackButton />
              <App />
            </BrowserRouter>
            <Toaster position="top-center" richColors closeButton />
          </AuthProvider>
        </QueryClientProvider>
      </ConnectionProvider>
    </ThemeProvider>
  </StrictMode>,
)
