/**
 * VitaLink Feature Flags
 * Central configuration for enabling/disabling platform features
 */

export const FEATURE_FLAGS = {
  // Onboarding Tours System
  // Temporarily disabled for development mode
  // Can be re-enabled via Developer Settings by authorized roles
  onboardingToursEnabled: false,

  // Future flags for other features
  // aiClinicalIntelligenceEnabled: true,
  // telemedicineEnabled: true,
  // switchNetworkEnabled: true,
} as const;

export type FeatureFlag = keyof typeof FEATURE_FLAGS;

/**
 * Check if a feature flag is enabled
 */
export function isFeatureEnabled(flag: FeatureFlag): boolean {
  // Check localStorage for developer overrides
  const override = localStorage.getItem(`feature-flag-${flag}`);
  if (override !== null) {
    return override === 'true';
  }
  
  return FEATURE_FLAGS[flag];
}

/**
 * Set a feature flag override (for developer mode)
 */
export function setFeatureOverride(flag: FeatureFlag, enabled: boolean): void {
  localStorage.setItem(`feature-flag-${flag}`, String(enabled));
}

/**
 * Clear a feature flag override
 */
export function clearFeatureOverride(flag: FeatureFlag): void {
  localStorage.removeItem(`feature-flag-${flag}`);
}

/**
 * Reset all feature flag overrides
 */
export function resetAllFeatureOverrides(): void {
  Object.keys(FEATURE_FLAGS).forEach((flag) => {
    localStorage.removeItem(`feature-flag-${flag}`);
  });
}
