function ErrorBanner({ mensagem, onRetry }) {
  return (
    <div className="error-banner">
      <span className="error-msg">
        <i className="ti ti-alert-triangle" aria-hidden="true" />
        {mensagem}
      </span>
      {onRetry && (
        <button type="button" onClick={onRetry}>
          Tentar novamente
        </button>
      )}
    </div>
  )
}

export default ErrorBanner
