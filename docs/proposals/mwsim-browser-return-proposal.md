# Proposal: Browser-Aware Return Flow for mwsim

**Date:** December 14, 2025
**From:** SSIM Team
**To:** mwsim Team
**Status:** Draft

## Executive Summary

When a merchant website opens the mwsim app via deep link, the app currently returns users to their device's default browser. This causes issues when users start checkout in a non-default browser (e.g., Chrome) but get returned to Safari. We propose adding a `sourceBrowser` parameter to the deep link that mwsim can use to return users to the correct browser.

## Problem Statement

### Current Flow
1. User opens merchant site in Chrome (not their default browser)
2. User taps "Pay with Mobile Wallet"
3. Merchant opens `mwsim://payment/{requestId}?returnUrl=https://merchant.com/checkout`
4. mwsim app opens, user approves payment
5. mwsim opens the returnUrl using iOS default URL handling
6. **iOS opens Safari** (the default browser) instead of Chrome
7. User sees checkout in Safari with no session/cart context
8. Original Chrome tab still has stale state

### Impact
- Poor user experience - users are confused by browser switching
- Session/cart loss if cookies aren't shared across browsers
- Multiple browser tabs/windows with conflicting state
- Payment may appear to fail even when successful

## Proposed Solution

### Deep Link Enhancement

Add a `sourceBrowser` parameter to the mwsim deep link:

```
mwsim://payment/{requestId}?returnUrl={url}&sourceBrowser={browser}
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `returnUrl` | Yes | Full URL to return user to after payment |
| `sourceBrowser` | No | Browser identifier: `safari`, `chrome`, `firefox`, `edge`, `opera`, `brave`, `samsung`, `other` |

### Example Deep Links

```
# User in Safari
mwsim://payment/abc123?returnUrl=https://store.com/checkout?mwsim_return=abc123&sourceBrowser=safari

# User in Chrome
mwsim://payment/abc123?returnUrl=https://store.com/checkout?mwsim_return=abc123&sourceBrowser=chrome

# User in Firefox
mwsim://payment/abc123?returnUrl=https://store.com/checkout?mwsim_return=abc123&sourceBrowser=firefox
```

### mwsim Implementation

When opening the return URL, mwsim should:

1. Check if `sourceBrowser` parameter is present
2. If present, construct a browser-specific URL scheme
3. If the specific browser isn't installed, fall back to default browser
4. Open the URL

#### iOS Browser URL Schemes

| Browser | URL Scheme | HTTPS Pattern |
|---------|------------|---------------|
| Safari | Default | `https://...` |
| Chrome | `googlechromes://` | `googlechromes://store.com/checkout?...` |
| Firefox | `firefox://open-url?url=` | `firefox://open-url?url=https%3A%2F%2Fstore.com%2F...` |
| Edge | `microsoft-edge://` | `microsoft-edge://store.com/checkout?...` |
| Opera | `opera://open-url?url=` | `opera://open-url?url=https%3A%2F%2F...` |
| Brave | `brave://open-url?url=` | `brave://open-url?url=https%3A%2F%2F...` |

#### Android Browser Intent

On Android, use an explicit intent with the browser package name:

| Browser | Package Name |
|---------|--------------|
| Chrome | `com.android.chrome` |
| Firefox | `org.mozilla.firefox` |
| Edge | `com.microsoft.emmx` |
| Samsung | `com.sec.android.app.sbrowser` |
| Opera | `com.opera.browser` |
| Brave | `com.brave.browser` |

### Pseudocode for mwsim

```swift
// iOS Implementation
func openReturnUrl(returnUrl: String, sourceBrowser: String?) {
    guard let url = URL(string: returnUrl) else { return }

    // If no source browser specified, use default
    guard let browser = sourceBrowser else {
        UIApplication.shared.open(url)
        return
    }

    // Try to open in the source browser
    var browserUrl: URL?

    switch browser.lowercased() {
    case "chrome":
        // Convert https:// to googlechromes://
        if let scheme = url.scheme, scheme == "https" {
            let chromeUrlString = returnUrl.replacingOccurrences(of: "https://", with: "googlechromes://")
            browserUrl = URL(string: chromeUrlString)
        }
    case "firefox":
        let encoded = returnUrl.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? returnUrl
        browserUrl = URL(string: "firefox://open-url?url=\(encoded)")
    case "edge":
        let edgeUrlString = returnUrl.replacingOccurrences(of: "https://", with: "microsoft-edge://")
        browserUrl = URL(string: edgeUrlString)
    case "safari", "other":
        browserUrl = url
    default:
        browserUrl = url
    }

    // Try browser-specific URL, fall back to default if app not installed
    if let browserUrl = browserUrl, UIApplication.shared.canOpenURL(browserUrl) {
        UIApplication.shared.open(browserUrl)
    } else {
        // Fallback to default browser
        UIApplication.shared.open(url)
    }
}
```

