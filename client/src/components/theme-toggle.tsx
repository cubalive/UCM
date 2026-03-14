import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sun, Moon, Monitor } from "lucide-react";
import { useTranslation } from "react-i18next";

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const { t } = useTranslation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" data-testid="button-theme-toggle" aria-label={`Toggle theme, current: ${resolvedTheme}`}>
          {resolvedTheme === "dark" ? (
            <Moon className="w-4 h-4" aria-hidden="true" />
          ) : (
            <Sun className="w-4 h-4" aria-hidden="true" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={() => setTheme("light")}
          className={theme === "light" ? "font-semibold" : ""}
          data-testid="menu-theme-light"
        >
          <Sun className="w-4 h-4 mr-2" aria-hidden="true" />
          {t("common.light")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setTheme("dark")}
          className={theme === "dark" ? "font-semibold" : ""}
          data-testid="menu-theme-dark"
        >
          <Moon className="w-4 h-4 mr-2" aria-hidden="true" />
          {t("common.dark")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setTheme("system")}
          className={theme === "system" ? "font-semibold" : ""}
          data-testid="menu-theme-system"
        >
          <Monitor className="w-4 h-4 mr-2" aria-hidden="true" />
          {t("common.system")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
