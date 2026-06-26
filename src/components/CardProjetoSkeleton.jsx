function CardProjetoSkeleton() {
  return (
    <div className="card-projeto">
      <div className="card-projeto-barra skeleton-bloco" />
      <div className="card-projeto-corpo">
        <div className="skeleton-bloco skeleton-linha" style={{ width: '40%', height: 16 }} />
        <div className="skeleton-bloco skeleton-linha" style={{ width: '60%' }} />
        <div className="skeleton-bloco skeleton-linha" style={{ width: '100%', height: 8 }} />
        <div className="skeleton-bloco skeleton-linha" style={{ width: '100%', height: 8 }} />
        <div className="skeleton-bloco skeleton-linha" style={{ width: '80%' }} />
      </div>
    </div>
  )
}

export default CardProjetoSkeleton
