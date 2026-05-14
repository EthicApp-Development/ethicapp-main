import { createContext, useContext } from 'react';
import { DEFAULT_LOCALE } from '../i18n/languages';

export const I18nContext = createContext({
  locale: DEFAULT_LOCALE,
  t: (key) => key
});

export function useI18n() {
  return useContext(I18nContext);
}
