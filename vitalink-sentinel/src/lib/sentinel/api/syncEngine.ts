/**
 * VitaLink Sentinel Sync Engine
 * Handles offline-first synchronization with mock backend
 */

import type { PendingOperation, SyncStatus } from '@/types/sentinel';

const SYNC_INTERVAL = 30000; // 30 seconds
const MAX_RETRIES = 3;
const STORAGE_KEY = 'vitalink-sentinel-pending-ops';

// Sync state
let syncState: {
  isOnline: boolean;
  isSyncing: boolean;
  lastSync: string | null;
  listeners: Set<(status: SyncStatus) => void>;
} = {
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  isSyncing: false,
  lastSync: null,
  listeners: new Set(),
};

// Initialize sync engine
export function initSyncEngine(): void {
  if (typeof window === 'undefined') return;
  
  // Listen for online/offline events
  window.addEventListener('online', () => {
    syncState.isOnline = true;
    broadcastStatus();
    triggerSync();
  });
  
  window.addEventListener('offline', () => {
    syncState.isOnline = false;
    broadcastStatus();
  });
  
  // Periodic sync check
  setInterval(() => {
    if (syncState.isOnline && !syncState.isSyncing && hasPendingOperations()) {
      triggerSync();
    }
  }, SYNC_INTERVAL);
  
  // Initial sync if online
  if (syncState.isOnline) {
    triggerSync();
  }
}

// Subscribe to sync status changes
export function subscribeToSync(callback: (status: SyncStatus) => void): () => void {
  syncState.listeners.add(callback);
  
  // Send initial status
  callback(getSyncStatus());
  
  return () => {
    syncState.listeners.delete(callback);
  };
}

// Broadcast status to all listeners
function broadcastStatus(): void {
  const status = getSyncStatus();
  syncState.listeners.forEach(listener => listener(status));
}

// Get current sync status
export function getSyncStatus(): SyncStatus {
  return {
    lastSync: syncState.lastSync,
    pendingCount: getPendingOperations().length,
    isSyncing: syncState.isSyncing,
    error: undefined,
  };
}

// Queue an operation for sync
export function queueOperation(operation: Omit<PendingOperation, 'id' | 'timestamp' | 'retryCount'>): void {
  const pending = getPendingOperations();
  
  const newOp: PendingOperation = {
    ...operation,
    id: `op-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: new Date().toISOString(),
    retryCount: 0,
  };
  
  pending.push(newOp);
  savePendingOperations(pending);
  
  broadcastStatus();
  
  // Try to sync immediately if online
  if (syncState.isOnline && !syncState.isSyncing) {
    triggerSync();
  }
}

// Get pending operations
export function getPendingOperations(): PendingOperation[] {
  if (typeof localStorage === 'undefined') return [];
  
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

// Save pending operations
function savePendingOperations(operations: PendingOperation[]): void {
  if (typeof localStorage === 'undefined') return;
  
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(operations));
  } catch (e) {
    console.error('[SyncEngine] Failed to save pending operations:', e);
  }
}

// Check if there are pending operations
export function hasPendingOperations(): boolean {
  return getPendingOperations().length > 0;
}

// Trigger sync process
export async function triggerSync(): Promise<void> {
  if (syncState.isSyncing || !syncState.isOnline) return;
  
  syncState.isSyncing = true;
  broadcastStatus();
  
  const pending = getPendingOperations();
  const failed: PendingOperation[] = [];
  
  for (const operation of pending) {
    try {
      await processOperation(operation);
    } catch (error) {
      console.error(`[SyncEngine] Failed to process operation ${operation.id}:`, error);
      
      if (operation.retryCount < MAX_RETRIES) {
        failed.push({
          ...operation,
          retryCount: operation.retryCount + 1,
        });
      }
    }
  }
  
  savePendingOperations(failed);
  syncState.lastSync = new Date().toISOString();
  syncState.isSyncing = false;
  
  broadcastStatus();
}

// Process a single operation
async function processOperation(operation: PendingOperation): Promise<void> {
  // Simulate API call delay
  await new Promise(resolve => setTimeout(resolve, 300));
  
  // Simulate occasional failures (10% chance) for testing retry logic
  if (Math.random() < 0.1) {
    throw new Error('Simulated sync failure');
  }
  
  console.log(`[SyncEngine] Processed ${operation.type} operation for ${operation.entity}`, operation.data);
}

// Force immediate sync
export async function forceSync(): Promise<void> {
  return triggerSync();
}

// Clear all pending operations (for testing)
export function clearPendingOperations(): void {
  savePendingOperations([]);
  broadcastStatus();
}

// Hook for React components
export function useSyncStatus(): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>(getSyncStatus);
  
  useEffect(() => {
    return subscribeToSync(setStatus);
  }, []);
  
  return status;
}

// Manual sync trigger hook
export function useSyncActions() {
  return {
    syncNow: forceSync,
    clearPending: clearPendingOperations,
  };
}

// Need to import for the hook
import { useState, useEffect } from 'react';
