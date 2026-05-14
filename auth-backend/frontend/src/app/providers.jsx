import PropTypes from 'prop-types';
import { useCallback, useMemo, useState } from 'react';
import translations from '../i18n/translations';
import { DEFAULT_LOCALE, detectPreferredLocale } from '../i18n/languages';
import { I18nContext } from './i18n-context';
import { emptyRegisterDraft, RegisterDraftContext } from './register-draft-context';

function getByPath(dictionary, dottedPath) {
  return dottedPath
    .split('.')
    .reduce((value, segment) => (value && value[segment] !== undefined ? value[segment] : undefined), dictionary);
}

export function AppProviders({ children }) {
  const locale = detectPreferredLocale();
  const [registerDraft, setRegisterDraft] = useState(emptyRegisterDraft);

  const i18nContextValue = useMemo(() => {
    const localeDictionary = translations[locale] || translations[DEFAULT_LOCALE] || {};

    function t(key) {
      const localizedText = getByPath(localeDictionary, key);
      return localizedText ?? key;
    }

    return { locale, t };
  }, [locale]);

  const updateRegisterDraft = useCallback((updater) => {
    setRegisterDraft((current) => {
      const nextDraft = typeof updater === 'function' ? updater(current) : updater;
      return {
        ...current,
        ...nextDraft
      };
    });
  }, []);

  const clearRegisterDraft = useCallback(() => {
    setRegisterDraft(emptyRegisterDraft);
  }, []);

  const registerDraftContextValue = useMemo(() => ({
    draft: registerDraft,
    updateDraft: updateRegisterDraft,
    clearDraft: clearRegisterDraft
  }), [clearRegisterDraft, registerDraft, updateRegisterDraft]);

  return (
    <I18nContext.Provider value={i18nContextValue}>
      <RegisterDraftContext.Provider value={registerDraftContextValue}>
        {children}
      </RegisterDraftContext.Provider>
    </I18nContext.Provider>
  );
}

AppProviders.propTypes = {
  children: PropTypes.node.isRequired
};
