import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DraftRecovery,
  DraftService,
  SyncQueue,
  type OnboardingDraft,
  type OnboardingPatientDraftData,
} from '@/lib/onboardingDraft';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed' | 'queued';

interface UseOnboardingDraftInput {
  open: boolean;
  tenantId: string;
  userId: string;
  sessionId: string;
  currentStep: number;
  data: OnboardingPatientDraftData;
  isDirty: boolean;
  onRestore: (draft: OnboardingDraft) => void;
}

export function useOnboardingDraft({
  open,
  tenantId,
  userId,
  sessionId,
  currentStep,
  data,
  isDirty,
  onRestore,
}: UseOnboardingDraftInput) {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [pendingRecoveryDraft, setPendingRecoveryDraft] = useState<OnboardingDraft | null>(null);
  const [activeDraft, setActiveDraft] = useState<OnboardingDraft | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const saveInFlightRef = useRef(false);
  const lastSavedPayloadRef = useRef('');
  const mountedRef = useRef(false);

  const draftId = useMemo(() => DraftService.buildId(tenantId, userId, sessionId), [tenantId, userId, sessionId]);

  const buildDraft = useCallback((): OnboardingDraft => {
    const previous = activeDraft;
    return previous
      ? { ...previous, tenantId, userId, sessionId, currentStep, data }
      : DraftService.create(tenantId, userId, sessionId, data, currentStep);
  }, [activeDraft, currentStep, data, sessionId, tenantId, userId]);

  const saveNow = useCallback(
    async (forceServerSync = false) => {
      if (!open || saveInFlightRef.current || (!isDirty && !forceServerSync)) return activeDraft;
      const nextDraft = buildDraft();
      const payloadKey = JSON.stringify({ currentStep: nextDraft.currentStep, data: nextDraft.data });
      if (!forceServerSync && payloadKey === lastSavedPayloadRef.current) return activeDraft ?? nextDraft;

      saveInFlightRef.current = true;
      setSaveStatus('saving');
      try {
        const saved = await DraftService.save({ draft: nextDraft, forceServerSync });
        lastSavedPayloadRef.current = payloadKey;
        setActiveDraft(saved);
        setLastSavedAt(saved.lastSyncedAt ?? saved.updatedAt);
        setSaveStatus(saved.syncStatus === 'queued' ? 'queued' : 'saved');
        setHasUnsavedChanges(false);
        return saved;
      } catch {
        setSaveStatus('failed');
        setHasUnsavedChanges(true);
        throw new Error('Failed to save draft');
      } finally {
        saveInFlightRef.current = false;
      }
    },
    [activeDraft, buildDraft, isDirty, open],
  );

  const discardDraft = useCallback(async () => {
    await DraftService.discard(draftId);
    setActiveDraft(null);
    setPendingRecoveryDraft(null);
    lastSavedPayloadRef.current = '';
    setHasUnsavedChanges(false);
    setSaveStatus('idle');
    setLastSavedAt(null);
  }, [draftId]);

  const continueDraft = useCallback(() => {
    if (!pendingRecoveryDraft) return;
    onRestore(pendingRecoveryDraft);
    setActiveDraft(pendingRecoveryDraft);
    setLastSavedAt(pendingRecoveryDraft.lastSyncedAt ?? pendingRecoveryDraft.updatedAt);
    setSaveStatus(pendingRecoveryDraft.syncStatus === 'queued' ? 'queued' : 'saved');
    lastSavedPayloadRef.current = JSON.stringify({ currentStep: pendingRecoveryDraft.currentStep, data: pendingRecoveryDraft.data });
    setPendingRecoveryDraft(null);
  }, [onRestore, pendingRecoveryDraft]);

  const startNewDraft = useCallback(() => {
    setPendingRecoveryDraft(null);
    setActiveDraft(null);
    lastSavedPayloadRef.current = '';
    setSaveStatus('idle');
    setLastSavedAt(null);
    setHasUnsavedChanges(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const recoverable = DraftRecovery.findRecoverableDraft(tenantId, userId);
    if (recoverable) {
      setPendingRecoveryDraft(recoverable);
    }
  }, [open, tenantId, userId]);

  useEffect(() => {
    if (!open || !isDirty || pendingRecoveryDraft) return;
    setHasUnsavedChanges(true);
    const timeout = window.setTimeout(() => {
      void saveNow(false);
    }, 2000);
    return () => window.clearTimeout(timeout);
  }, [data, currentStep, isDirty, open, pendingRecoveryDraft, saveNow]);

  useEffect(() => {
    if (!open || pendingRecoveryDraft) return;
    const interval = window.setInterval(() => {
      if (isDirty) void saveNow(false);
    }, 10000);
    return () => window.clearInterval(interval);
  }, [isDirty, open, pendingRecoveryDraft, saveNow]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      void SyncQueue.flush().then(() => {
        const refreshed = DraftRecovery.findRecoverableDraft(tenantId, userId);
        if (refreshed) {
          setActiveDraft(refreshed);
          setLastSavedAt(refreshed.lastSyncedAt ?? refreshed.updatedAt);
          setSaveStatus(refreshed.syncStatus === 'queued' ? 'queued' : 'saved');
        }
      });
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [tenantId, userId]);

  useEffect(() => {
    if (!open) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) return;
      event.preventDefault();
      event.returnValue = 'You have unsaved changes.';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges, open]);

  useEffect(() => {
    if (!open || mountedRef.current) return;
    mountedRef.current = true;
    void SyncQueue.flush();
  }, [open]);

  useEffect(() => {
    if (!open) {
      mountedRef.current = false;
    }
  }, [open]);

  const statusLabel = useMemo(() => {
    if (saveStatus === 'saving') return 'Saving...';
    if (saveStatus === 'failed') return 'Failed to save';
    if (saveStatus === 'queued') return 'Saved offline';
    if (!lastSavedAt) return 'Auto-save ready';
    const savedDate = new Date(lastSavedAt);
    const ageMs = Date.now() - savedDate.getTime();
    if (ageMs < 60_000) return 'Saved just now';
    return `Last saved ${savedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }, [lastSavedAt, saveStatus]);

  return {
    activeDraft,
    pendingRecoveryDraft,
    saveNow,
    discardDraft,
    continueDraft,
    startNewDraft,
    saveStatus,
    statusLabel,
    lastSavedAt,
    hasUnsavedChanges,
    setHasUnsavedChanges,
    isOnline,
  };
}
