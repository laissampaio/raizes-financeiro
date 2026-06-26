// Guarda o access_token do Google na sessao do browser (sessionStorage),
// conforme o briefing: login acontece uma vez por sessao, sem refresh token
// (flow implicito), expira sozinho e a usuaria loga de novo quando precisar.

const STORAGE_KEY = 'raizes_dashboard_auth'

export function getStoredToken() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null

    const dados = JSON.parse(raw)
    if (!dados.accessToken || !dados.expiresAt) return null
    if (Date.now() >= dados.expiresAt) {
      clearStoredToken()
      return null
    }
    return dados.accessToken
  } catch {
    return null
  }
}

export function setStoredToken(accessToken, expiresInSeconds) {
  const expiresAt = Date.now() + expiresInSeconds * 1000
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ accessToken, expiresAt }))
}

export function clearStoredToken() {
  sessionStorage.removeItem(STORAGE_KEY)
}
