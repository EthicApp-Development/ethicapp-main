export default function StudentTopbar({ loadingSession, userDisplayName, onLogout }) {
  return (
    <header className="navbar navbar-expand-lg bg-white border-bottom sticky-top shadow-sm">
      <div className="container-fluid container-lg py-1">
        <span className="navbar-brand mb-0 h1 fw-semibold">EthicApp Student</span>
        <div className="d-flex align-items-center gap-2 ms-auto">
          <span className="small text-secondary text-truncate" style={{ maxWidth: '180px' }}>
            {loadingSession ? 'Cargando usuario...' : userDisplayName}
          </span>
          <button type="button" className="btn btn-outline-danger btn-sm" onClick={onLogout}>
            Logout
          </button>
        </div>
      </div>
    </header>
  );
}
