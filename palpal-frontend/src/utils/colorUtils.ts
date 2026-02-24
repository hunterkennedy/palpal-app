/**
 * Utility functions for color handling and theming
 */

// Convert Tailwind color names to CSS color values
export const getColorValue = (tailwindColor: string): string => {
  const colorMap: Record<string, string> = {
    'orange-500': 'rgb(249 115 22)',
    'orange-400': 'rgb(251 146 60)',
    'orange-600': 'rgb(234 88 12)',
    'orange-900': 'rgb(124 45 18)',
    'orange-800': 'rgb(154 52 18)',
    'yellow-500': 'rgb(234 179 8)',
    'yellow-400': 'rgb(250 204 21)',
    'yellow-600': 'rgb(202 138 4)',
    'yellow-900': 'rgb(113 63 18)',
    'yellow-800': 'rgb(133 77 14)',
    'slate-200': 'rgb(226 232 240)',
    'slate-100': 'rgb(241 245 249)',
    'slate-300': 'rgb(203 213 225)',
    'slate-900': 'rgb(15 23 42)',
    'slate-800': 'rgb(30 41 59)',
    'purple-500': 'rgb(168 85 247)',
    'purple-400': 'rgb(196 181 253)',
    'purple-600': 'rgb(147 51 234)',
    'purple-900': 'rgb(88 28 135)',
    'purple-800': 'rgb(107 33 168)',
    'green-500': 'rgb(34 197 94)',
    'green-400': 'rgb(74 222 128)',
    'green-600': 'rgb(22 163 74)',
    'green-900': 'rgb(20 83 45)',
    'green-800': 'rgb(22 101 52)',
    'red-500': 'rgb(239 68 68)',
    'red-400': 'rgb(248 113 113)',
    'red-600': 'rgb(220 38 38)',
    'red-900': 'rgb(127 29 29)',
    'red-800': 'rgb(153 27 27)',
  };
  return colorMap[tailwindColor] || 'rgb(107 114 128)'; // fallback to gray-500
};

// Generate CSS custom properties from theme colors
export const generateThemeVariables = (theme: {
  primary: string;
  secondary: string;
  accent: string;
  gradientFrom: string;
  gradientTo: string;
}) => {
  return {
    '--primary-color': getColorValue(theme.primary),
    '--secondary-color': getColorValue(theme.secondary),
    '--accent-color': getColorValue(theme.accent),
    '--gradient-from': getColorValue(theme.gradientFrom),
    '--gradient-to': getColorValue(theme.gradientTo),
  };
};