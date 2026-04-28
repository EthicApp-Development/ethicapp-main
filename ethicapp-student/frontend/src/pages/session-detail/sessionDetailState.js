export const SESSION_STATUS = {
  initiated: 1,
  inProgress: 2,
  finished: 3
};

export const initialSessionDetailState = {
  joinedSessions: [],
  loadingSessions: true,
  sessionsError: '',
  activityDescriptor: null,
  loadingDescriptor: false,
  descriptorError: '',
  caseDocumentUrl: '',
  loadingCaseDocument: false,
  caseDocumentError: '',
  activeTab: ''
};

export function normalizeStatusCode(statusValue) {
  if (typeof statusValue === 'number') {
    return statusValue;
  }

  if (statusValue === 'initiated') {
    return SESSION_STATUS.initiated;
  }

  if (statusValue === 'in_progress') {
    return SESSION_STATUS.inProgress;
  }

  if (statusValue === 'finished') {
    return SESSION_STATUS.finished;
  }

  return null;
}

export function sessionDetailReducer(state, action) {
  switch (action.type) {
    case 'SESSIONS_LOAD_START':
      return {
        ...state,
        loadingSessions: true,
        sessionsError: ''
      };
    case 'SESSIONS_LOAD_SUCCESS':
      return {
        ...state,
        joinedSessions: action.payload,
        loadingSessions: false,
        sessionsError: ''
      };
    case 'SESSIONS_LOAD_ERROR':
      return {
        ...state,
        joinedSessions: [],
        loadingSessions: false,
        sessionsError: action.payload
      };
    case 'SESSIONS_CLEAR':
      return {
        ...initialSessionDetailState,
        loadingSessions: false
      };
    case 'DESCRIPTOR_LOAD_START':
      return {
        ...state,
        loadingDescriptor: true,
        descriptorError: ''
      };
    case 'DESCRIPTOR_LOAD_SUCCESS':
      return {
        ...state,
        activityDescriptor: action.payload,
        loadingDescriptor: false,
        descriptorError: ''
      };
    case 'DESCRIPTOR_LOAD_ERROR':
      return {
        ...state,
        activityDescriptor: null,
        loadingDescriptor: false,
        descriptorError: action.payload
      };
    case 'DESCRIPTOR_CLEAR':
      return {
        ...state,
        activityDescriptor: null,
        loadingDescriptor: false,
        descriptorError: ''
      };
    case 'CASE_LOAD_START':
      return {
        ...state,
        loadingCaseDocument: true,
        caseDocumentError: ''
      };
    case 'CASE_LOAD_SUCCESS':
      return {
        ...state,
        caseDocumentUrl: action.payload,
        loadingCaseDocument: false,
        caseDocumentError: ''
      };
    case 'CASE_LOAD_ERROR':
      return {
        ...state,
        caseDocumentUrl: '',
        loadingCaseDocument: false,
        caseDocumentError: action.payload
      };
    case 'CASE_CLEAR':
      return {
        ...state,
        caseDocumentUrl: '',
        loadingCaseDocument: false,
        caseDocumentError: ''
      };
    case 'ACTIVITY_FORCE_IN_PROGRESS': {
      const prevStatus = normalizeStatusCode(state.activityDescriptor?.status);

      if (prevStatus !== SESSION_STATUS.initiated) {
        return state;
      }

      return {
        ...state,
        activityDescriptor: {
          ...(state.activityDescriptor ?? {}),
          status: SESSION_STATUS.inProgress
        }
      };
    }
    case 'ACTIVITY_FORCE_FINISHED':
      return {
        ...state,
        activityDescriptor: {
          ...(state.activityDescriptor ?? {}),
          status: SESSION_STATUS.finished
        }
      };
    case 'ACTIVE_TAB_SET':
      return {
        ...state,
        activeTab: action.payload
      };
    default:
      return state;
  }
}
