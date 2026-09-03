import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import en from './en';
import fr from './fr';

export type Lang = 'en' | 'fr';

const LANG_KEY = 'tritonis.lang';
const DICTS: Record<Lang, Record<string, string>> = { en, fr };

interface I18nState {
  lang: Lang;
  setLang(l: Lang): void;
}

/** Device locale ('fr' → fr, anything else → en), without extra native deps. */
function deviceLang(): Lang {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale ?? '';
    return locale.toLowerCase().startsWith('fr') ? 'fr' : 'en';
  } catch {
    return 'en';
  }
}

const useI18nStore = create<I18nState>((set) => ({
  lang: deviceLang(),
  setLang(l) {
    set({ lang: l });
    void AsyncStorage.setItem(LANG_KEY, l).catch(() => undefined);
  },
}));

// Restore persisted language on first load.
void AsyncStorage.getItem(LANG_KEY)
  .then((saved) => {
    if (saved === 'en' || saved === 'fr') useI18nStore.setState({ lang: saved });
  })
  .catch(() => undefined);

/** Current language (non-reactive). */
export function getLang(): Lang {
  return useI18nStore.getState().lang;
}

/** BCP-47-ish locale matching the current language (for Intl formatters). */
export function currentLocale(): string {
  return getLang() === 'fr' ? 'fr-FR' : 'en-GB';
}

/** Translate a key, interpolating {{var}} placeholders. Fallback: en, then the key itself. */
export function t(key: string, vars?: Record<string, string | number>): string {
  const dict = DICTS[getLang()];
  let s = dict[key] ?? en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.split(`{{${k}}}`).join(String(v));
    }
  }
  return s;
}

/** Reactive hook: current language + setter (persisted to AsyncStorage). */
export function useI18n(): { lang: Lang; setLang(l: Lang): void } {
  const lang = useI18nStore((s) => s.lang);
  const setLang = useI18nStore((s) => s.setLang);
  return { lang, setLang };
}
