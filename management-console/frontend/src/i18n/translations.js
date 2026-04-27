import enUS from './locales/en_US.js';
import esCL from './locales/es_CL.js';
import { SUPPORTED_LOCALES } from './languages.js';

const translations = {
  [SUPPORTED_LOCALES.EN_US]: enUS,
  [SUPPORTED_LOCALES.ES_CL]: esCL
};

export default translations;
