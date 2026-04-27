const esCL = {
  common: {
    appName: 'EthicApp',
    studentLabel: 'Estudiante',
    logout: 'Cerrar sesión',
    loadingUser: 'Cargando usuario...'
  },
  navigation: {
    sessionsNavigation: 'Navegación de sesiones',
    joinSession: 'Ingresar a sesión',
    previousSessions: 'Sesiones anteriores'
  },
  home: {
    recentSessions: 'Sesiones recientes',
    previousSessions: 'Sesiones anteriores'
  },
  joinSession: {
    title: 'Unirse a una sesión',
    description: 'Ingresa el código compartido por tu profesor. El formulario es compatible con móvil y escritorio.',
    placeholder: 'Ej: k0010d',
    ariaSessionCode: 'Código de sesión',
    joinAction: 'Unirse',
    joiningAction: 'Uniendo...',
    invalidCode: 'Ingresa un código de sesión válido.',
    joinErrorFallback: 'No fue posible unirse a la sesión',
    alreadyJoined: 'Ya habías ingresado a esta sesión. Redirigiendo...',
    joinedSuccess: 'Te uniste a la sesión correctamente. Redirigiendo...'
  },
  sessions: {
    mySessions: 'Mis sesiones',
    loginToView: 'Inicia sesión para ver tus sesiones previas.',
    loadingSessions: 'Cargando sesiones...',
    loadErrorFallback: 'No se pudieron cargar las sesiones',
    sessionFallbackName: 'Sesión',
    noDescription: 'Sin descripción',
    statusLabel: 'Estado',
    dateLabel: 'Fecha',
    codeLabel: 'Código',
    empty: 'Aún no te has unido a ninguna sesión.',
    paginationLabel: 'Paginación de sesiones',
    previousPage: 'Página anterior',
    nextPage: 'Página siguiente',
    previous: 'Anterior',
    next: 'Siguiente',
    noDate: 'Sin fecha',
    noStatus: 'Sin estado',
    status: {
      setup: 'Configuración',
      active: 'Activa',
      closed: 'Cerrada',
      archived: 'Archivada'
    }
  },
  sessionDetail: {
    title: 'Detalle de sesión',
    backHome: 'Volver al home',
    loginToView: 'Inicia sesión para revisar la sesión seleccionada.',
    loadingDetail: 'Cargando detalle...',
    loadErrorFallback: 'No se pudieron cargar los datos de la sesión',
    noDescription: 'Sin descripción',
    status: 'Estado',
    date: 'Fecha',
    code: 'Código',
    type: 'Tipo',
    activePhaseNumber: 'Fase activa #',
    activePhaseId: 'Fase activa ID',
    unavailable: 'No disponible',
    noType: 'Sin tipo',
    loadingActivityState: 'Cargando estado completo de la actividad...',
    activityPhasesLabel: 'Fases de la actividad',
    phasesTitle: 'Fases',
    phaseN: 'Fase',
    notFoundInAvailable: 'No encontramos la sesión solicitada dentro de tus sesiones disponibles.'
  },
  notFound: {
    title: 'Página no encontrada',
    description: 'La ruta que intentaste abrir no existe en el módulo de estudiante.',
    backHome: 'Ir al home'
  },
  errors: {
    invalidSessionId: 'sessionId inválido',
    invalidUserId: 'userId inválido',
    fullStateFallback: 'No se pudo cargar el estado completo de la actividad'
  }
};

export default esCL;