### Merchant Implementation (SSIM)

We will detect the browser from the User-Agent header and include it in the deep link:

```typescript
// Browser detection from User-Agent
function detectBrowser(userAgent: string): string {
  const ua = userAgent.toLowerCase();

  if (ua.includes('crios')) return 'chrome';      // Chrome on iOS
  if (ua.includes('fxios')) return 'firefox';     // Firefox on iOS
  if (ua.includes('edgios')) return 'edge';       // Edge on iOS
  if (ua.includes('opios')) return 'opera';       // Opera on iOS
  if (ua.includes('brave')) return 'brave';       // Brave
  if (ua.includes('samsungbrowser')) return 'samsung';
  if (ua.includes('safari') && !ua.includes('chrome')) return 'safari';
  if (ua.includes('chrome')) return 'chrome';     // Chrome on Android
  if (ua.includes('firefox')) return 'firefox';   // Firefox on Android

  return 'other';
}

// Deep link construction
const browser = detectBrowser(req.headers['user-agent'] || '');
const returnUrl = encodeURIComponent(`${baseUrl}/checkout?mwsim_return=${requestId}`);
const deepLink = `mwsim://payment/${requestId}?returnUrl=${returnUrl}&sourceBrowser=${browser}`;
```

## Alternative Approaches Considered

### 1. Universal Links Only
- **Approach:** Use iOS Universal Links which can maintain browser context
- **Pros:** Native iOS solution
- **Cons:** Complex setup, requires apple-app-site-association, doesn't solve cross-browser issue

### 2. Pass Full Return URL Scheme
- **Approach:** Merchant constructs the browser-specific return URL
- **Pros:** mwsim doesn't need browser knowledge
- **Cons:** Merchants need to know URL schemes, more complex merchant integration

### 3. Session-Based Return
- **Approach:** Store session ID in mwsim, return via web redirect through WSIM
- **Pros:** Browser-agnostic
- **Cons:** Additional network hop, slower, requires WSIM changes

## Backward Compatibility

- `sourceBrowser` parameter is optional
- If not provided, mwsim uses current default browser behavior
- Existing integrations continue to work unchanged
- Merchants can adopt the new parameter incrementally

## Testing Plan

| Scenario | Expected Result |
|----------|-----------------|
| Safari user, no param | Returns to Safari (default) |
| Safari user, `sourceBrowser=safari` | Returns to Safari |
| Chrome user, `sourceBrowser=chrome` | Returns to Chrome |
| Chrome user, Chrome not installed | Falls back to default browser |
| Firefox user, `sourceBrowser=firefox` | Returns to Firefox |
| Unknown browser value | Falls back to default browser |

## Timeline

| Phase | Description | Owner |
|-------|-------------|-------|
| 1 | mwsim adds `sourceBrowser` parameter support | mwsim team |
| 2 | mwsim implements browser-specific URL schemes | mwsim team |
| 3 | SSIM adds browser detection and deep link params | SSIM team |
| 4 | Integration testing | Both teams |
| 5 | Production rollout | Both teams |

## Questions for mwsim Team

1. Are there any concerns with adding URL scheme dependencies to mwsim?
2. Should we add `sourceBrowser` to the WSIM Mobile API response, or keep it client-side only?
3. Are there other browsers we should prioritize supporting?
4. What's your preferred timeline for implementation?

## Appendix: User-Agent Detection Patterns

### iOS Browsers

| Browser | User-Agent Contains |
|---------|---------------------|
| Safari | `Safari` but NOT `CriOS`, `FxiOS`, `EdgiOS` |
| Chrome | `CriOS` |
| Firefox | `FxiOS` |
| Edge | `EdgiOS` |
| Opera | `OPiOS` |

### Android Browsers

| Browser | User-Agent Contains |
|---------|---------------------|
| Chrome | `Chrome` but NOT `Edge`, `OPR`, `SamsungBrowser` |
| Firefox | `Firefox` |
| Edge | `EdgA` or `Edge` |
| Opera | `OPR` |
| Samsung | `SamsungBrowser` |
| Brave | `Brave` |

---

**Contact:** [SSIM Team Contact]
**Repository:** https://github.com/jordancrombie/ssim

---

## mwsim Team Response

**Date:** December 14, 2025
**Status:** APPROVED - Ready for Implementation

### Summary

We approve this proposal. The browser-aware return flow addresses a real UX issue we've observed during testing. The solution is clean, backward-compatible, and places most of the complexity on the mwsim side where it belongs.

### Responses to SSIM Team Questions

#### 1. Concerns with URL scheme dependencies?

**No significant concerns.** The URL schemes for major browsers are stable and well-documented. Our only consideration:

- We'll need to add these URL schemes to our `Info.plist` `LSApplicationQueriesSchemes` array for `canOpenURL()` to work on iOS (iOS requires declaring which URL schemes you want to query)
- This is a standard iOS requirement, not a blocker

```xml
<!-- Info.plist additions needed -->
<key>LSApplicationQueriesSchemes</key>
<array>
  <string>googlechromes</string>
  <string>firefox</string>
  <string>microsoft-edge</string>
  <string>opera</string>
  <string>brave</string>
