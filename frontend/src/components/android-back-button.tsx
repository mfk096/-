import { useEffect } from 'react'
import { App } from '@capacitor/app'
import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { useNavigate } from 'react-router-dom'

export function AndroidBackButton() {
  const navigate = useNavigate()

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    let removed = false
    let handle: PluginListenerHandle | null = null

    void App.addListener('backButton', () => {
      const state = window.history.state as { idx?: number } | null
      if (typeof state?.idx === 'number' && state.idx > 0) {
        navigate(-1)
        return
      }
      void App.exitApp()
    }).then((listener) => {
      if (removed) {
        void listener.remove()
        return
      }
      handle = listener
    })

    return () => {
      removed = true
      if (handle) void handle.remove()
    }
  }, [navigate])

  return null
}
