// Applies the signed-in user's saved profile across the app: their name in the
// header, and appearance preferences that follow them between devices.
import { useEffect, useRef } from 'react';
import { applyFontScale, applyTheme, getSavedTheme } from '@/lib/theme';
import { useAuth } from '@/contexts/AuthContext';
import { initialsOf, useMyProfile } from '@/hooks/useMyProfile';

export function ProfileSync() {
  const profile = useMyProfile();
  const { setUserProfile } = useAuth();
  const appliedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    setUserProfile({ name: profile.fullName || profile.email, email: profile.email, avatar: initialsOf(profile.fullName || profile.email) });
    // Saved appearance wins once per sign-in; later changes on this device save back to the profile.
    if (appliedFor.current === profile.id) return;
    appliedFor.current = profile.id;
    const { theme, fontScale } = profile.preferences;
    if (theme && theme !== getSavedTheme()) applyTheme(theme);
    if (fontScale) applyFontScale(fontScale);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setUserProfile is recreated each render
  }, [profile]);

  return null;
}
