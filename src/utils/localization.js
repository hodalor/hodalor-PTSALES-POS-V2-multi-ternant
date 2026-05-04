import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import en from '../locales/en.json';
import tw from '../locales/tw.json';
import ga from '../locales/ga.json';
import ewe from '../locales/ewe.json';
import dag from '../locales/dag.json';
import fr from '../locales/fr.json';
import zh from '../locales/zh.json';
export const LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'tw', label: 'Twi' },
  { value: 'ga', label: 'Ga' },
  { value: 'ewe', label: 'Ewe' },
  { value: 'dag', label: 'Dagbani' },
  { value: 'fr', label: 'French' },
  { value: 'zh', label: 'Chinese' }
];

const LANGUAGE_META = {
  en: { speechLocale: 'en-US', recognitionLocale: 'en-US' },
  tw: { speechLocale: 'ak-GH', recognitionLocale: 'en-GH' },
  ga: { speechLocale: 'gaa-GH', recognitionLocale: 'en-GH' },
  ewe: { speechLocale: 'ee-GH', recognitionLocale: 'en-GH' },
  dag: { speechLocale: 'dag-GH', recognitionLocale: 'en-GH' },
  fr: { speechLocale: 'fr-FR', recognitionLocale: 'fr-FR' },
  zh: { speechLocale: 'zh-CN', recognitionLocale: 'zh-CN' }
};

const LANGUAGE_FALLBACKS = {
  ga: 'tw',
  ewe: 'tw',
  dag: 'tw',
  fr: 'en',
  zh: 'en'
};

const TRANSLATIONS = {
  en,
  tw,
  ga,
  ewe,
  dag,
  fr,
  zh
};

function normalizeLanguage(value) {
  const next = String(value || '').trim().toLowerCase();
  if (LANGUAGE_OPTIONS.some((item) => item.value === next)) return next;
  return 'en';
}

function template(value, params = {}) {
  return String(value || '').replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? ''));
}

export function translate(language, key, params = {}) {
  const normalized = normalizeLanguage(language);
  const table = TRANSLATIONS[normalized] || {};
  const fallbackLanguage = LANGUAGE_FALLBACKS[normalized];
  const fallbackTable = fallbackLanguage ? (TRANSLATIONS[fallbackLanguage] || {}) : {};
  const value = Object.prototype.hasOwnProperty.call(table, key)
    ? table[key]
    : Object.prototype.hasOwnProperty.call(fallbackTable, key)
      ? fallbackTable[key]
      : key;
  return template(value, params);
}

export function getDocumentLanguage() {
  try {
    if (typeof document !== 'undefined') {
      return normalizeLanguage(document.documentElement?.getAttribute('lang') || 'en');
    }
  } catch {}
  return 'en';
}

export function translateDocumentLanguage(key, params = {}) {
  return translate(getDocumentLanguage(), key, params);
}

export function getLanguageMeta(language) {
  return LANGUAGE_META[normalizeLanguage(language)] || LANGUAGE_META.en;
}

function getStorageKey(tenantId = '', userName = '') {
  const tenant = String(tenantId || 'guest').trim().toLowerCase() || 'guest';
  const user = String(userName || 'guest').trim().toLowerCase() || 'guest';
  return `ptSales:preferredLanguage:${tenant}:${user}`;
}

export function readPreferredLanguage({ tenantId = '', userName = '' } = {}) {
  try {
    const stored = localStorage.getItem(getStorageKey(tenantId, userName));
    return normalizeLanguage(stored);
  } catch {
    return '';
  }
}

export function writePreferredLanguage({ tenantId = '', userName = '', language = 'en' } = {}) {
  try {
    localStorage.setItem(getStorageKey(tenantId, userName), normalizeLanguage(language));
  } catch {}
}

export function useAppLanguage(options = {}) {
  const settingsPreferred = useSelector((state) => state.settings?.preferredLanguage || 'en');
  const authUser = useSelector((state) => state.auth?.user || null);
  const authPreferred = normalizeLanguage(authUser?.preferredLanguage || '');
  const tenantId = String(options.tenantId || authUser?.tenantId || '').trim();
  const userName = String(options.userName || authUser?.name || '').trim();
  const storageKey = useMemo(() => getStorageKey(tenantId, userName), [tenantId, userName]);
  const [overrideLanguage, setOverrideLanguage] = useState('');

  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      setOverrideLanguage(normalizeLanguage(stored));
    } catch {
      setOverrideLanguage('');
    }
  }, [storageKey]);

  const language = normalizeLanguage(overrideLanguage || authPreferred || settingsPreferred || 'en');
  const setLanguage = useCallback((nextLanguage) => {
    const normalized = normalizeLanguage(nextLanguage);
    writePreferredLanguage({ tenantId, userName, language: normalized });
    setOverrideLanguage(normalized);
  }, [tenantId, userName]);

  const t = useCallback((key, params = {}) => translate(language, key, params), [language]);

  return {
    language,
    defaultLanguage: normalizeLanguage(settingsPreferred || 'en'),
    setLanguage,
    t,
    options: LANGUAGE_OPTIONS,
    ...getLanguageMeta(language)
  };
}
