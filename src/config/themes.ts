/**
 * Theme Presets for SSIM Store Branding
 *
 * Each theme defines a color palette that can be applied to customer-facing pages.
 * Themes are inspired by major e-commerce retailers for familiar, professional aesthetics.
 */

export interface ThemeColors {
  primary: string; // Main brand color (buttons, links, accents)
  primaryHover: string; // Hover state for primary
  primaryLight: string; // Light background tint
  secondary: string; // Secondary accent color
  accent: string; // Highlights, badges, special elements
  gradient: {
    from: string;
    to: string;
  };
}

export interface ThemePreset {
  id: string;
  name: string;
  description: string;
  colors: ThemeColors;
}

/**
 * Available theme presets
 */
export const themePresets: Record<string, ThemePreset> = {
  default: {
    id: 'default',
    name: 'Default (Purple)',
    description: 'Modern tech store with purple accents',
    colors: {
      primary: '#9333ea', // purple-600
      primaryHover: '#7c3aed', // purple-700
      primaryLight: '#f3e8ff', // purple-100
      secondary: '#6366f1', // indigo-500
      accent: '#a855f7', // purple-500
      gradient: { from: '#667eea', to: '#764ba2' },
    },
  },

  amazon: {
    id: 'amazon',
    name: 'Marketplace (Orange)',
    description: 'E-commerce giant inspired orange and dark theme',
    colors: {
      primary: '#ff9900', // Amazon orange
      primaryHover: '#e68a00',
      primaryLight: '#fff7ed', // orange-50
      secondary: '#232f3e', // Amazon dark blue
      accent: '#febd69', // Amazon light orange
      gradient: { from: '#232f3e', to: '#37475a' },
    },
  },

  walmart: {
    id: 'walmart',
    name: 'Value Store (Blue)',
    description: 'Friendly blue and yellow retail theme',
    colors: {
      primary: '#0071dc', // Walmart blue
      primaryHover: '#004c91',
      primaryLight: '#eff6ff', // blue-50
      secondary: '#ffc220', // Walmart yellow
      accent: '#76c043', // Walmart green spark
      gradient: { from: '#0071dc', to: '#004c91' },
    },
  },

  staples: {
    id: 'staples',
    name: 'Office Supply (Red)',
    description: 'Professional red and white theme',
    colors: {
      primary: '#cc0000', // Staples red
      primaryHover: '#a30000',
      primaryLight: '#fef2f2', // red-50
      secondary: '#333333',
      accent: '#cc0000',
      gradient: { from: '#cc0000', to: '#8b0000' },
    },
  },

  regalmoose: {
    id: 'regalmoose',
    name: 'Regal Moose (Forest)',
    description: 'Canadian outdoors with forest green and maple accents',
    colors: {
      primary: '#166534', // green-800 (forest green)
      primaryHover: '#14532d', // green-900
      primaryLight: '#dcfce7', // green-100
      secondary: '#854d0e', // amber-800 (maple/wood brown)
      accent: '#ca8a04', // yellow-600 (golden maple leaf)
      gradient: { from: '#166534', to: '#14532d' },
    },
  },
};

/**
 * Get a theme preset by ID
 * Falls back to default if theme not found
 */
export function getTheme(themeId: string): ThemePreset {
  return themePresets[themeId] || themePresets.default;
}

/**
 * Get all available theme presets as an array
 */
export function getAllThemes(): ThemePreset[] {
  return Object.values(themePresets);
}

/**
 * Check if a theme ID is valid
 */
export function isValidTheme(themeId: string): boolean {
  return themeId in themePresets;
}
