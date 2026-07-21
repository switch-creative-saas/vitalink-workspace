import type { RegistryPatient } from '@/lib/patientRegistry';

export type OnboardingPatientDraftData = Omit<RegistryPatient, 'id' | 'switchId' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'> & {
  notes?: string;
  uploadedFiles?: DraftFile[];
};

export interface DraftFile {
  id: string;
  name: string;
  size: number;
  type: string;
  lastModified: number;
  dataUrl?: string;
}

export interface OnboardingDraft {
  id: string;
  tenantId: string;
  userId: string;
  sessionId: string;
  currentStep: number;
  data: OnboardingPatientDraftData;
  createdAt: string;
  updatedAt: string;
  lastSyncedAt?: string;
  syncStatus: 'local' | 'synced' | 'queued' | 'failed';
  version: number;
}

const DRAFTS_KEY = 'vitalink-patient-onboarding-drafts-v1';
const SERVER_DRAFTS_KEY = 'vitalink-patient-onboarding-server-drafts-v1';
const QUEUE_KEY = 'vitalink-patient-onboarding-sync-queue-v1';

const readJson = <T>(key: string, fallback: T): T => {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const writeJson = (key: string, value: unknown) => {
  localStorage.setItem(key, JSON.stringify(value));
};

export const DraftStorage = {
  getAll(): OnboardingDraft[] {
    return readJson<OnboardingDraft[]>(DRAFTS_KEY, []);
  },

  get(id: string) {
    return this.getAll().find((draft) => draft.id === id) ?? null;
  },

  findLatest(tenantId: string, userId: string) {
    return (
      this.getAll()
        .filter((draft) => draft.tenantId === tenantId && draft.userId === userId)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0] ?? null
    );
  },

  upsert(draft: OnboardingDraft) {
    const next = [draft, ...this.getAll().filter((item) => item.id !== draft.id)];
    writeJson(DRAFTS_KEY, next);
    return draft;
  },

  remove(id: string) {
    writeJson(DRAFTS_KEY, this.getAll().filter((draft) => draft.id !== id));
  },
};

export const ServerDraft = {
  async save(draft: OnboardingDraft) {
    await new Promise((resolve) => window.setTimeout(resolve, 280));
    if (!navigator.onLine) {
      throw new Error('Offline');
    }
    const serverDraft = { ...draft, syncStatus: 'synced' as const, lastSyncedAt: new Date().toISOString() };
    const all = readJson<OnboardingDraft[]>(SERVER_DRAFTS_KEY, []);
    writeJson(SERVER_DRAFTS_KEY, [serverDraft, ...all.filter((item) => item.id !== draft.id)]);
    return serverDraft;
  },

  async remove(id: string) {
    await new Promise((resolve) => window.setTimeout(resolve, 120));
    writeJson(SERVER_DRAFTS_KEY, readJson<OnboardingDraft[]>(SERVER_DRAFTS_KEY, []).filter((draft) => draft.id !== id));
  },
};

export const SyncQueue = {
  enqueue(draftId: string) {
    const queue = readJson<string[]>(QUEUE_KEY, []);
    if (!queue.includes(draftId)) {
      writeJson(QUEUE_KEY, [...queue, draftId]);
    }
  },

  remove(draftId: string) {
    writeJson(QUEUE_KEY, readJson<string[]>(QUEUE_KEY, []).filter((id) => id !== draftId));
  },

  async flush() {
    if (!navigator.onLine) return;
    const queue = readJson<string[]>(QUEUE_KEY, []);
    for (const draftId of queue) {
      const draft = DraftStorage.get(draftId);
      if (!draft) {
        this.remove(draftId);
        continue;
      }
      try {
        const synced = await ServerDraft.save(draft);
        DraftStorage.upsert(synced);
        this.remove(draftId);
      } catch {
        DraftStorage.upsert({ ...draft, syncStatus: 'failed' });
      }
    }
  },
};

export const DraftService = {
  buildId(tenantId: string, userId: string, sessionId: string) {
    return `${tenantId}::${userId}::${sessionId}`;
  },

  create(tenantId: string, userId: string, sessionId: string, data: OnboardingPatientDraftData, currentStep: number): OnboardingDraft {
    const now = new Date().toISOString();
    return {
      id: this.buildId(tenantId, userId, sessionId),
      tenantId,
      userId,
      sessionId,
      currentStep,
      data,
      createdAt: now,
      updatedAt: now,
      syncStatus: 'local',
      version: 1,
    };
  },

  async save(input: { draft: OnboardingDraft; forceServerSync?: boolean }) {
    const localDraft: OnboardingDraft = {
      ...input.draft,
      updatedAt: new Date().toISOString(),
      version: input.draft.version + 1,
      syncStatus: navigator.onLine ? 'local' : 'queued',
    };
    DraftStorage.upsert(localDraft);
    if (!navigator.onLine) {
      SyncQueue.enqueue(localDraft.id);
      return localDraft;
    }
    try {
      const synced = await ServerDraft.save(localDraft);
      DraftStorage.upsert(synced);
      SyncQueue.remove(synced.id);
      return synced;
    } catch {
      const queued = { ...localDraft, syncStatus: input.forceServerSync ? ('failed' as const) : ('queued' as const) };
      DraftStorage.upsert(queued);
      SyncQueue.enqueue(queued.id);
      if (input.forceServerSync) throw new Error('Failed to save draft');
      return queued;
    }
  },

  async discard(draftId: string) {
    DraftStorage.remove(draftId);
    SyncQueue.remove(draftId);
    await ServerDraft.remove(draftId);
  },
};

export const DraftRecovery = {
  findRecoverableDraft(tenantId: string, userId: string) {
    return DraftStorage.findLatest(tenantId, userId);
  },
};
