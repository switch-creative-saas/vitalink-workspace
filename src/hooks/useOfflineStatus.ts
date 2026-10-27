import { useSyncExternalStore } from 'react';
import { getOfflineStatus, subscribeOffline } from '@/lib/offline/sync';

/** Connection state, changes waiting to sync, and whether saved data is on screen. */
export const useOfflineStatus = () => useSyncExternalStore(subscribeOffline, getOfflineStatus);
