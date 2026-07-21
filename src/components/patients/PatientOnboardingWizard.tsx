import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, Clock, FileText, Loader2, Nfc, Save, Trash2, UploadCloud, WifiOff } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { PatientStatus, PatientTag, RegistryPatient } from '@/lib/patientRegistry';
import { createPatient } from '@/lib/patientRegistry';
import { useOnboardingDraft } from '@/hooks/useOnboardingDraft';
import type { DraftFile, OnboardingDraft, OnboardingPatientDraftData } from '@/lib/onboardingDraft';
import { BRAND } from '@/config/brand';

type Draft = OnboardingPatientDraftData;

const initialDraft = (tenantId: string): Draft => ({
  tenantId,
  firstName: '',
  middleName: '',
  lastName: '',
  dateOfBirth: '',
  gender: 'male',
  phone: '',
  email: '',
  address: '',
  state: '',
  country: '',
  maritalStatus: '',
  occupation: '',
  nationalId: '',
  profilePhoto: '',
  bloodGroup: '',
  genotype: '',
  allergies: '',
  chronicConditions: '',
  currentMedications: '',
  familyMedicalHistory: '',
  pastSurgeries: '',
  disabilityStatus: '',
  pregnancyStatus: '',
  emergencyContactName: '',
  emergencyRelationship: '',
  emergencyPhone: '',
  emergencyAddress: '',
  insuranceProvider: '',
  insurancePolicyNumber: '',
  insuranceExpiryDate: '',
  insuranceType: '',
  nfcCardId: '',
  nfcActive: false,
  status: 'active',
  tags: [],
  documents: [],
  timeline: [],
  doctorAssigned: '',
  department: '',
  admissionStatus: 'Outpatient',
  insuranceProviderFilter: '',
  notes: '',
  uploadedFiles: [],
});

const steps = ['Basic Info', 'Medical Info', 'Emergency Contact', 'Insurance', 'NFC & Confirm'];
const inputClass = 'w-full min-w-0';
const selectClass = 'h-10 w-full min-w-0 rounded-md border border-input px-3 text-sm bg-white';
const grid3Class = 'grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4';
const grid2Class = 'grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4';

const requiredFieldsByStep: Record<number, Array<keyof Draft>> = {
  1: ['firstName', 'lastName', 'dateOfBirth', 'phone', 'address', 'state', 'country'],
  2: [],
  3: ['emergencyContactName', 'emergencyRelationship', 'emergencyPhone'],
  4: [],
  5: [],
};

const readFileAsDraftFile = (file: File): Promise<DraftFile> =>
  new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({
        id: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        type: file.type,
        lastModified: file.lastModified,
        dataUrl: typeof reader.result === 'string' ? reader.result : undefined,
      });
    reader.readAsDataURL(file);
  });

const stripDraftOnlyFields = (draft: Draft): Omit<RegistryPatient, 'id' | 'switchId' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'> => {
  const { notes, uploadedFiles, ...patient } = draft;
  return {
    ...patient,
    documents: [...(patient.documents ?? []), ...(uploadedFiles ?? []).map((file) => file.name), ...(notes ? [`Notes: ${notes}`] : [])],
  };
};

interface PatientOnboardingWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
  creatorName: string;
  canCreate: boolean;
  onCreated?: () => void;
}

