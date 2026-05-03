import { createContext, useContext, useMemo, useState } from 'react';

type Language = 'en' | 'ms';

type LanguageContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  text: (en: string, ms: string) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => (localStorage.getItem('language') as Language) || 'en');

  const value = useMemo(
    () => ({
      language,
      setLanguage: (next: Language) => {
        localStorage.setItem('language', next);
        setLanguage(next);
      },
      text: (en: string, ms: string) => (language === 'en' ? en : ms),
    }),
    [language],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const value = useContext(LanguageContext);
  if (!value) throw new Error('useLanguage must be used inside LanguageProvider');
  return value;
}
