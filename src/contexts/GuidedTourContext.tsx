import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { useSubscription } from '@/contexts/SubscriptionContext';
import type { PageType } from '@/types';
import type { UserRole } from '@/contexts/AuthContext';
import { isFeatureEnabled } from '@/config/featureFlags';

type TourType = 'intro' | 'workflow' | 'feature' | 'micro';
type TourLayer = 'intro' | 'workflow' | 'advanced';
type SkillLevel = 'Beginner' | 'Intermediate' | 'Advanced';

export interface TourStep {
  id: string;
  page: PageType;
  title: string;
  description: string;
  selector?: string;
  requiredActionHint?: string;
  requiresAction?: boolean;
  requiredEvent?: string;
  optional?: boolean;
}

interface TourDefinition {
  id: string;
  type: TourType;
  layer: TourLayer;
  title: string;
  goal: string;
  role?: UserRole;
  steps: TourStep[];
  minPlan?: 'free' | 'pro' | 'enterprise';
}

interface TourProgress {
  completedTours: string[];
  skippedTours: string[];
  partial: Record<string, number>;
  modulesCompleted: string[];
  roleCompletion: Record<UserRole, number>;
  skillLevel: SkillLevel;
  practiceCompletions: Record<string, number>;
  dismissedMicroGuides: string[];
}

interface GuidedTourContextType {
  toursEnabled: boolean;
  setToursEnabled: (enabled: boolean) => void;
  startRoleOnboarding: (role?: UserRole) => void;
  startIntroTour: () => void;
  startWorkflowTraining: (role?: UserRole) => void;
  startAdvancedTour: (tourId: string) => void;
  startTourById: (tourId: string, step?: number) => void;
  triggerMicroTour: (tourId: string) => void;
  replayCurrentRoleTour: () => void;
  resetOnboarding: () => void;
  progress: TourProgress;
  activeTourMeta: { id: string; title: string; layer: TourLayer } | null;
}

const GuidedTourContext = createContext<GuidedTourContextType | null>(null);

const introTour: TourDefinition = {
  id: 'intro-universal',
  type: 'intro',
  layer: 'intro',
  title: 'Universal Intro Tour',
  goal: 'Orient users across core navigation in under 60 seconds.',
  steps: [
    { id: 'intro-1', page: 'dashboard', title: 'Dashboard overview', description: 'Start from live KPIs and your role-specific workload.', selector: '[data-tour-id="sidebar-dashboard"]' },
    { id: 'intro-2', page: 'dashboard', title: 'Navigation sidebar', description: 'Use this sidebar to move across all major modules.', selector: '[data-tour-id="sidebar-dashboard"]' },
    { id: 'intro-3', page: 'dashboard', title: 'Search and global actions', description: 'Use global search to quickly jump to records and actions.', selector: '[data-tour-id="global-search"]' },
    { id: 'intro-4', page: 'dashboard', title: 'Notifications and profile', description: 'Track updates and account actions from the top-right controls.' },
    { id: 'intro-5', page: 'dashboard', title: 'VitaMind AI assistant', description: 'Open VitaMind AI anytime for in-flow support and suggestions.' },
    { id: 'intro-6', page: 'help', title: 'Help and support', description: 'Access training, diagnostics, and support from Help Center.', selector: '[data-tour-id="help-dashboard"]' },
  ],
};

