/**
 * Device Detector - Modular utility for detecting device types
 *
 * Currently uses user-agent detection, but designed to be extensible
 * for future detection methods (e.g., screen size, touch capabilities, etc.)
 *
 * Usage:
 *   DeviceDetector.isDesktop()  // true on desktop browsers
 *   DeviceDetector.isMobile()   // true on mobile browsers
 *   DeviceDetector.isTablet()   // true on tablet devices
 *   DeviceDetector.getDeviceType() // 'desktop' | 'mobile' | 'tablet'
 */
(function(global) {
  'use strict';

  // Detection strategies - can add more methods in the future
  const strategies = {
    /**
     * User-agent based detection (primary method)
     * Checks for mobile/tablet keywords in the user agent string
     */
    userAgent: function() {
      const ua = navigator.userAgent || navigator.vendor || window.opera || '';

      // Mobile device patterns
      const mobilePatterns = [
        /Android/i,
        /webOS/i,
        /iPhone/i,
        /iPod/i,
        /BlackBerry/i,
        /IEMobile/i,
        /Opera Mini/i,
        /Mobile/i,
        /mobile/i,
        /CriOS/i,  // Chrome on iOS
        /FxiOS/i,  // Firefox on iOS
      ];

      // Tablet patterns (checked before mobile for iPad)
      const tabletPatterns = [
        /iPad/i,
        /Android(?!.*Mobile)/i,  // Android without Mobile = tablet
        /Tablet/i,
      ];

      // Check tablet first (iPad, Android tablets)
      for (const pattern of tabletPatterns) {
        if (pattern.test(ua)) {
          return 'tablet';
        }
      }

      // Check mobile
      for (const pattern of mobilePatterns) {
        if (pattern.test(ua)) {
          return 'mobile';
        }
      }

      return 'desktop';
    },

    /**
     * Touch capability detection (supplementary method)
     * Can be used to enhance detection accuracy
     */
    touchCapability: function() {
      const hasTouch = 'ontouchstart' in window ||
                       navigator.maxTouchPoints > 0 ||
                       navigator.msMaxTouchPoints > 0;

      // Touch alone doesn't determine device type
      // Many desktops have touch screens now
      return hasTouch ? 'touch-capable' : 'no-touch';
    },

    /**
     * Screen size detection (supplementary method)
     * Mobile typically < 768px, tablet 768-1024px, desktop > 1024px
     */
    screenSize: function() {
      const width = window.innerWidth || document.documentElement.clientWidth;

      if (width < 768) {
        return 'small'; // Likely mobile
      } else if (width < 1024) {
        return 'medium'; // Could be tablet
      } else {
        return 'large'; // Likely desktop
      }
    }
  };

  // Cache the detected device type to avoid repeated detection
  let cachedDeviceType = null;

  /**
   * Get the device type using the configured strategy
   * @param {boolean} forceRefresh - Force re-detection (useful after orientation change)
   * @returns {'desktop' | 'mobile' | 'tablet'}
   */
  function getDeviceType(forceRefresh) {
    if (cachedDeviceType && !forceRefresh) {
      return cachedDeviceType;
    }

    // Primary detection using user-agent
    cachedDeviceType = strategies.userAgent();

    return cachedDeviceType;
  }

  /**
   * Check if the device is a desktop computer
   * @returns {boolean}
   */
  function isDesktop() {
    return getDeviceType() === 'desktop';
  }

  /**
   * Check if the device is a mobile phone
   * @returns {boolean}
   */
  function isMobile() {
    return getDeviceType() === 'mobile';
  }

  /**
   * Check if the device is a tablet
   * @returns {boolean}
   */
  function isTablet() {
    return getDeviceType() === 'tablet';
  }

  /**
   * Check if the device has a small screen (mobile-like)
   * Useful for responsive UI decisions
   * @returns {boolean}
   */
  function hasSmallScreen() {
    return strategies.screenSize() === 'small';
  }

  /**
   * Check if the device has touch capability
   * @returns {boolean}
   */
  function hasTouchCapability() {
    return strategies.touchCapability() === 'touch-capable';
  }

  /**
   * Refresh the cached device type
   * Call this after events that might change detection (e.g., orientation change)
   */
  function refresh() {
    cachedDeviceType = null;
    getDeviceType();
  }

  // Public API
  const DeviceDetector = {
    getDeviceType: getDeviceType,
    isDesktop: isDesktop,
    isMobile: isMobile,
    isTablet: isTablet,
    hasSmallScreen: hasSmallScreen,
    hasTouchCapability: hasTouchCapability,
    refresh: refresh,

    // Expose strategies for testing/debugging
    _strategies: strategies
  };

  // Export for different module systems
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = DeviceDetector;
  } else if (typeof define === 'function' && define.amd) {
    define(function() { return DeviceDetector; });
  } else {
    global.DeviceDetector = DeviceDetector;
  }

})(typeof window !== 'undefined' ? window : this);
