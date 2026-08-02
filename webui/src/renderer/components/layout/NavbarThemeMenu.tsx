import { Palette } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ThemeType } from '@/store/uiStore';

const THEME_LABELS: Record<ThemeType, string> = {
  red: 'Red',
  blue: 'Blue',
  green: 'Green',
  purple: 'Purple',
  orange: 'Orange',
  teal: 'Teal',
};

const THEME_DOT_CLASSES: Record<ThemeType, string> = {
  red: 'bg-[#e15b47]',
  blue: 'bg-[#5b93c7]',
  green: 'bg-[#6fa368]',
  purple: 'bg-[#9b7bc0]',
  orange: 'bg-[#d98a4b]',
  teal: 'bg-[#5ba79c]',
};

interface NavbarThemeMenuProps {
  theme: ThemeType;
  onThemeChange: (theme: ThemeType) => void;
}

export default function NavbarThemeMenu({
  theme,
  onThemeChange,
}: NavbarThemeMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9 bg-secondary border-border hover:bg-muted"
          aria-label="Choose color theme"
        >
          <Palette className="h-4.5 w-4.5 text-primary" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-secondary border-border">
        {(Object.keys(THEME_LABELS) as ThemeType[]).map((option) => (
          <DropdownMenuItem
            key={option}
            onClick={() => onThemeChange(option)}
            className="flex items-center gap-2 cursor-pointer text-foreground focus:bg-muted focus:text-foreground"
          >
            <span className={`h-3 w-3 rounded-full ${THEME_DOT_CLASSES[option]}`} />
            <span className={theme === option ? 'font-bold' : ''}>
              {THEME_LABELS[option]}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
