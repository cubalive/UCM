import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Languages } from "lucide-react";

const languages = [
  { code: "en", label: "English", flag: "EN" },
  { code: "es", label: "Espa\u00f1ol", flag: "ES" },
];

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const resolvedLang = (i18n.resolvedLanguage || i18n.language || "en").split("-")[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" data-testid="button-language-switcher">
          <Languages className="w-4 h-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {languages.map((lang) => (
          <DropdownMenuItem
            key={lang.code}
            onClick={() => i18n.changeLanguage(lang.code)}
            className={resolvedLang === lang.code ? "font-semibold" : ""}
            data-testid={`menu-lang-${lang.code}`}
          >
            <span className="mr-2 text-xs font-mono w-5">{lang.flag}</span>
            {lang.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
