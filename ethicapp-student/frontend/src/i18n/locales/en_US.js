const enUS = {
  common: {
    appName: 'EthicApp',
    studentLabel: 'Student',
    logout: 'Logout',
    loadingUser: 'Loading user...'
  },
  navigation: {
    sessionsNavigation: 'Sessions navigation',
    joinSession: 'Join session',
    previousSessions: 'Previous sessions'
  },
  home: {
    recentSessions: 'Recent sessions',
    previousSessions: 'Previous sessions'
  },
  joinSession: {
    title: 'Join a session',
    description: 'Enter the code shared by your teacher. The form works on mobile and desktop.',
    placeholder: 'Example: k0010d',
    ariaSessionCode: 'Session code',
    joinAction: 'Join',
    joiningAction: 'Joining...',
    invalidCode: 'Enter a valid session code.',
    joinErrorFallback: 'Unable to join the session',
    alreadyJoined: 'You already joined this session. Redirecting...',
    joinedSuccess: 'You joined the session successfully. Redirecting...'
  },
  sessions: {
    mySessions: 'My sessions',
    loginToView: 'Sign in to view your previous sessions.',
    loadingSessions: 'Loading sessions...',
    loadErrorFallback: 'Unable to load sessions',
    sessionFallbackName: 'Session',
    noDescription: 'No description',
    statusLabel: 'Status',
    dateLabel: 'Date',
    codeLabel: 'Code',
    empty: 'You have not joined any sessions yet.',
    paginationLabel: 'Session pagination',
    previousPage: 'Previous page',
    nextPage: 'Next page',
    previous: 'Previous',
    next: 'Next',
    noDate: 'No date',
    noStatus: 'No status',
    status: {
      setup: 'Setup',
      active: 'Active',
      closed: 'Closed',
      archived: 'Archived'
    }
  },
  sessionDetail: {
    title: 'Session detail',
    backHome: 'Back home',
    loginToView: 'Sign in to review the selected session.',
    loadingDetail: 'Loading detail...',
    loadErrorFallback: 'Unable to load session data',
    noDescription: 'No description',
    status: 'Status',
    date: 'Date',
    code: 'Code',
    type: 'Type',
    activePhaseNumber: 'Active phase #',
    activePhaseId: 'Active phase ID',
    unavailable: 'Unavailable',
    noType: 'No type',
    loadingActivityState: 'Loading full activity state...',
    activityPhasesLabel: 'Activity phases',
    phasesTitle: 'Phases',
    phaseN: 'Phase',
    notFoundInAvailable: 'We could not find the requested session in your available sessions.'
  },
  notFound: {
    title: 'Page not found',
    description: 'The route you tried to open does not exist in the student module.',
    backHome: 'Go home'
  },
  errors: {
    invalidSessionId: 'Invalid sessionId',
    invalidUserId: 'Invalid userId',
    fullStateFallback: 'Unable to load full activity state'
  }
};

export default enUS;
