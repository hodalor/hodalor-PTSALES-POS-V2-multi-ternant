import React, { createContext, useContext } from 'react';
import { useAppLanguage } from '../utils/localization';

const LanguageContext = createContext();

export function LanguageProvider({ children }) {
  const { language, setLanguage, t, ...rest } = useAppLanguage();

  const contextValue = {
    language,
    setLanguage,
    t,
    ...rest
  };

  return (
    <LanguageContext.Provider value={contextValue} key={language}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}
