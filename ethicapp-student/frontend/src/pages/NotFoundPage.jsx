import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <section className="text-center py-5">
      <h1 className="h4">Página no encontrada</h1>
      <p className="text-muted">La ruta que intentaste abrir no existe en el módulo de estudiante.</p>
      <Link to="/" className="btn btn-primary btn-sm">
        <span className="d-inline-flex align-items-center gap-2">
          <i className="fa-solid fa-house" aria-hidden="true" />
          <span>Ir al home</span>
        </span>
      </Link>
    </section>
  );
}
