import { getTheme, getAllThemes, isValidTheme, themePresets, ThemePreset } from '../../config/themes';

describe('Theme Configuration', () => {
  describe('themePresets', () => {
    it('should have 5 theme presets', () => {
      expect(Object.keys(themePresets)).toHaveLength(5);
    });

    it('should have all required themes', () => {
      expect(themePresets).toHaveProperty('default');
      expect(themePresets).toHaveProperty('amazon');
      expect(themePresets).toHaveProperty('walmart');
      expect(themePresets).toHaveProperty('staples');
      expect(themePresets).toHaveProperty('regalmoose');
    });

    it('should have valid structure for each theme', () => {
      Object.values(themePresets).forEach((theme: ThemePreset) => {
        expect(theme).toHaveProperty('id');
        expect(theme).toHaveProperty('name');
        expect(theme).toHaveProperty('description');
        expect(theme).toHaveProperty('colors');
        expect(theme.colors).toHaveProperty('primary');
        expect(theme.colors).toHaveProperty('primaryHover');
        expect(theme.colors).toHaveProperty('primaryLight');
        expect(theme.colors).toHaveProperty('secondary');
        expect(theme.colors).toHaveProperty('accent');
        expect(theme.colors).toHaveProperty('gradient');
        expect(theme.colors.gradient).toHaveProperty('from');
        expect(theme.colors.gradient).toHaveProperty('to');
      });
    });
  });

  describe('getTheme', () => {
    it('should return default theme when id is "default"', () => {
      const theme = getTheme('default');

      expect(theme.id).toBe('default');
      expect(theme.name).toBe('Default (Purple)');
    });

    it('should return amazon theme when id is "amazon"', () => {
      const theme = getTheme('amazon');

      expect(theme.id).toBe('amazon');
      expect(theme.name).toBe('Marketplace (Orange)');
    });

    it('should return walmart theme when id is "walmart"', () => {
      const theme = getTheme('walmart');

      expect(theme.id).toBe('walmart');
      expect(theme.name).toBe('Value Store (Blue)');
    });

    it('should return staples theme when id is "staples"', () => {
      const theme = getTheme('staples');

      expect(theme.id).toBe('staples');
      expect(theme.name).toBe('Office Supply (Red)');
    });

    it('should return regalmoose theme when id is "regalmoose"', () => {
      const theme = getTheme('regalmoose');

      expect(theme.id).toBe('regalmoose');
      expect(theme.name).toBe('Regal Moose (Forest)');
    });

    it('should return default theme for unknown theme id', () => {
      const theme = getTheme('unknown-theme');

      expect(theme.id).toBe('default');
      expect(theme.name).toBe('Default (Purple)');
    });

    it('should return default theme for empty string', () => {
      const theme = getTheme('');

      expect(theme.id).toBe('default');
    });
  });

  describe('getAllThemes', () => {
    it('should return array of all themes', () => {
      const themes = getAllThemes();

      expect(Array.isArray(themes)).toBe(true);
      expect(themes).toHaveLength(5);
    });

    it('should return themes with all required properties', () => {
      const themes = getAllThemes();

      themes.forEach(theme => {
        expect(theme).toHaveProperty('id');
        expect(theme).toHaveProperty('name');
        expect(theme).toHaveProperty('description');
        expect(theme).toHaveProperty('colors');
      });
    });

    it('should include all theme ids', () => {
      const themes = getAllThemes();
      const ids = themes.map(t => t.id);

      expect(ids).toContain('default');
      expect(ids).toContain('amazon');
      expect(ids).toContain('walmart');
      expect(ids).toContain('staples');
      expect(ids).toContain('regalmoose');
    });
  });

  describe('isValidTheme', () => {
    it('should return true for valid theme ids', () => {
      expect(isValidTheme('default')).toBe(true);
      expect(isValidTheme('amazon')).toBe(true);
      expect(isValidTheme('walmart')).toBe(true);
      expect(isValidTheme('staples')).toBe(true);
      expect(isValidTheme('regalmoose')).toBe(true);
    });

    it('should return false for invalid theme ids', () => {
      expect(isValidTheme('unknown')).toBe(false);
      expect(isValidTheme('')).toBe(false);
      expect(isValidTheme('Amazon')).toBe(false); // case sensitive
      expect(isValidTheme('DEFAULT')).toBe(false);
    });

    it('should return false for null-like values', () => {
      expect(isValidTheme(null as unknown as string)).toBe(false);
      expect(isValidTheme(undefined as unknown as string)).toBe(false);
    });
  });

  describe('theme color values', () => {
    it('default theme should have purple colors', () => {
      const theme = getTheme('default');

      expect(theme.colors.primary).toBe('#9333ea');
      expect(theme.colors.primaryHover).toBe('#7c3aed');
    });

    it('amazon theme should have orange colors', () => {
      const theme = getTheme('amazon');

      expect(theme.colors.primary).toBe('#ff9900');
      expect(theme.colors.primaryHover).toBe('#e68a00');
    });

    it('walmart theme should have blue colors', () => {
      const theme = getTheme('walmart');

      expect(theme.colors.primary).toBe('#0071dc');
      expect(theme.colors.primaryHover).toBe('#004c91');
    });

    it('staples theme should have red colors', () => {
      const theme = getTheme('staples');

      expect(theme.colors.primary).toBe('#cc0000');
      expect(theme.colors.primaryHover).toBe('#a30000');
    });

    it('regalmoose theme should have forest green colors', () => {
      const theme = getTheme('regalmoose');

      expect(theme.colors.primary).toBe('#166534');
      expect(theme.colors.primaryHover).toBe('#14532d');
    });
  });
});