const workflowTours: Record<UserRole, TourDefinition> = {
  doctor: {
    id: 'workflow-doctor',
    type: 'workflow',
    layer: 'workflow',
    role: 'doctor',
    title: 'Doctor Workflow Training',
    goal: 'Manage a patient from consultation to diagnosis.',
    steps: [
      { id: 'doc-1', page: 'appointments', title: 'View schedule', description: 'Open Appointments and review today consultation queue.', selector: '[data-tour-id="sidebar-appointments"]', requiresAction: true, requiredActionHint: "Click 'Appointments' to continue.", requiredEvent: 'appointments:viewed' },
      { id: 'doc-2', page: 'emr', title: 'Open patient EMR', description: 'Load a patient file in sandbox mode to avoid real data changes.', selector: '[data-tour-id="sidebar-emr"]' },
      { id: 'doc-3', page: 'emr', title: 'Add clinical notes', description: 'Capture consultation findings; required fields are highlighted.', requiresAction: true, requiredActionHint: 'Practice note entry using simulated data.' },
      { id: 'doc-4', page: 'laboratory', title: 'Order lab test', description: 'Submit a mock lab request for the consultation.', selector: '[data-tour-id="sidebar-laboratory"]', requiresAction: true, requiredEvent: 'laboratory:order-created' },
      { id: 'doc-5', page: 'laboratory', title: 'Review lab results', description: 'Interpret test outcomes and mark critical ranges.' },
      { id: 'doc-6', page: 'pharmacy', title: 'Prescribe medication', description: 'Create a safe prescription draft tied to this scenario.', selector: '[data-tour-id="sidebar-pharmacy"]' },
      { id: 'doc-7', page: 'telemedicine', title: 'Start telemedicine (optional)', description: 'Optional: launch a virtual follow-up session.', selector: '[data-tour-id="sidebar-telemedicine"]', optional: true },
      { id: 'doc-8', page: 'emr', title: 'Save and close consultation', description: 'Complete the workflow and close consultation safely.' },
    ],
  },
  receptionist: {
    id: 'workflow-receptionist',
    type: 'workflow',
    layer: 'workflow',
    role: 'receptionist',
    title: 'Receptionist Workflow Training',
    goal: 'Register and schedule a patient.',
    steps: [
      { id: 'rec-1', page: 'patients', title: 'Add new patient', description: 'Create a new patient profile in sandbox mode.', selector: '[data-tour-id="patients-add"]', requiresAction: true, requiredEvent: 'patients:created' },
      { id: 'rec-2', page: 'patients', title: 'Generate VitaLink ID', description: 'Assign a unique digital identity for intake completion.', requiresAction: true, requiredEvent: 'patients:vitalink-id-generated' },
      { id: 'rec-3', page: 'appointments', title: 'Book appointment', description: 'Schedule a consultation slot for the patient.', selector: '[data-tour-id="appointments-new"]', requiresAction: true, requiredEvent: 'appointments:created' },
      { id: 'rec-4', page: 'appointments', title: 'Assign doctor', description: 'Attach an available doctor based on specialty and time.', requiresAction: true, requiredEvent: 'appointments:doctor-assigned' },
      { id: 'rec-5', page: 'appointments', title: 'Send confirmation', description: 'Send appointment confirmation to patient contact.', requiresAction: true, requiredEvent: 'appointments:confirmation-sent' },
    ],
  },
  pharmacist: {
    id: 'workflow-pharmacist',
    type: 'workflow',
    layer: 'workflow',
    role: 'pharmacist',
    title: 'Pharmacist Workflow Training',
    goal: 'Dispense medication safely.',
    steps: [
      { id: 'pharm-1', page: 'pharmacy', title: 'View prescription', description: 'Open a prescribed medication request.', selector: '[data-tour-id="sidebar-pharmacy"]' },
      { id: 'pharm-2', page: 'pharmacy', title: 'Check stock', description: 'Validate stock and expiry before dispensing.', requiresAction: true, requiredEvent: 'pharmacy:stock-checked' },
      { id: 'pharm-3', page: 'pharmacy', title: 'Dispense medication', description: 'Dispense using the safe checklist flow.', requiresAction: true, requiredEvent: 'pharmacy:dispensed' },
      { id: 'pharm-4', page: 'pharmacy', title: 'Update inventory', description: 'Apply stock deduction in sandbox mode.', requiresAction: true, requiredEvent: 'pharmacy:inventory-updated' },
      { id: 'pharm-5', page: 'pharmacy', title: 'Handle low-stock alert', description: 'Acknowledge and route low-stock notification.', requiresAction: true, requiredEvent: 'pharmacy:low-stock-handled' },
    ],
  },
  'lab-scientist': {
    id: 'workflow-lab-scientist',
    type: 'workflow',
    layer: 'workflow',
    role: 'lab-scientist',
    title: 'Lab Scientist Workflow Training',
    goal: 'Process and upload lab results.',
    steps: [
      { id: 'lab-1', page: 'laboratory', title: 'Receive lab order', description: 'Open incoming order queue.', selector: '[data-tour-id="sidebar-laboratory"]' },
      { id: 'lab-2', page: 'laboratory', title: 'Mark as processing', description: 'Move test order to processing state.', requiresAction: true, requiredEvent: 'laboratory:processing' },
      { id: 'lab-3', page: 'laboratory', title: 'Input test results', description: 'Fill measured values and validation details.', requiresAction: true, requiredEvent: 'laboratory:results-submitted' },
      { id: 'lab-4', page: 'laboratory', title: 'Upload report', description: 'Upload finalized report attachment.', selector: '[data-tour-id="lab-bulk-upload"]', requiresAction: true, requiredEvent: 'laboratory:report-uploaded' },
      { id: 'lab-5', page: 'laboratory', title: 'Notify doctor', description: 'Send result-ready notification to clinician.', requiresAction: true, requiredEvent: 'laboratory:doctor-notified' },
    ],
  },
  nurse: {
    id: 'workflow-nurse',
    type: 'workflow',
    layer: 'workflow',
    role: 'nurse',
    title: 'Nurse Workflow Training',
    goal: 'Assist in patient care.',
    steps: [
      { id: 'nurse-1', page: 'patients', title: 'Access patient record', description: 'Open assigned patient context.', selector: '[data-tour-id="sidebar-patients"]' },
      { id: 'nurse-2', page: 'emr', title: 'Record vital signs', description: 'Capture vitals in guided form with required prompts.', selector: '[data-tour-id="sidebar-emr"]', requiresAction: true },
      { id: 'nurse-3', page: 'emr', title: 'Update patient notes', description: 'Enter nursing observations and interventions.' },
      { id: 'nurse-4', page: 'pharmacy', title: 'Assist medication tracking', description: 'Confirm administered medications with timestamps.' },
    ],
  },
  'hospital-admin': {
    id: 'workflow-hospital-admin',
    type: 'workflow',
    layer: 'workflow',
    role: 'hospital-admin',
    title: 'Admin Workflow Training',
    goal: 'Set up and manage the hospital.',
    steps: [
      { id: 'had-1', page: 'administration', title: 'Create departments', description: 'Create operational departments and services.', selector: '[data-tour-id="sidebar-administration"]' },
      { id: 'had-2', page: 'human-resources', title: 'Add staff', description: 'Onboard staff records and employment details.', selector: '[data-tour-id="sidebar-human-resources"]', requiresAction: true },
      { id: 'had-3', page: 'human-resources', title: 'Assign roles', description: 'Assign role-based permissions by function.' },
      { id: 'had-4', page: 'subscription', title: 'Configure subscription', description: 'Set package and feature availability.', selector: '[data-tour-id="sidebar-subscription"]' },
      { id: 'had-5', page: 'analytics', title: 'View analytics', description: 'Track utilization and outcomes.', selector: '[data-tour-id="sidebar-analytics"]' },
      { id: 'had-6', page: 'settings', title: 'Set permissions', description: 'Review security and permission policy.' },
    ],
  },
  'super-admin': {
    id: 'workflow-super-admin',
    type: 'workflow',
    layer: 'workflow',
    role: 'super-admin',
    title: 'Super Admin Workflow Training',
    goal: 'Set up and manage the hospital network.',
    steps: [
      { id: 'sad-1', page: 'administration', title: 'Create departments', description: 'Define departments across facilities.' },
      { id: 'sad-2', page: 'human-resources', title: 'Add staff', description: 'Create and assign core team members.' },
      { id: 'sad-3', page: 'human-resources', title: 'Assign roles', description: 'Map teams to role-based access controls.' },
      { id: 'sad-4', page: 'subscription', title: 'Configure subscription', description: 'Align package by facility requirements.' },
      { id: 'sad-5', page: 'analytics', title: 'View analytics', description: 'Review operational and financial trends.' },
      { id: 'sad-6', page: 'settings', title: 'Set permissions', description: 'Lock policy and security controls.' },
    ],
  },
  'lab-technician': {
    id: 'workflow-lab-technician',
    type: 'workflow',
    layer: 'workflow',
    role: 'lab-technician',
    title: 'Lab Technician Workflow Training',
    goal: 'Process and update lab workflow.',
    steps: [
      { id: 'lt-1', page: 'laboratory', title: 'Receive orders', description: 'Review incoming sample orders.' },
      { id: 'lt-2', page: 'laboratory', title: 'Mark as processing', description: 'Update test pipeline statuses.' },
      { id: 'lt-3', page: 'laboratory', title: 'Upload report', description: 'Attach test outcome documents when ready.' },
    ],
  },
  'billing-officer': {
    id: 'workflow-billing',
    type: 'workflow',
    layer: 'workflow',
    role: 'billing-officer',
    title: 'Billing Workflow Training',
    goal: 'Create first invoice and complete claim flow.',
    steps: [
      { id: 'bo-1', page: 'billing', title: 'Create invoice', description: 'Generate patient invoice from services.', selector: '[data-tour-id="billing-new-invoice"]' },
      { id: 'bo-2', page: 'billing', title: 'Submit insurance claim', description: 'Create linked claim request for insured patient.' },
      { id: 'bo-3', page: 'analytics', title: 'Track collections', description: 'Review outstanding and paid trends.' },
    ],
  },
  'insurance-officer': {
    id: 'workflow-insurance',
    type: 'workflow',
    layer: 'workflow',
    role: 'insurance-officer',
    title: 'Insurance Workflow Training',
    goal: 'Review and process claim approvals.',
    steps: [
      { id: 'io-1', page: 'billing', title: 'Review claims queue', description: 'Open pending claims by priority.' },
      { id: 'io-2', page: 'billing', title: 'Approve/reject with notes', description: 'Add decision and reasons.' },
      { id: 'io-3', page: 'analytics', title: 'Monitor outcomes', description: 'Review acceptance and turnaround metrics.' },
    ],
  },
  'it-officer': {
    id: 'workflow-it',
    type: 'workflow',
    layer: 'workflow',
    role: 'it-officer',
    title: 'IT Workflow Training',
    goal: 'Maintain system security and reliability.',
    steps: [
      { id: 'it-1', page: 'audit-logs', title: 'Review audit events', description: 'Scan suspicious entries and incidents.' },
      { id: 'it-2', page: 'settings', title: 'Adjust system controls', description: 'Tune core settings and access policies.' },
      { id: 'it-3', page: 'help', title: 'Run diagnostics', description: 'Use Help diagnostics for support issues.' },
    ],
  },
  'support-agent': {
    id: 'workflow-support',
    type: 'workflow',
    layer: 'workflow',
    role: 'support-agent',
    title: 'Support Agent Workflow Training',
    goal: 'Handle support lifecycle from intake to resolution.',
    steps: [
      { id: 'sa-1', page: 'help', title: 'Review ticket queue', description: 'Sort tickets by SLA and severity.' },
      { id: 'sa-2', page: 'help', title: 'Update status', description: 'Progress ticket through lifecycle states.' },
      { id: 'sa-3', page: 'help', title: 'Run diagnostics', description: 'Gather troubleshooting context and close loop.' },
    ],
  },
  'public-health-officer': {
    id: 'workflow-public-health-officer',
    type: 'workflow',
    layer: 'workflow',
    role: 'public-health-officer',
    title: 'Public Health Surveillance',
    goal: 'Monitor regional signals and line lists.',
    steps: [
      { id: 'pho-1', page: 'switch-sentinel', title: 'Open VitaLink Sentinel', description: 'Enter the national surveillance fabric.', selector: '[data-tour-id="sidebar-switch-sentinel"]' },
      { id: 'pho-2', page: 'switch-sentinel', title: 'Review surveillance dashboard', description: 'Scan active cases, trends, and export paths.' },
      { id: 'pho-3', page: 'switch-sentinel', title: 'Triage alerts', description: 'Acknowledge public health alerts and route response.' },
    ],
  },
  epidemiologist: {
    id: 'workflow-epidemiologist',
    type: 'workflow',
    layer: 'workflow',
    role: 'epidemiologist',
    title: 'Epidemiology Command',
    goal: 'Run outbreak analytics and threshold policy.',
    steps: [
      { id: 'epi-1', page: 'switch-sentinel', title: 'Sentinel overview', description: 'Confirm tenant scope and hierarchy filters.', selector: '[data-tour-id="sidebar-switch-sentinel"]' },
      { id: 'epi-2', page: 'switch-sentinel', title: 'Outbreak engine', description: 'Validate signals and recommended interventions.' },
      { id: 'epi-3', page: 'switch-sentinel', title: 'Epidemiology AI', description: 'Use VitaMind briefing for situational awareness.' },
    ],
  },
  'government-authority': {
    id: 'workflow-government-authority',
    type: 'workflow',
    layer: 'workflow',
    role: 'government-authority',
    title: 'National visibility',
    goal: 'Review aggregate indicators without direct identifiers.',
    steps: [
      { id: 'gov-1', page: 'switch-sentinel', title: 'National dashboard', description: 'Review jurisdiction-scoped aggregates.', selector: '[data-tour-id="sidebar-switch-sentinel"]' },
      { id: 'gov-2', page: 'switch-sentinel', title: 'Export reporting', description: 'Generate government-ready surveillance exports.' },
    ],
  },
  'community-health-worker': {
    id: 'workflow-chw',
    type: 'workflow',
    layer: 'workflow',
    role: 'community-health-worker',
    title: 'Community signals',
    goal: 'Submit offline-capable community reports.',
    steps: [
      { id: 'chw-1', page: 'switch-sentinel', title: 'Community reporting', description: 'Capture symptom clusters and shortages.', selector: '[data-tour-id="sidebar-switch-sentinel"]' },
      { id: 'chw-2', page: 'switch-sentinel', title: 'Sync status', description: 'Confirm online/offline sync when connectivity returns.' },
    ],
  },
  'who-ngo-observer': {
    id: 'workflow-who-ngo',
    type: 'workflow',
    layer: 'workflow',
    role: 'who-ngo-observer',
    title: 'Observer access',
    goal: 'Read-only monitoring for partner visibility.',
    steps: [
      { id: 'who-1', page: 'switch-sentinel', title: 'Observer dashboards', description: 'Review permitted aggregate analytics.', selector: '[data-tour-id="sidebar-switch-sentinel"]' },
    ],
  },
};

