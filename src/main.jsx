import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { GoogleOAuthProvider } from '@react-oauth/google'
import './styles.css'
import App from './App.jsx'

const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID

// O SDK do Google lanca uma excecao sincrona (dentro de um efeito) quando
// client_id esta ausente, o que derruba a arvore inteira do React. Sem essa
// env var nada no app funciona mesmo, entao nem tentamos montar o resto.
function ConfigIncompleta() {
  return (
    <div className="pagina">
      <div className="estado-vazio">
        <i className="ti ti-alert-triangle" aria-hidden="true" />
        <p>
          Configuração incompleta: defina <code>VITE_GOOGLE_CLIENT_ID</code> no
          arquivo <code>.env</code> (veja <code>.env.example</code>) e reinicie o app.
        </p>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {clientId ? (
      <GoogleOAuthProvider clientId={clientId}>
        <App />
      </GoogleOAuthProvider>
    ) : (
      <ConfigIncompleta />
    )}
  </StrictMode>,
)