</array>
```

#### 2. Add sourceBrowser to WSIM API or keep client-side only?

**Recommendation: Keep it client-side only for now.**

Rationale:
- SSIM (the merchant frontend) is best positioned to detect the browser from User-Agent
- Adding to WSIM API would require passing browser info through multiple hops
- If we need server-side tracking later, we can add it incrementally

#### 3. Other browsers to prioritize?

The list covers the major browsers. We'd suggest also considering:

- **DuckDuckGo Browser** (iOS: `ddgQuickLink://`, Android: `com.duckduckgo.mobile.android`) - growing privacy-focused user base
- **Arc Browser** (iOS only) - popular among tech users

These can be Phase 2 additions if we see demand.

#### 4. Preferred timeline?

**We can implement this in the current sprint.** Proposed timeline:

| Phase | Est. Time | Notes |
|-------|-----------|-------|
| Parse `sourceBrowser` from deep link | 0.5 days | Add to existing deep link handler |
| Implement browser URL scheme mapping | 1 day | iOS-focused first, Android later |
| Add `LSApplicationQueriesSchemes` | 0.5 days | Requires expo prebuild |
| Testing with SSIM | 0.5 days | Coordinate with SSIM team |
| **Total mwsim effort** | **2-3 days** | |

### Implementation Notes

#### React Native / Expo Considerations

Since mwsim uses Expo and React Native (not native Swift), we'll implement this using `expo-linking`:

```typescript
// Simplified React Native implementation
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

const BROWSER_SCHEMES: Record<string, { ios: string; android?: string }> = {
  chrome: {
    ios: 'googlechromes://',
    android: 'intent://HOST#Intent;scheme=https;package=com.android.chrome;end'
  },
  firefox: {
    ios: 'firefox://open-url?url=',
    android: 'intent://HOST#Intent;scheme=https;package=org.mozilla.firefox;end'
  },
  edge: {
    ios: 'microsoft-edge://',
    android: 'intent://HOST#Intent;scheme=https;package=com.microsoft.emmx;end'
  },
  safari: { ios: 'https://' },  // Default
  other: { ios: 'https://' },   // Default
};

async function openReturnUrl(returnUrl: string, sourceBrowser?: string): Promise<void> {
  if (!sourceBrowser || sourceBrowser === 'safari' || sourceBrowser === 'other') {
    await Linking.openURL(returnUrl);
    return;
  }

  const scheme = BROWSER_SCHEMES[sourceBrowser.toLowerCase()];
  if (!scheme) {
    await Linking.openURL(returnUrl);
    return;
  }

  const browserUrl = Platform.select({
    ios: constructIOSUrl(returnUrl, sourceBrowser, scheme.ios),
    android: constructAndroidUrl(returnUrl, sourceBrowser, scheme.android),
  });

  if (browserUrl) {
    const canOpen = await Linking.canOpenURL(browserUrl);
    if (canOpen) {
      await Linking.openURL(browserUrl);
      return;
    }
  }

  // Fallback to default
  await Linking.openURL(returnUrl);
}
```

#### Expo Config Plugin

We'll need to create or update an Expo config plugin to add the URL schemes to `Info.plist`:

```typescript
// app.config.ts addition
export default {
  // ... existing config
  ios: {
    infoPlist: {
      LSApplicationQueriesSchemes: [
        'googlechromes',
        'firefox',
        'microsoft-edge',
        'opera',
        'brave',
      ],
    },
  },
};
```

### Accepted With Minor Clarification

One clarification on the deep link example:

```
# Current example (URL needs double-encoding)
mwsim://payment/abc123?returnUrl=https://store.com/checkout?mwsim_return=abc123&sourceBrowser=chrome
```

The `returnUrl` parameter should be URL-encoded since it contains its own query params. SSIM's example code shows this correctly with `encodeURIComponent()`. Just want to confirm SSIM will always encode the returnUrl.

### Summary

| Item | Decision |
|------|----------|
| Proposal | Approved |
| URL scheme approach | Agreed |
| Browser detection on SSIM | Agreed |
| Fallback to default | Agreed |
| Timeline | 2-3 days mwsim side |

We'll begin implementation once SSIM confirms the `returnUrl` encoding approach.

---

*mwsim Team Response: December 14, 2025*
*Status: APPROVED - Ready for Implementation*