const microTours: Record<string, TourDefinition> = {
  'micro-new-patient': {
    id: 'micro-new-patient',
    type: 'micro',
    layer: 'workflow',
    title: 'First New Patient',
    goal: 'Complete first patient registration.',
    steps: [
      { id: 'mnp-1', page: 'patients', title: 'New Patient Form', description: 'Fill demographic and contact details carefully.', selector: '[data-tour-id="patients-add"]' },
      { id: 'mnp-2', page: 'patients', title: 'Identity Setup', description: 'Assign a unique VitaLink ID and verify fields.' },
    ],
  },
  'micro-billing-first': {
    id: 'micro-billing-first',
    type: 'micro',
    layer: 'workflow',
    title: 'First Invoice',
    goal: 'Guide first invoice creation and send.',
    steps: [
      { id: 'mb1', page: 'billing', title: 'Invoice Flow', description: 'Create invoice, add services, then send to patient.', selector: '[data-tour-id="billing-new-invoice"]' },
      { id: 'mb2', page: 'billing', title: 'Insurance & Payments', description: 'Track claims and reconcile payments.' },
    ],
  },
  'micro-lab-upload': {
    id: 'micro-lab-upload',
    type: 'micro',
    layer: 'workflow',
    title: 'First Lab Upload',
    goal: 'Publish first lab report correctly.',
    steps: [
      { id: 'mlu1', page: 'laboratory', title: 'Upload Results', description: 'Attach result file and validate metadata.', selector: '[data-tour-id="lab-bulk-upload"]' },
      { id: 'mlu2', page: 'laboratory', title: 'Publish Results', description: 'Review critical flags before publishing.' },
    ],
  },
  'micro-first-prescription': {
    id: 'micro-first-prescription',
    type: 'micro',
    layer: 'workflow',
    title: 'First Prescription',
    goal: 'Create first safe prescription.',
    steps: [
      { id: 'mp1', page: 'emr', title: 'Prepare prescription', description: 'Review diagnosis and dosage guardrails.' },
      { id: 'mp2', page: 'pharmacy', title: 'Confirm dispense readiness', description: 'Validate stock and contraindications.' },
    ],
  },
  'micro-first-referral': {
    id: 'micro-first-referral',
    type: 'micro',
    layer: 'workflow',
    title: 'First Referral',
    goal: 'Create first patient referral.',
    steps: [
      { id: 'mr1', page: 'switch-network', title: 'Select referral target', description: 'Choose referral facility in network.' },
      { id: 'mr2', page: 'switch-network', title: 'Send referral packet', description: 'Attach summary and send securely.' },
    ],
  },
};

