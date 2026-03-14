import { format, type Locale } from "date-fns";
import { enUS, es, ptBR, ht } from "date-fns/locale";

const localeMap: Record<string, Locale> = {
  en: enUS,
  es,
  pt: ptBR,
  ht,
};

function getLocale(lang: string): Locale {
  return localeMap[lang.split("-")[0]] ?? enUS;
}

export function formatDate(date: Date | string | number, lang: string): string {
  const d = typeof date === "string" || typeof date === "number" ? new Date(date) : date;
  return format(d, "PPP", { locale: getLocale(lang) });
}

export function formatDateShort(date: Date | string | number, lang: string): string {
  const d = typeof date === "string" || typeof date === "number" ? new Date(date) : date;
  return format(d, "PP", { locale: getLocale(lang) });
}

export function formatTime(date: Date | string | number, lang: string): string {
  const d = typeof date === "string" || typeof date === "number" ? new Date(date) : date;
  return format(d, "p", { locale: getLocale(lang) });
}

export function formatDateTime(date: Date | string | number, lang: string): string {
  const d = typeof date === "string" || typeof date === "number" ? new Date(date) : date;
  return format(d, "PPp", { locale: getLocale(lang) });
}

export function formatCurrency(cents: number, lang: string): string {
  return new Intl.NumberFormat(lang === "ht" ? "fr-HT" : lang, {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export function formatNumber(value: number, lang: string): string {
  return new Intl.NumberFormat(lang === "ht" ? "fr-HT" : lang).format(value);
}

export function formatDistance(miles: number, lang: string): string {
  const formatted = new Intl.NumberFormat(lang === "ht" ? "fr-HT" : lang, {
    maximumFractionDigits: 1,
  }).format(miles);
  return `${formatted} mi`;
}

export function formatRelativeTime(date: Date | string | number, lang: string): string {
  const d = typeof date === "string" || typeof date === "number" ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) {
    const labels: Record<string, string> = {
      en: "Just now",
      es: "Ahora mismo",
      pt: "Agora mesmo",
      ht: "Kounye a",
    };
    return labels[lang.split("-")[0]] ?? labels.en;
  }
  if (diffMin < 60) {
    return `${diffMin} min`;
  }
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) {
    const labels: Record<string, string> = {
      en: `${diffHr}h ago`,
      es: `hace ${diffHr}h`,
      pt: `${diffHr}h atr\u00e1s`,
      ht: `${diffHr}h pase`,
    };
    return labels[lang.split("-")[0]] ?? labels.en;
  }
  return formatDateShort(d, lang);
}