export function PatientOnboardingWizard({
  open,
  onOpenChange,
  tenantId,
  creatorName,
  canCreate,
  onCreated,
}: PatientOnboardingWizardProps) {
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [draft, setDraft] = useState<Draft>(initialDraft(tenantId));
  const [registrationSessionId, setRegistrationSessionId] = useState<string>(() => crypto.randomUUID());
  const [showExitDialog, setShowExitDialog] = useState(false);
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const [isPreparingDraft, setIsPreparingDraft] = useState(false);
  const [invalidFields, setInvalidFields] = useState<Array<keyof Draft>>([]);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const canProceed = useMemo(() => {
    if (step === 1) {
      return Boolean(draft.firstName && draft.lastName && draft.dateOfBirth && draft.phone && draft.address && draft.state && draft.country);
    }
    if (step === 3) {
      return Boolean(draft.emergencyContactName && draft.emergencyRelationship && draft.emergencyPhone);
    }
    return true;
  }, [step, draft]);

  const hasUnsavedChanges = useMemo(() => {
    return JSON.stringify(draft) !== JSON.stringify(initialDraft(tenantId));
  }, [draft, tenantId]);

  const restoreDraft = (savedDraft: OnboardingDraft) => {
    setRegistrationSessionId(savedDraft.sessionId);
    setDraft({ ...initialDraft(savedDraft.tenantId), ...savedDraft.data, tenantId: savedDraft.tenantId });
    setStep(savedDraft.currentStep);
    window.setTimeout(() => contentRef.current?.scrollTo({ top: 0, behavior: 'smooth' }), 120);
  };

  const draftController = useOnboardingDraft({
    open,
    tenantId,
    userId: creatorName,
    sessionId: registrationSessionId,
    currentStep: step,
    data: draft,
    isDirty: hasUnsavedChanges,
    onRestore: restoreDraft,
  });

  const stepProgress = useMemo(() => {
    const allRequired = Object.values(requiredFieldsByStep).flat();
    const completedRequired = allRequired.filter((field) => Boolean(String(draft[field] ?? '').trim())).length;
    return Math.round((completedRequired / allRequired.length) * 100);
  }, [draft]);

  const stepStatuses = useMemo(() => {
    return steps.map((name, index) => {
      const stepNumber = index + 1;
      const required = requiredFieldsByStep[stepNumber];
      const hasRequired = required.length > 0;
      const complete = !hasRequired || required.every((field) => Boolean(String(draft[field] ?? '').trim()));
      const touched = required.some((field) => Boolean(String(draft[field] ?? '').trim())) || stepNumber === step;
      const hasError = invalidFields.some((field) => required.includes(field));
      return {
        name,
        stepNumber,
        hasError,
        status: complete ? 'Completed' : touched ? 'In Progress' : 'Not Started',
      };
    });
  }, [draft, invalidFields, step]);

  useEffect(() => {
    if (!open) return;
    setIsPreparingDraft(true);
    const timeout = window.setTimeout(() => setIsPreparingDraft(false), 350);
    return () => window.clearTimeout(timeout);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void forceSaveDraft();
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        requestClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, draft, step, hasUnsavedChanges]);

  useEffect(() => {
    const guardedWindow = window as Window & { __vitalinkOnboardingRouteGuard?: () => boolean };
    if (!open) {
      delete guardedWindow.__vitalinkOnboardingRouteGuard;
      return;
    }
    guardedWindow.__vitalinkOnboardingRouteGuard = () => {
      if (hasUnsavedChanges || draftController.hasUnsavedChanges || draftController.saveStatus === 'failed') {
        setShowExitDialog(true);
        return false;
      }
      return true;
    };
    return () => {
      delete guardedWindow.__vitalinkOnboardingRouteGuard;
    };
  }, [draftController.hasUnsavedChanges, draftController.saveStatus, hasUnsavedChanges, open]);

  const updateField = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setInvalidFields((prev) => prev.filter((field) => field !== key));
  };

  const findValidationErrors = () => {
    const errors: Array<keyof Draft> = [];
    Object.values(requiredFieldsByStep).flat().forEach((field) => {
      if (!String(draft[field] ?? '').trim()) errors.push(field);
    });
    const emailPattern = /^\S+@\S+\.\S+$/;
    const phonePattern = /^\+?[0-9]{10,15}$/;
    if (draft.email && !emailPattern.test(draft.email)) {
      errors.push('email');
    }
    if (draft.phone && !phonePattern.test(draft.phone)) {
      errors.push('phone');
    }
    if (draft.emergencyPhone && !phonePattern.test(draft.emergencyPhone)) {
      errors.push('emergencyPhone');
    }
    return errors;
  };

  const scrollToFirstInvalidField = (fields: Array<keyof Draft>) => {
    const first = fields[0];
    if (!first) return;
    window.setTimeout(() => {
      const field = contentRef.current?.querySelector(`[data-draft-field="${String(first)}"]`);
      field?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
  };

  const validate = () => {
    const errors = findValidationErrors();
    if (errors.length === 0) return true;
    setInvalidFields(errors);
    const firstErrorStep = Number(Object.entries(requiredFieldsByStep).find(([, fields]) => fields.some((field) => errors.includes(field as keyof Draft)))?.[0] ?? step);
    setStep(firstErrorStep);
    scrollToFirstInvalidField(errors);
    toast.error('Please complete the highlighted required fields.');
    return false;
  };

  const requestClose = () => {
    if (hasUnsavedChanges || draftController.hasUnsavedChanges || draftController.saveStatus === 'failed') {
      setShowExitDialog(true);
      return;
    }
    onOpenChange(false);
  };

  const forceSaveDraft = async () => {
    try {
      await draftController.saveNow(true);
      toast.success('Draft saved successfully', {
        description: navigator.onLine ? 'Synchronized with draft storage.' : 'Saved locally and queued for synchronization.',
      });
    } catch {
      toast.error('Draft save failed', { description: 'Your latest changes remain local and will retry when possible.' });
    }
  };

  const discardDraftAndClose = async () => {
    await draftController.discardDraft();
    setDraft(initialDraft(tenantId));
    setStep(1);
    setRegistrationSessionId(crypto.randomUUID());
    setShowDiscardDialog(false);
    setShowExitDialog(false);
    toast.success('Draft discarded');
    onOpenChange(false);
  };

  const startNewRegistration = () => {
    draftController.startNewDraft();
    setDraft(initialDraft(tenantId));
    setStep(1);
    setRegistrationSessionId(crypto.randomUUID());
  };

  const continueRecoveredDraft = () => {
    draftController.continueDraft();
    toast.success('Draft restored', { description: 'All fields, files, photo links, and step position were restored.' });
  };

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files?.length) return;
    const converted = await Promise.all(Array.from(files).map(readFileAsDraftFile));
    updateField('uploadedFiles', [...(draft.uploadedFiles ?? []), ...converted]);
    toast.success(`${converted.length} file${converted.length === 1 ? '' : 's'} attached to draft`);
  };

  const removeDraftFile = (id: string) => {
    updateField('uploadedFiles', (draft.uploadedFiles ?? []).filter((file) => file.id !== id));
  };

  const fieldClass = (field: keyof Draft, className = inputClass) =>
    cn(
      className,
      invalidFields.includes(field) &&
        'border-red-400 bg-red-50/50 ring-2 ring-red-100 animate-[pulse_0.9s_ease-in-out_1]',
    );

  const submit = async () => {
    if (!canCreate) {
      toast.error('Permission denied: RBAC policy blocks patient creation.');
      return;
    }
    try {
      if (!validate()) return;
      setSubmitting(true);
      await createPatient(creatorName, {
        ...stripDraftOnlyFields(draft),
        tenantId,
        insuranceProviderFilter: draft.insuranceProvider,
      });
      toast.success('Patient registered successfully', {
        description: `${BRAND.patientIdLabel} has been generated and audit entry recorded.`,
      });
      await draftController.discardDraft();
      setDraft(initialDraft(tenantId));
      setStep(1);
      setRegistrationSessionId(crypto.randomUUID());
      onOpenChange(false);
      onCreated?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to create patient';
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <style>{`
        /* Overlay Custom Styles & Entry Fade In */
        .onboarding-overlay {
          background-color: rgba(0, 0, 0, 0.4) !important;
          backdrop-filter: blur(7px) !important;
          animation: onboarding-fade-in 250ms ease-out forwards !important;
        }

        /* Modal Container Custom Styles & Scale/Opacity Entrance */
        .onboarding-content {
          animation: onboarding-scale-up 250ms ease-out forwards !important;
          border-radius: 24px !important;
          border: 1px solid rgba(255, 255, 255, 0.7) !important;
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.08), 0 10px 10px -5px rgba(0, 0, 0, 0.04) !important;
        }

        @keyframes onboarding-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes onboarding-scale-up {
          from {
            opacity: 0;
            transform: translate(-50%, -50%) scale(0.97);
          }
          to {
            opacity: 1;
            transform: translate(-50%, -50%) scale(1);
          }
        }
      `}</style>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            requestClose();
            return;
          }
          onOpenChange(true);
        }}
      >
        <DialogContent
          overlayClassName="onboarding-overlay"
          className="max-w-none onboarding-content border border-white/70 overflow-hidden p-0 bg-white/95"
          showCloseButton={false}
          style={{ width: '91vw', maxWidth: '1480px', height: '90vh', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            requestClose();
          }}
        >
          <DialogHeader className="px-4 py-4 sm:px-6 sm:py-5 border-b border-gray-100 bg-gradient-to-r from-royal-50/80 to-indigo-50/60 flex-shrink-0">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <DialogTitle className="text-[#1E4ED8]">Patient Onboarding Wizard</DialogTitle>
                <p className="text-xs text-gray-500">Enterprise Registration Workflow</p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
                <span
                  className={cn(
                    'inline-flex items-center gap-2 rounded-full border bg-white px-3 py-1.5 shadow-sm',
                    draftController.saveStatus === 'failed' && 'border-red-200 bg-red-50 text-red-700',
                    draftController.saveStatus === 'queued' && 'border-amber-200 bg-amber-50 text-amber-700',
                    draftController.saveStatus === 'saving' && 'border-blue-200 bg-blue-50 text-blue-700',
                  )}
                >
                  {draftController.saveStatus === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : draftController.isOnline ? <Clock className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
                  {draftController.statusLabel}
                </span>
                <Button size="sm" variant="outline" className="h-8 gap-2" onClick={forceSaveDraft}>
                  <Save className="h-3.5 w-3.5" />
                  Save Draft
                </Button>
                <Button size="sm" variant="outline" className="h-8 border-red-200 text-red-700 hover:bg-red-50" onClick={() => setShowDiscardDialog(true)}>
                  <Trash2 className="h-3.5 w-3.5" />
                  Discard
                </Button>
                <Button size="sm" variant="outline" className="h-8" onClick={requestClose}>
                  Close
                </Button>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between text-xs text-gray-600">
                <span>Step {step} of {steps.length}</span>
                <span>{stepProgress}% Complete</span>
              </div>
              <Progress value={stepProgress} className="h-2 bg-white/80" />
            </div>
          </DialogHeader>
          
          <div className="flex flex-col md:flex-row flex-1 overflow-hidden" style={{ minHeight: 0 }}>
            {/* LEFT — Steps sidebar: vertical on desktop, horizontal scroll on mobile */}
            <div className="w-full md:w-[240px] max-h-[120px] md:max-h-none flex-shrink-0 border-b md:border-b-0 md:border-r border-gray-100 p-4 md:p-6 flex flex-row md:flex-col gap-2 overflow-x-auto md:overflow-y-auto bg-white/70">
              <p className="hidden md:block text-xs font-semibold tracking-wide uppercase text-gray-500 mb-3">Onboarding Steps</p>
              <div className="flex flex-row md:flex-col gap-2 w-full">
                {stepStatuses.map((item) => (
                  <button
                    key={item.name}
                    onClick={() => setStep(item.stepNumber)}
                    className={cn(
                      'flex items-center justify-between rounded-xl px-3 py-2 text-xs md:text-sm transition-all text-left whitespace-nowrap',
                      step === item.stepNumber ? 'bg-[#1E4ED8] text-white shadow-md' : 'bg-gray-50 text-gray-600 hover:bg-gray-100',
                      item.hasError && step !== item.stepNumber && 'border border-amber-200 bg-amber-50 text-amber-700',
                    )}
                    style={{ flexShrink: 0 }}
                  >
                    <span className="min-w-0">
                      <span className="block truncate">{item.name}</span>
                      <span className={cn('hidden md:block text-[11px]', step === item.stepNumber ? 'text-white/80' : 'text-gray-400')}>
                        {item.status}
                      </span>
                    </span>
                    {item.hasError ? <AlertTriangle className="hidden md:block w-4 h-4 ml-2 text-amber-500" /> : <ChevronRight className="hidden md:block w-4 h-4 ml-2" />}
                  </button>
                ))}
              </div>
            </div>

            {/* RIGHT — Form content: takes remaining width */}
            <div ref={contentRef} style={{ flex: 1, padding: '32px 40px', overflowY: 'auto', minWidth: 0 }} className="bg-white scroll-smooth">
              {isPreparingDraft ? (
                <div className="space-y-4">
                  <Skeleton className="h-7 w-64" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-28 w-full" />
                </div>
              ) : step === 1 && (
                <div className="space-y-5">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900 mb-3">Identity Details</h3>
                    <div className={grid3Class}>
                      <Input data-draft-field="firstName" className={fieldClass('firstName')} placeholder="First name *" value={draft.firstName} onChange={(e) => updateField('firstName', e.target.value)} />
                      <Input data-draft-field="middleName" className={fieldClass('middleName')} placeholder="Middle name" value={draft.middleName} onChange={(e) => updateField('middleName', e.target.value)} />
                      <Input data-draft-field="lastName" className={fieldClass('lastName')} placeholder="Last name *" value={draft.lastName} onChange={(e) => updateField('lastName', e.target.value)} />
                    </div>
                    <div className={grid3Class}>
                      <Input data-draft-field="dateOfBirth" className={fieldClass('dateOfBirth')} type="date" value={draft.dateOfBirth} onChange={(e) => updateField('dateOfBirth', e.target.value)} />
                      <select data-draft-field="gender" className={fieldClass('gender', selectClass)} value={draft.gender} onChange={(e) => updateField('gender', e.target.value as Draft['gender'])}>
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                        <option value="other">Other</option>
                      </select>
                      <Input data-draft-field="phone" className={fieldClass('phone')} placeholder="Phone number *" value={draft.phone} onChange={(e) => updateField('phone', e.target.value)} />
                    </div>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-700 mb-3 mt-2">
                      Contact & Address
                    </h3>
                    <div className={grid3Class}>
                      <Input data-draft-field="email" className={fieldClass('email')} type="email" placeholder="Email" value={draft.email} onChange={(e) => updateField('email', e.target.value)} />
                      <Input data-draft-field="state" className={fieldClass('state')} placeholder="State *" value={draft.state} onChange={(e) => updateField('state', e.target.value)} />
                      <Input data-draft-field="country" className={fieldClass('country')} placeholder="Country *" value={draft.country} onChange={(e) => updateField('country', e.target.value)} />
                    </div>
                    <div className={grid3Class}>
                      <Input data-draft-field="maritalStatus" className={fieldClass('maritalStatus')} placeholder="Marital status" value={draft.maritalStatus} onChange={(e) => updateField('maritalStatus', e.target.value)} />
                      <Input data-draft-field="occupation" className={fieldClass('occupation')} placeholder="Occupation" value={draft.occupation} onChange={(e) => updateField('occupation', e.target.value)} />
                      <Input data-draft-field="nationalId" className={fieldClass('nationalId')} placeholder="National ID (optional)" value={draft.nationalId} onChange={(e) => updateField('nationalId', e.target.value)} />
                    </div>
                    <div className="mb-4">
                      <Input data-draft-field="address" placeholder="Address *" value={draft.address} onChange={(e) => updateField('address', e.target.value)} className={fieldClass('address')} />
                    </div>
                    <div className="mb-4">
                      <Input data-draft-field="profilePhoto" placeholder="Profile photo URL" value={draft.profilePhoto} onChange={(e) => updateField('profilePhoto', e.target.value)} className={fieldClass('profilePhoto')} />
                    </div>
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-5">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900 mb-3">Clinical Profile</h3>
                    <div className={`${grid3Class} mt-3`}>
                      <Input data-draft-field="bloodGroup" className={fieldClass('bloodGroup')} placeholder="Blood group" value={draft.bloodGroup} onChange={(e) => updateField('bloodGroup', e.target.value)} />
                      <Input data-draft-field="genotype" className={fieldClass('genotype')} placeholder="Genotype" value={draft.genotype} onChange={(e) => updateField('genotype', e.target.value)} />
                      <Input data-draft-field="disabilityStatus" className={fieldClass('disabilityStatus')} placeholder="Disability status" value={draft.disabilityStatus} onChange={(e) => updateField('disabilityStatus', e.target.value)} />
                    </div>
                    <div className={grid3Class}>
                      <Input data-draft-field="allergies" placeholder="Allergies" value={draft.allergies} onChange={(e) => updateField('allergies', e.target.value)} className={fieldClass('allergies', 'lg:col-span-3 w-full min-w-0')} />
                    </div>
                    <div className={grid3Class}>
                      <Input data-draft-field="chronicConditions" placeholder="Chronic conditions" value={draft.chronicConditions} onChange={(e) => updateField('chronicConditions', e.target.value)} className={fieldClass('chronicConditions', 'lg:col-span-3 w-full min-w-0')} />
                    </div>
                    <div className={grid3Class}>
                      <Input data-draft-field="currentMedications" placeholder="Current medications" value={draft.currentMedications} onChange={(e) => updateField('currentMedications', e.target.value)} className={fieldClass('currentMedications', 'lg:col-span-3 w-full min-w-0')} />
                    </div>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">History</h3>
                    <div className={`${grid3Class} mt-3`}>
                      <Input data-draft-field="familyMedicalHistory" placeholder="Family medical history" value={draft.familyMedicalHistory} onChange={(e) => updateField('familyMedicalHistory', e.target.value)} className={fieldClass('familyMedicalHistory', 'lg:col-span-3 w-full min-w-0')} />
                      <Input data-draft-field="pastSurgeries" placeholder="Past surgeries" value={draft.pastSurgeries} onChange={(e) => updateField('pastSurgeries', e.target.value)} className={fieldClass('pastSurgeries', 'lg:col-span-3 w-full min-w-0')} />
                      <Input data-draft-field="pregnancyStatus" placeholder="Pregnancy status (if applicable)" value={draft.pregnancyStatus} onChange={(e) => updateField('pregnancyStatus', e.target.value)} className={fieldClass('pregnancyStatus', 'lg:col-span-3 w-full min-w-0')} />
                    </div>
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-5">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">Emergency Contact</h3>
                    <div className={`${grid3Class} mt-3`}>
                      <Input data-draft-field="emergencyContactName" className={fieldClass('emergencyContactName')} placeholder="Emergency contact name *" value={draft.emergencyContactName} onChange={(e) => updateField('emergencyContactName', e.target.value)} />
                      <Input data-draft-field="emergencyRelationship" className={fieldClass('emergencyRelationship')} placeholder="Relationship *" value={draft.emergencyRelationship} onChange={(e) => updateField('emergencyRelationship', e.target.value)} />
                      <Input data-draft-field="emergencyPhone" className={fieldClass('emergencyPhone')} placeholder="Emergency phone *" value={draft.emergencyPhone} onChange={(e) => updateField('emergencyPhone', e.target.value)} />
                    </div>
                    <div className={grid2Class}>
                      <Input data-draft-field="emergencyAddress" placeholder="Emergency address" value={draft.emergencyAddress} onChange={(e) => updateField('emergencyAddress', e.target.value)} className={fieldClass('emergencyAddress', 'lg:col-span-2 w-full min-w-0')} />
                    </div>
                  </div>
                </div>
              )}

              {step === 4 && (
                <div className="space-y-5">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">Insurance Information</h3>
                    <div className={`${grid3Class} mt-3`}>
                      <Input data-draft-field="insuranceProvider" className={fieldClass('insuranceProvider')} placeholder="Insurance provider" value={draft.insuranceProvider} onChange={(e) => updateField('insuranceProvider', e.target.value)} />
                      <Input data-draft-field="insurancePolicyNumber" className={fieldClass('insurancePolicyNumber')} placeholder="Policy number" value={draft.insurancePolicyNumber} onChange={(e) => updateField('insurancePolicyNumber', e.target.value)} />
                      <Input data-draft-field="insuranceType" className={fieldClass('insuranceType')} placeholder="Insurance type" value={draft.insuranceType} onChange={(e) => updateField('insuranceType', e.target.value)} />
                    </div>
                    <div className={grid3Class}>
                      <Input data-draft-field="insuranceExpiryDate" className={fieldClass('insuranceExpiryDate')} type="date" placeholder="Expiry date" value={draft.insuranceExpiryDate} onChange={(e) => updateField('insuranceExpiryDate', e.target.value)} />
                    </div>
                  </div>
                </div>
              )}

              {step === 5 && (
                <div className="space-y-5">
                  <div className="rounded-2xl border border-gray-200 p-4 bg-gradient-to-br from-white to-gray-50">
                    <p className="font-semibold text-gray-900 flex items-center gap-2"><Nfc className="w-4 h-4 text-royal-600" />NFC Assignment</p>
                    <div className={`${grid2Class} mt-3`}>
                      <Input data-draft-field="nfcCardId" className={fieldClass('nfcCardId')} placeholder="NFC card ID (optional)" value={draft.nfcCardId} onChange={(e) => updateField('nfcCardId', e.target.value)} />
                      <select
                        data-draft-field="nfcActive"
                        className={fieldClass('nfcActive', selectClass)}
                        value={String(draft.nfcActive)}
                        onChange={(e) => updateField('nfcActive', e.target.value === 'true')}
                      >
                        <option value="false">NFC inactive</option>
                        <option value="true">Activate NFC link</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">Care Settings</h3>
                    <div className={`${grid3Class} mt-3`}>
                      <select
                        data-draft-field="status"
                        className={fieldClass('status', selectClass)}
                        value={draft.status}
                        onChange={(e) => updateField('status', e.target.value as PatientStatus)}
                      >
                        <option value="active">Active</option>
                        <option value="inpatient">Inpatient</option>
                        <option value="outpatient">Outpatient</option>
                        <option value="discharged">Discharged</option>
                        <option value="referred">Referred</option>
                      </select>
                      <Input data-draft-field="doctorAssigned" className={fieldClass('doctorAssigned')} placeholder="Doctor assigned" value={draft.doctorAssigned} onChange={(e) => updateField('doctorAssigned', e.target.value)} />
                      <Input data-draft-field="department" className={fieldClass('department')} placeholder="Department" value={draft.department} onChange={(e) => updateField('department', e.target.value)} />
                    </div>
                    <div className={grid3Class}>
                      <Input data-draft-field="admissionStatus" className={fieldClass('admissionStatus')} placeholder="Admission status" value={draft.admissionStatus} onChange={(e) => updateField('admissionStatus', e.target.value)} />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(['vip', 'high-risk', 'chronic-care', 'pediatric', 'geriatric'] as PatientTag[]).map((tag) => (
                      <button
                        key={tag}
                        className={cn(
                          'px-3 py-1 rounded-full text-xs border transition-colors',
                          draft.tags.includes(tag) ? 'bg-royal-600 text-white border-royal-600' : 'bg-white text-gray-600 border-gray-200',
                        )}
                        onClick={() =>
                          updateField(
                            'tags',
                            draft.tags.includes(tag) ? draft.tags.filter((item) => item !== tag) : [...draft.tags, tag],
                          )
                        }
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 mb-2">Registration Notes</h3>
                      <Textarea
                        data-draft-field="notes"
                        className={fieldClass('notes', 'min-h-28 resize-none')}
                        placeholder="Clinical, administrative, or intake notes"
                        value={draft.notes ?? ''}
                        onChange={(e) => updateField('notes', e.target.value)}
                      />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 mb-2">Uploaded Documents</h3>
                      <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-gray-50/80 px-4 py-5 text-center transition-colors hover:border-royal-300 hover:bg-royal-50/40">
                        <UploadCloud className="h-6 w-6 text-royal-600" />
                        <span className="mt-2 text-sm font-medium text-gray-800">Attach medical files</span>
                        <span className="text-xs text-gray-500">Photos and documents are linked to this draft</span>
                        <input className="hidden" type="file" multiple onChange={(e) => void handleFilesSelected(e.target.files)} />
                      </label>
                      {(draft.uploadedFiles ?? []).length > 0 && (
                        <div className="mt-3 space-y-2">
                          {(draft.uploadedFiles ?? []).map((file) => (
                            <div key={file.id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 bg-white px-3 py-2 text-xs">
                              <span className="flex min-w-0 items-center gap-2 text-gray-700">
                                <FileText className="h-3.5 w-3.5 shrink-0" />
                                <span className="truncate">{file.name}</span>
                              </span>
                              <button className="shrink-0 text-red-600 hover:text-red-700" onClick={() => removeDraftFile(file.id)}>
                                Remove
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-700 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" />
                    {BRAND.patientIdLabel} will be generated as <span className="font-semibold">{BRAND.idPrefix}-YYYY-XXXXXX</span> at save time.
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Sticky footer with 4 buttons */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '20px 32px', borderTop: '1px solid #F3F4F6', flexShrink: 0 }} className="bg-white">
            <Button className="w-full sm:w-auto" variant="outline" onClick={requestClose}>
              Cancel
            </Button>
            
            <div className="flex items-center gap-3">
              <Button
                className="w-full sm:w-auto"
                variant="outline"
                disabled={step === 1}
                onClick={() => setStep((prev) => prev - 1)}
              >
                Previous
              </Button>
              
              <Button
                className="w-full sm:w-auto"
                variant="outline"
                onClick={forceSaveDraft}
                disabled={draftController.saveStatus === 'saving'}
              >
                {draftController.saveStatus === 'saving' && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Save Draft
              </Button>
              
              {step < 5 ? (
                <Button
                  className="w-full sm:w-auto bg-royal-700 hover:bg-royal-800 text-white"
                  onClick={() => setStep((prev) => prev + 1)}
                  disabled={!canProceed}
                >
                  Next Step
                </Button>
              ) : (
                <Button
                  className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={submit}
                  disabled={submitting || stepProgress < 100}
                >
                  {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Complete Onboarding
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(draftController.pendingRecoveryDraft)} onOpenChange={(nextOpen) => !nextOpen && draftController.startNewDraft()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Resume previous registration?</AlertDialogTitle>
            <AlertDialogDescription>
              A saved patient registration draft exists for this hospital and user. You can continue from step {draftController.pendingRecoveryDraft?.currentStep ?? 1}, discard it, or start a new registration.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={startNewRegistration}>Start New</AlertDialogCancel>
            <Button variant="outline" className="border-red-200 text-red-700 hover:bg-red-50" onClick={() => setShowDiscardDialog(true)}>
              Discard Draft
            </Button>
            <AlertDialogAction onClick={continueRecoveredDraft}>Continue Draft</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showExitDialog} onOpenChange={setShowExitDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>You have unsaved changes.</AlertDialogTitle>
            <AlertDialogDescription>
              Your progress has been automatically saved. Do you want to continue?
              {draftController.saveStatus === 'failed'
                ? ' The latest auto-save failed, so some changes may be lost if you exit now.'
                : ' You can resume this registration later from the saved draft.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continue Editing</AlertDialogCancel>
            <Button variant="outline" onClick={() => { setShowExitDialog(false); onOpenChange(false); }}>
              Exit Wizard
            </Button>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => void discardDraftAndClose()}>
              Discard Draft
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showDiscardDialog} onOpenChange={setShowDiscardDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this draft?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the local draft, queued synchronization item, and server draft record for this registration session.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continue Editing</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => void discardDraftAndClose()}>
              Discard Draft
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