const featureTours: Record<string, TourDefinition> = {
  'feature-ai-diagnosis': {
    id: 'feature-ai-diagnosis',
    type: 'feature',
    layer: 'advanced',
    title: 'AI Diagnosis with VitaMind',
    goal: 'Understand AI value and run first assisted diagnosis.',
    minPlan: 'pro',
    steps: [
      { id: 'fai1', page: 'ai-clinical-intelligence', title: 'Why it matters', description: 'VitaMind highlights risk trends and care opportunities.' },
      { id: 'fai2', page: 'ai-clinical-intelligence', title: 'How to use', description: 'Open patient context and run AI-assisted reasoning.' },
      { id: 'fai3', page: 'ai-clinical-intelligence', title: 'Try it now', description: 'Run one safe case simulation with AI guidance.' },
    ],
  },
  'feature-telemedicine': {
    id: 'feature-telemedicine',
    type: 'feature',
    layer: 'advanced',
    title: 'Telemedicine',
    goal: 'Launch and manage virtual visits.',
    minPlan: 'pro',
    steps: [
      { id: 'ft1', page: 'telemedicine', title: 'Value', description: 'Extend care reach with virtual consultations.' },
      { id: 'ft2', page: 'telemedicine', title: 'How to use', description: 'Create session and invite patient.' },
      { id: 'ft3', page: 'telemedicine', title: 'Try it now', description: 'Start a mock telemedicine session.' },
    ],
  },
  'feature-billing-insurance': {
    id: 'feature-billing-insurance',
    type: 'feature',
    layer: 'advanced',
    title: 'Billing and Insurance',
    goal: 'Improve revenue cycle with guided workflows.',
    minPlan: 'pro',
    steps: [
      { id: 'fb1', page: 'billing', title: 'Value', description: 'Reduce claim errors and speed collections.' },
      { id: 'fb2', page: 'billing', title: 'How to use', description: 'Create invoice, connect claim, track payment.' },
      { id: 'fb3', page: 'billing', title: 'Try it now', description: 'Create your first guided invoice.' },
    ],
  },
  'feature-analytics': {
    id: 'feature-analytics',
    type: 'feature',
    layer: 'advanced',
    title: 'Analytics Dashboard',
    goal: 'Use data-driven insights for operations.',
    minPlan: 'pro',
    steps: [
      { id: 'fan1', page: 'analytics', title: 'Value', description: 'Track utilization, outcomes, and financial trends.' },
      { id: 'fan2', page: 'analytics', title: 'How to use', description: 'Filter reports by role and date range.' },
      { id: 'fan3', page: 'analytics', title: 'Try it now', description: 'Open one actionable KPI report.' },
    ],
  },
  'feature-switch-network': {
    id: 'feature-switch-network',
    type: 'feature',
    layer: 'advanced',
    title: 'VitaLink Network Referrals',
    goal: 'Coordinate safe referrals between facilities.',
    minPlan: 'enterprise',
    steps: [
      { id: 'fsn1', page: 'switch-network', title: 'Value', description: 'Improve continuity of care across hospitals.' },
      { id: 'fsn2', page: 'switch-network', title: 'How to use', description: 'Select receiving facility and attach patient package.' },
      { id: 'fsn3', page: 'switch-network', title: 'Try it now', description: 'Create a mock referral in sandbox mode.' },
    ],
  },
};

