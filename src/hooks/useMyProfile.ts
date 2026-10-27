import { useEffect, useState } from 'react';
import { getMyProfile, onProfileChange, type MyProfile } from '@/lib/supabase/profile';

/** The signed-in user's profile; reloads whenever any component saves a change. */
export function useMyProfile() {
  const [profile, setProfile] = useState<MyProfile | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => { getMyProfile().then((p) => { if (alive) setProfile(p); }).catch(() => undefined); };
    load();
    const off = onProfileChange(load);
    return () => { alive = false; off(); };
  }, []);
  return profile;
}

export const initialsOf = (name: string, fallback = 'VL') =>
  name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join('').toUpperCase() || fallback;
