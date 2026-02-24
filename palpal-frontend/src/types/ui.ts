/**
 * UI-related type definitions
 */


export interface SearchHandlers {
  onSearchFocus?: (inputElement: HTMLInputElement) => void;
  onSearchBlur?: () => void;
  onSearchChange?: (query: string) => void;
  onSearch?: (query: string, selectedPodcasts: string[]) => void;
}


export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export interface ThemeColors {
  primary: string;
  secondary: string;
  accent: string;
  gradientFrom: string;
  gradientTo: string;
}