import { createContext, useContext } from 'react';

export const emptyRegisterDraft = Object.freeze({
  firstname: '',
  lastname: '',
  dni: '',
  email: '',
  gender: '',
  password: '',
  password_confirmation: '',
  acceptPrivacy: false
});

export const RegisterDraftContext = createContext({
  draft: emptyRegisterDraft,
  updateDraft: () => {},
  clearDraft: () => {}
});

export function useRegisterDraft() {
  return useContext(RegisterDraftContext);
}
