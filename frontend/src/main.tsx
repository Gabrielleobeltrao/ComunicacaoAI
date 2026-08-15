import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import './index.css'
import App from './App.tsx'
import { I18nProvider } from './i18n'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ErrorBoundary>
        <I18nProvider>
          <App />
        </I18nProvider>
      </ErrorBoundary>
    </BrowserRouter>
  </StrictMode>,
)
