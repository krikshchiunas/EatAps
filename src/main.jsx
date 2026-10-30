import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { StoreProvider } from './store.jsx'
import App from './App.jsx'
import RootErrorBoundary from './components/RootErrorBoundary.jsx'
import { registerServiceWorker } from './lib/swUpdate.js'
import { initI18n } from './lib/i18n.js'
import './index.css'

// Язык выбирается до первого рендера: иначе экран мелькнул бы по-русски и
// перерисовался на языке человека, как только догрузится его пакет.
//
// Граница снаружи провайдера: падение самого стора (повреждённые данные,
// неожиданная форма состояния из облака) тоже обязано показывать экран с
// объяснением и выходом, а не пустую страницу.
initI18n().finally(() => {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <RootErrorBoundary>
        <StoreProvider>
          <App />
        </StoreProvider>
      </RootErrorBoundary>
    </StrictMode>
  )
})

if (import.meta.env.PROD) {
  window.addEventListener('load', registerServiceWorker)
}
