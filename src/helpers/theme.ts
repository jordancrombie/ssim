/**
 * Theme Helper Functions
 *
 * Generates CSS custom properties from theme presets for dynamic theming.
 */

import { getTheme, ThemePreset } from '../config/themes';

/**
 * Generate CSS custom properties from a theme preset
 * This CSS can be injected into a <style> tag to apply the theme
 */
export function generateThemeCSS(themeId: string): string {
  const theme = getTheme(themeId);

  return `
    :root {
      --color-primary: ${theme.colors.primary};
      --color-primary-hover: ${theme.colors.primaryHover};
      --color-primary-light: ${theme.colors.primaryLight};
      --color-secondary: ${theme.colors.secondary};
      --color-accent: ${theme.colors.accent};
      --gradient-from: ${theme.colors.gradient.from};
      --gradient-to: ${theme.colors.gradient.to};
    }
  `.trim();
}

/**
 * Get theme data for client-side JavaScript
 * Returns a JSON-safe object with theme colors
 */
export function getThemeForClient(themeId: string): ThemePreset {
  return getTheme(themeId);
}