function progressKey(userName: string) {
  return `vitalink-tour-progress-${userName}`;
}

function enabledKey(userName: string) {
  return `vitalink-tour-enabled-${userName}`;
}

export function GuidedTourProvider({
  children,
  currentPage,
  currentRole,
  userName,
  onNavigate,
}: {
  children: ReactNode;
  currentPage: PageType;
  currentRole: UserRole;
  userName: string;
  onNavigate: (page: PageType) => void;
}) {
  const { addAudit, subscription } = useSubscription();
  const globalFlagEnabled = isFeatureEnabled('onboardingToursEnabled');
  
  // If tours are globally disabled, return a no-op provider
  if (!globalFlagEnabled) {
    const noopValue: GuidedTourContextType = {
      toursEnabled: false,
      setToursEnabled: () => {},
      startRoleOnboarding: () => {},
      startIntroTour: () => {},
      startWorkflowTraining: () => {},
      startAdvancedTour: () => {},
      startTourById: () => {},
      triggerMicroTour: () => {},
      replayCurrentRoleTour: () => {},
      resetOnboarding: () => {},
      progress: {
        completedTours: [],
        skippedTours: [],
        partial: {},
        modulesCompleted: [],
        roleCompletion: {} as Record<UserRole, number>,
        skillLevel: 'Beginner',
        practiceCompletions: {},
        dismissedMicroGuides: [],
      },
      activeTourMeta: null,
    };
    return (
      <GuidedTourContext.Provider value={noopValue}>
        {children}
      </GuidedTourContext.Provider>
    );
  }
  
  const [toursEnabled, setToursEnabledState] = useState<boolean>(() => {
    const localStorageValue = localStorage.getItem(enabledKey(userName));
    if (localStorageValue !== null) {
      return localStorageValue === '1';
    }
    return globalFlagEnabled;
  });
  const [progress, setProgress] = useState<TourProgress>(() => {
    const saved = localStorage.getItem(progressKey(userName));
    if (saved) return JSON.parse(saved) as TourProgress;
    return {
      completedTours: [],
      skippedTours: [],
      partial: {},
      modulesCompleted: [],
      roleCompletion: {} as Record<UserRole, number>,
      skillLevel: 'Beginner',
      practiceCompletions: {},
      dismissedMicroGuides: [],
    };
  });
  const [activeTour, setActiveTour] = useState<TourDefinition | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [showResumePrompt, setShowResumePrompt] = useState<{ tourId: string; step: number } | null>(null);
  const [practiceMode, setPracticeMode] = useState(false);
  const [stepEventValidation, setStepEventValidation] = useState<Record<string, boolean>>({});
  const [smartHelpMessage, setSmartHelpMessage] = useState('');
  const idleTimer = useRef<number | null>(null);
  const clicksInStep = useRef(0);

  const allTours = useMemo(
    () => ({ ...workflowTours, ...microTours, ...featureTours, [introTour.id]: introTour }),
    [],
  );
  const advancedTourIds = useMemo(() => Object.values(featureTours).map((entry) => entry.id), []);

  useEffect(() => {
    localStorage.setItem(progressKey(userName), JSON.stringify(progress));
  }, [progress, userName]);

  useEffect(() => {
    localStorage.setItem(enabledKey(userName), toursEnabled ? '1' : '0');
  }, [toursEnabled, userName]);

  useEffect(() => {
    const partialEntry = Object.entries(progress.partial)[0];
    if (toursEnabled && partialEntry && !activeTour) {
      setShowResumePrompt({ tourId: partialEntry[0], step: partialEntry[1] });
    }
  }, [progress.partial, toursEnabled, activeTour]);

  useEffect(() => {
    if (!toursEnabled || activeTour) return;
    if (!progress.completedTours.includes(introTour.id)) {
      startTourById(introTour.id, progress.partial[introTour.id] ?? 0);
      return;
    }
    const roleTour = workflowTours[currentRole];
    if (!roleTour) return;
    if (!progress.completedTours.includes(roleTour.id)) {
      startTourById(roleTour.id, progress.partial[roleTour.id] ?? 0);
    }
  }, [currentRole, toursEnabled, activeTour, progress.completedTours, progress.partial]);

  useEffect(() => {
    const onTrigger = (event: Event) => {
      const detail = (event as CustomEvent<{ tourId: string }>).detail;
      if (!detail?.tourId) return;
      triggerMicroTour(detail.tourId);
    };
    window.addEventListener('vitalink:tour-trigger', onTrigger as EventListener);
    return () => window.removeEventListener('vitalink:tour-trigger', onTrigger as EventListener);
  }, [progress, toursEnabled]);

  useEffect(() => {
    const onTrainingAction = (event: Event) => {
      const detail = (event as CustomEvent<{ action: string }>).detail;
      if (!activeTour || !detail?.action) return;
      const step = activeTour.steps[stepIndex];
      if (!step?.requiredEvent) return;
      if (detail.action !== step.requiredEvent) return;
      setStepEventValidation((prev) => ({ ...prev, [step.id]: true }));
    };
    window.addEventListener('vitalink:training-action', onTrainingAction as EventListener);
    return () => window.removeEventListener('vitalink:training-action', onTrainingAction as EventListener);
  }, [activeTour, stepIndex]);

  useEffect(() => {
    if (!toursEnabled || activeTour || progress.completedTours.length < 2) return;
    if (subscription.plan === 'free') return;
    const nextAdvanced = advancedTourIds.find((id) => !progress.completedTours.includes(id) && !progress.skippedTours.includes(id));
    if (nextAdvanced) startTourById(nextAdvanced, 0);
  }, [toursEnabled, activeTour, progress.completedTours, progress.skippedTours, advancedTourIds, subscription.plan]);

  useEffect(() => {
    if (!toursEnabled || activeTour || progress.dismissedMicroGuides.length > 8) return;
    if (currentPage === 'billing') triggerMicroTour('micro-billing-first');
    if (currentPage === 'laboratory') triggerMicroTour('micro-lab-upload');
    if (currentPage === 'patients') triggerMicroTour('micro-new-patient');
    if (currentPage === 'emr') triggerMicroTour('micro-first-prescription');
    if (currentPage === 'switch-network') triggerMicroTour('micro-first-referral');
  }, [currentPage, toursEnabled, activeTour, progress.dismissedMicroGuides]);

  useEffect(() => {
    if (!activeTour) return;
    const step = activeTour.steps[stepIndex];
    if (!step) return;
    if (step.page !== currentPage) {
      onNavigate(step.page);
      return;
    }
    if (!step.selector) {
      setTargetRect(null);
      return;
    }
    const target = document.querySelector(step.selector) as HTMLElement | null;
    if (!target) {
      setTargetRect(null);
      return;
    }
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const rect = target.getBoundingClientRect();
    setTargetRect(rect);
  }, [activeTour, stepIndex, currentPage, onNavigate]);

  useEffect(() => {
    if (!activeTour) return;
    clicksInStep.current = 0;
    setSmartHelpMessage('');
    if (idleTimer.current) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => {
      setSmartHelpMessage(`Need help with "${activeTour.steps[stepIndex]?.title}"? VitaMind can walk you through this step.`);
    }, 15000);
    const onClick = () => {
      clicksInStep.current += 1;
      if (clicksInStep.current >= 6) {
        setSmartHelpMessage(`Need help${currentPage === 'appointments' ? ' booking an appointment' : ''}? Try Practice Mode guidance.`);
      }
    };
    window.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('click', onClick);
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
    };
  }, [activeTour, stepIndex, currentPage]);

  const setToursEnabled = (enabled: boolean) => {
    setToursEnabledState(enabled);
    if (!enabled) {
      setActiveTour(null);
      setShowResumePrompt(null);
    }
  };

  const markPartial = (tourId: string, nextStep: number) => {
    setProgress((prev) => ({ ...prev, partial: { ...prev.partial, [tourId]: nextStep } }));
  };

  const clearPartial = (tourId: string) => {
    setProgress((prev) => {
      const partial = { ...prev.partial };
      delete partial[tourId];
      return { ...prev, partial };
    });
  };

  const startTourById = (tourId: string, step = 0) => {
    const tour = Object.values(allTours).find((entry) => entry.id === tourId);
    if (!tour || !toursEnabled) return;
    const planRank = { free: 0, pro: 1, enterprise: 2 };
    if (tour.minPlan && planRank[subscription.plan] < planRank[tour.minPlan]) return;
    setActiveTour(tour);
    setStepIndex(step);
    markPartial(tour.id, step);
    setPracticeMode(tour.type === 'workflow');
    setStepEventValidation({});
  };

  const startRoleOnboarding = (role?: UserRole) => {
    const selectedRole = role ?? currentRole;
    const tour = workflowTours[selectedRole];
    if (!tour) return;
    startTourById(tour.id);
  };

  const startIntroTour = () => {
    startTourById(introTour.id, 0);
  };

  const startWorkflowTraining = (role?: UserRole) => {
    startRoleOnboarding(role);
  };

  const startAdvancedTour = (tourId: string) => {
    startTourById(tourId, 0);
  };

  const triggerMicroTour = (tourId: string) => {
    const tour = microTours[tourId];
    if (!tour || !toursEnabled) return;
    if (progress.completedTours.includes(tour.id)) return;
    if (progress.skippedTours.includes(tour.id)) return;
    if (progress.dismissedMicroGuides.includes(tour.id)) return;
    startTourById(tour.id);
  };

  const replayCurrentRoleTour = () => {
    const tour = workflowTours[currentRole];
    if (!tour) return;
    startTourById(tour.id, 0);
  };

  const resetOnboarding = () => {
    setProgress({
      completedTours: [],
      skippedTours: [],
      partial: {},
      modulesCompleted: [],
      roleCompletion: {} as Record<UserRole, number>,
      skillLevel: 'Beginner',
      practiceCompletions: {},
      dismissedMicroGuides: [],
    });
    toastMessage('Onboarding progress reset');
  };

  const finishTour = (completed: boolean) => {
    if (!activeTour) return;
    const wasPreviouslyCompleted = progress.completedTours.includes(activeTour.id);
    if (completed) {
      const completedModules = Array.from(new Set(activeTour.steps.map((step) => step.page)));
      const roleWorkflow = workflowTours[currentRole];
      const roleCompletion =
        roleWorkflow && activeTour.id === roleWorkflow.id
          ? 100
          : progress.roleCompletion[currentRole] ?? 0;
      const modulesCompleted = Array.from(new Set([...progress.modulesCompleted, ...completedModules]));
      const skillScore = progress.completedTours.length + 1;
      setProgress((prev) => ({
        ...prev,
        completedTours: Array.from(new Set([...prev.completedTours, activeTour.id])),
        modulesCompleted,
        roleCompletion: {
          ...prev.roleCompletion,
          [currentRole]: roleCompletion,
        },
        skillLevel: skillScore > 8 ? 'Advanced' : skillScore > 3 ? 'Intermediate' : 'Beginner',
      }));
      addAudit(`Guided tour completed: ${activeTour.id}`);
    } else {
      setProgress((prev) => ({
        ...prev,
        skippedTours: Array.from(new Set([...prev.skippedTours, activeTour.id])),
        dismissedMicroGuides: activeTour.type === 'micro' ? Array.from(new Set([...prev.dismissedMicroGuides, activeTour.id])) : prev.dismissedMicroGuides,
      }));
      addAudit(`Guided tour skipped: ${activeTour.id}`);
    }
    clearPartial(activeTour.id);
    setActiveTour(null);
    setTargetRect(null);
    setPracticeMode(false);
    setStepEventValidation({});
    setSmartHelpMessage('');
    const shouldReturnToDashboard =
      activeTour.type === 'intro' && completed && !wasPreviouslyCompleted;
    if (shouldReturnToDashboard) {
      onNavigate('dashboard');
    }
  };

  const nextStep = () => {
    if (!activeTour) return;
    const isLast = stepIndex >= activeTour.steps.length - 1;
    if (isLast) {
      finishTour(true);
      return;
    }
    const step = activeTour.steps[stepIndex];
    const requiresEventValidation = Boolean(step?.requiredEvent);
    const isValidatedByEvent = step ? Boolean(stepEventValidation[step.id]) : false;
    if (practiceMode && step?.requiresAction && requiresEventValidation && !isValidatedByEvent) {
      setSmartHelpMessage(step.requiredActionHint ?? 'Complete the required action in the module to continue.');
      return;
    }
    const next = stepIndex + 1;
    setStepIndex(next);
    markPartial(activeTour.id, next);
  };

  const previousStep = () => {
    if (!activeTour) return;
    const prev = Math.max(0, stepIndex - 1);
    setStepIndex(prev);
    markPartial(activeTour.id, prev);
  };

  const value = useMemo<GuidedTourContextType>(
    () => ({
      toursEnabled,
      setToursEnabled,
      startRoleOnboarding,
      startIntroTour,
      startWorkflowTraining,
      startAdvancedTour,
      startTourById,
      triggerMicroTour,
      replayCurrentRoleTour,
      resetOnboarding,
      progress,
      activeTourMeta: activeTour ? { id: activeTour.id, title: activeTour.title, layer: activeTour.layer } : null,
    }),
    [toursEnabled, progress, currentRole, activeTour],
  );

  const step = activeTour?.steps[stepIndex];
  const totalSteps = activeTour?.steps.length ?? 0;

  return (
    <GuidedTourContext.Provider value={value}>
      {children}

      {showResumePrompt && toursEnabled && !activeTour && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-[95%] max-w-md rounded-2xl border border-royal-200 bg-white/90 backdrop-blur-md p-3 shadow-lg">
          <p className="text-sm text-gray-800 mb-2">Continue where you left off?</p>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => setShowResumePrompt(null)}>Not now</Button>
            <Button size="sm" onClick={() => { startTourById(showResumePrompt.tourId, showResumePrompt.step); setShowResumePrompt(null); }}>
              Continue tour
            </Button>
          </div>
        </div>
      )}

      {activeTour && step && (
        <>
          <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[1px]" />
          {targetRect && (
            <div
              className="fixed z-[60] rounded-2xl border-2 border-royal-400 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)] pointer-events-none animate-pulse"
              style={{
                top: targetRect.top - 8,
                left: targetRect.left - 8,
                width: targetRect.width + 16,
                height: targetRect.height + 16,
              }}
            />
          )}
          <div
            className="fixed z-[70] w-[92vw] max-w-sm rounded-2xl border border-white/60 glass-panel p-4 shadow-xl animate-page-fade-in"
            style={{
              top: targetRect ? Math.min(window.innerHeight - 260, targetRect.bottom + 12) : window.innerHeight / 2 - 100,
              left: targetRect ? Math.min(window.innerWidth - 360, Math.max(12, targetRect.left)) : window.innerWidth / 2 - 170,
            }}
          >
            <p className="text-xs text-royal-700 font-medium mb-1">{activeTour.type.toUpperCase()} TOUR</p>
            <h3 className="text-base font-semibold text-gray-900">{step.title}</h3>
            <p className="text-sm text-gray-600 mt-1">{step.description}</p>
            {practiceMode && (
              <div className="mt-2 rounded-lg border border-blue-100 bg-blue-50 p-2 text-xs text-blue-700">
                Practice Mode: sandbox actions only, no real data is modified.
              </div>
            )}
            {smartHelpMessage && (
              <div className="mt-2 rounded-lg border border-amber-100 bg-amber-50 p-2 text-xs text-amber-700">
                {smartHelpMessage}
              </div>
            )}
            <div className="mt-3 text-xs text-gray-500">
              Step {stepIndex + 1} of {totalSteps}
              <div className="mt-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                <div className="h-full rounded-full bg-royal-500 transition-all" style={{ width: `${((stepIndex + 1) / totalSteps) * 100}%` }} />
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between gap-2">
              <Button variant="outline" size="sm" onClick={previousStep} disabled={stepIndex === 0}>Back</Button>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => finishTour(false)}>Skip</Button>
                <Button size="sm" onClick={nextStep}>{stepIndex === totalSteps - 1 ? 'Finish' : 'Next'}</Button>
              </div>
            </div>
          </div>
        </>
      )}
    </GuidedTourContext.Provider>
  );
}

function toastMessage(message: string) {
  window.dispatchEvent(new CustomEvent('vitalink:notify', { detail: { module: 'tour', type: 'tour-progress', message } }));
}

export function useGuidedTour() {
  const context = useContext(GuidedTourContext);
  if (!context) throw new Error('useGuidedTour must be used within GuidedTourProvider');
  return context;
}
