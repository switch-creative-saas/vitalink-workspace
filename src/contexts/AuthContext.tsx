import { createContext, useContext, useState, type ReactNode } from 'react';
import type { PageType } from '@/types';
import {
  DEFAULT_HEALTHCARE_ORGANIZATION,
  canAccessPageForWorkspace,
} from '@/lib/workspace/workspace';
import type { OrganizationProfile, OrganizationType, WorkspaceType } from '@/lib/workspace/organizationTypes';

// ============================================
// RBAC TYPES (INLINE TO AVOID IMPORT ISSUES)
// ============================================

export type UserRole =
  | 'super-admin'
  | 'hospital-admin'
  | 'doctor'
  | 'nurse'
  | 'receptionist'
  | 'lab-scientist'
  | 'lab-technician'
  | 'pharmacist'
  | 'billing-officer'
  | 'insurance-officer'
  | 'it-officer'
  | 'support-agent'
  | 'public-health-officer'
  | 'epidemiologist'
  | 'government-authority'
  | 'community-health-worker'
  | 'who-ngo-observer'
  | 'ngo-admin'
  | 'program-manager'
  | 'data-monitoring-officer'
  | 'field-officer'
  | 'public-health-viewer'
  | 'government-admin'
  | 'public-health-director'
  | 'surveillance-officer'
  | 'data-analyst'
  | 'government-viewer';

type PermissionAction = 'view' | 'create' | 'edit' | 'delete' | 'export' | 'approve';

interface Permission {
  module: string;
  actions: PermissionAction[];
}

interface RoleConfig {
  name: string;
  description: string;
  permissions: Permission[];
}

// ============================================
// ROLE CONFIGURATIONS
// ============================================

const ROLE_CONFIGS: Record<UserRole, RoleConfig> = {
  'super-admin': {
    name: 'Super Admin',
    description: 'Full system access',
    permissions: [
      { module: 'Dashboard', actions: ['view', 'create', 'edit', 'delete', 'export', 'approve'] },
      { module: 'Appointments', actions: ['view', 'create', 'edit', 'delete', 'export', 'approve'] },
      { module: 'Patients', actions: ['view', 'create', 'edit', 'delete', 'export', 'approve'] },
      { module: 'EMR', actions: ['view', 'create', 'edit', 'delete', 'export', 'approve'] },
      { module: 'Laboratory', actions: ['view', 'create', 'edit', 'delete', 'export', 'approve'] },
      { module: 'Pharmacy', actions: ['view', 'create', 'edit', 'delete', 'export', 'approve'] },
      { module: 'Billing', actions: ['view', 'create', 'edit', 'delete', 'export', 'approve'] },
      { module: 'Analytics', actions: ['view', 'create', 'edit', 'delete', 'export', 'approve'] },
      { module: 'Human Resources', actions: ['view', 'create', 'edit', 'delete', 'export', 'approve'] },
      { module: 'Administration', actions: ['view', 'create', 'edit', 'delete', 'export', 'approve'] },
      { module: 'Settings', actions: ['view', 'create', 'edit', 'delete', 'export', 'approve'] },
      { module: 'Public Health', actions: ['view', 'create', 'edit', 'delete', 'export', 'approve'] },
    ],
  },
  'hospital-admin': {
    name: 'Hospital Admin',
    description: 'Hospital management access',
    permissions: [
      { module: 'Dashboard', actions: ['view', 'create', 'edit', 'delete', 'export', 'approve'] },
      { module: 'Appointments', actions: ['view', 'create', 'edit', 'delete', 'export', 'approve'] },
      { module: 'Patients', actions: ['view', 'create', 'edit', 'delete', 'export', 'approve'] },
      { module: 'EMR', actions: ['view'] },
      { module: 'Laboratory', actions: ['view', 'create', 'edit', 'delete', 'export', 'approve'] },
      { module: 'Pharmacy', actions: ['view', 'create', 'edit', 'export', 'approve'] },
      { module: 'Billing', actions: ['view', 'create', 'edit', 'export'] },
      { module: 'Analytics', actions: ['view', 'export'] },
      { module: 'Human Resources', actions: ['view', 'create', 'edit', 'delete'] },
      { module: 'Administration', actions: ['view', 'create', 'edit', 'delete'] },
      { module: 'Settings', actions: ['view', 'edit'] },
      { module: 'Public Health', actions: ['view', 'create', 'export'] },
    ],
  },
  'doctor': {
    name: 'Doctor',
    description: 'Patient care & EMR access',
    permissions: [
      { module: 'Dashboard', actions: ['view'] },
      { module: 'Appointments', actions: ['view', 'create', 'edit'] },
      { module: 'Patients', actions: ['view', 'create', 'edit'] },
      { module: 'EMR', actions: ['view', 'create', 'edit', 'export'] },
      { module: 'Laboratory', actions: ['view', 'create'] },
      { module: 'Pharmacy', actions: ['view'] },
      { module: 'Analytics', actions: ['view'] },
    ],
  },
  'nurse': {
    name: 'Nurse',
    description: 'Patient care & vitals',
    permissions: [
      { module: 'Dashboard', actions: ['view'] },
      { module: 'Appointments', actions: ['view'] },
      { module: 'Patients', actions: ['view', 'edit'] },
      { module: 'EMR', actions: ['view', 'edit'] },
      { module: 'Laboratory', actions: ['view'] },
    ],
  },
  'receptionist': {
    name: 'Receptionist',
    description: 'Appointments & registration',
    permissions: [
      { module: 'Dashboard', actions: ['view'] },
      { module: 'Appointments', actions: ['view', 'create', 'edit'] },
      { module: 'Patients', actions: ['view', 'create'] },
      { module: 'Laboratory', actions: ['view', 'create'] },
    ],
  },
  'lab-scientist': {
    name: 'Lab Scientist',
    description: 'Laboratory management',
    permissions: [
      { module: 'Dashboard', actions: ['view'] },
      { module: 'Patients', actions: ['view'] },
      { module: 'Laboratory', actions: ['view', 'create', 'edit', 'delete', 'export'] },
      { module: 'Public Health', actions: ['view', 'create', 'export'] },
    ],
  },
  'lab-technician': {
    name: 'Lab Technician',
    description: 'Sample handling & raw data entry',
    permissions: [
      { module: 'Dashboard', actions: ['view'] },
      { module: 'Patients', actions: ['view'] },
      { module: 'Laboratory', actions: ['view', 'edit'] },
    ],
  },
  'pharmacist': {
    name: 'Pharmacist',
    description: 'Pharmacy & inventory',
    permissions: [
      { module: 'Dashboard', actions: ['view'] },
      { module: 'Patients', actions: ['view'] },
      { module: 'Pharmacy', actions: ['view', 'create', 'edit', 'export'] },
      { module: 'Billing', actions: ['view', 'create'] },
    ],
  },
  'billing-officer': {
    name: 'Billing Officer',
    description: 'Billing & insurance',
    permissions: [
      { module: 'Dashboard', actions: ['view'] },
      { module: 'Patients', actions: ['view'] },
      { module: 'Billing', actions: ['view', 'create', 'edit', 'export'] },
      { module: 'Analytics', actions: ['view', 'export'] },
    ],
  },
  'insurance-officer': {
    name: 'Insurance Officer',
    description: 'Insurance claims & approvals',
    permissions: [
      { module: 'Dashboard', actions: ['view'] },
      { module: 'Patients', actions: ['view'] },
      { module: 'Billing', actions: ['view', 'edit', 'approve', 'export'] },
      { module: 'Analytics', actions: ['view'] },
    ],
  },
  'it-officer': {
    name: 'IT Officer',
    description: 'System & security',
    permissions: [
      { module: 'Dashboard', actions: ['view'] },
      { module: 'Human Resources', actions: ['view'] },
      { module: 'Administration', actions: ['view', 'edit'] },
      { module: 'Settings', actions: ['view', 'edit'] },
    ],
  },
  'support-agent': {
    name: 'Support Agent',
    description: 'Internal support operations',
    permissions: [
      { module: 'Dashboard', actions: ['view'] },
      { module: 'Settings', actions: ['view', 'create', 'edit'] },
      { module: 'Administration', actions: ['view'] },
      { module: 'Analytics', actions: ['view'] },
    ],
  },
  'public-health-officer': {
    name: 'Public Health Officer',
    description: 'Regional surveillance & reporting',
    permissions: [
      { module: 'Dashboard', actions: ['view'] },
      { module: 'Patients', actions: ['view'] },
      { module: 'EMR', actions: ['view'] },
      { module: 'Laboratory', actions: ['view'] },
      { module: 'Analytics', actions: ['view', 'export'] },
      { module: 'Public Health', actions: ['view', 'create', 'edit', 'export'] },
    ],
  },
  epidemiologist: {
    name: 'Epidemiologist',
    description: 'National outbreak analytics & thresholds',
    permissions: [
      { module: 'Dashboard', actions: ['view'] },
      { module: 'Patients', actions: ['view'] },
      { module: 'EMR', actions: ['view'] },
      { module: 'Laboratory', actions: ['view'] },
      { module: 'Analytics', actions: ['view', 'export'] },
      { module: 'Public Health', actions: ['view', 'create', 'edit', 'delete', 'export', 'approve'] },
    ],
  },
  'government-authority': {
    name: 'Government Authority',
    description: 'National visibility & policy dashboards',
    permissions: [
      { module: 'Dashboard', actions: ['view'] },
      { module: 'Analytics', actions: ['view', 'export'] },
      { module: 'Administration', actions: ['view'] },
      { module: 'Public Health', actions: ['view', 'export', 'approve'] },
    ],
  },
  'community-health-worker': {
    name: 'Community Health Worker',
    description: 'Community outbreak signals',
    permissions: [
      { module: 'Dashboard', actions: ['view'] },
      { module: 'Public Health', actions: ['view', 'create'] },
    ],
  },
  'who-ngo-observer': {
    name: 'WHO / NGO Observer',
    description: 'Read-only epidemiology observer',
    permissions: [
      { module: 'Dashboard', actions: ['view'] },
      { module: 'Public Health', actions: ['view'] },
    ],
  },
  'ngo-admin': {
    name: 'NGO Admin',
    description: 'Public health NGO workspace administrator',
    permissions: [
      { module: 'Dashboard', actions: ['view', 'export'] },
      { module: 'Public Health', actions: ['view', 'create', 'edit', 'export', 'approve'] },
      { module: 'Settings', actions: ['view', 'edit'] },
    ],
  },
  'program-manager': {
    name: 'Program Manager',
    description: 'Program oversight and public health response',
    permissions: [
      { module: 'Dashboard', actions: ['view'] },
      { module: 'Public Health', actions: ['view', 'create', 'edit', 'export'] },
      { module: 'Settings', actions: ['view'] },
    ],
  },
  'data-monitoring-officer': {
    name: 'Data Monitoring Officer',
    description: 'Surveillance data review and reporting',
    permissions: [
      { module: 'Dashboard', actions: ['view'] },
      { module: 'Public Health', actions: ['view', 'create', 'export'] },
    ],
  },
  'field-officer': {
    name: 'Field Officer',
    description: 'Community and field case reporting',
    permissions: [
      { module: 'Dashboard', actions: ['view'] },
      { module: 'Public Health', actions: ['view', 'create'] },
    ],
  },
  'public-health-viewer': {
    name: 'Public Health Viewer',
    description: 'Read-only public health visibility',
    permissions: [
      { module: 'Dashboard', actions: ['view'] },
      { module: 'Public Health', actions: ['view'] },
    ],
  },
  'government-admin': {
    name: 'Government Admin',
    description: 'Government public health workspace administrator',
    permissions: [
      { module: 'Dashboard', actions: ['view', 'export', 'approve'] },
      { module: 'Administration', actions: ['view', 'create', 'edit', 'approve'] },
      { module: 'Public Health', actions: ['view', 'create', 'edit', 'delete', 'export', 'approve'] },
      { module: 'Settings', actions: ['view', 'edit'] },
    ],
  },
  'public-health-director': {
    name: 'Public Health Director',
    description: 'Strategic surveillance and outbreak command',
    permissions: [
      { module: 'Dashboard', actions: ['view', 'export', 'approve'] },
      { module: 'Public Health', actions: ['view', 'create', 'edit', 'export', 'approve'] },
      { module: 'Settings', actions: ['view'] },
    ],
  },
  'surveillance-officer': {
    name: 'Surveillance Officer',
    description: 'Disease surveillance and alert triage',
    permissions: [
      { module: 'Dashboard', actions: ['view'] },
      { module: 'Public Health', actions: ['view', 'create', 'edit', 'export'] },
    ],
  },
  'data-analyst': {
    name: 'Data Analyst',
    description: 'Public health analytics and reporting',
    permissions: [
      { module: 'Dashboard', actions: ['view'] },
      { module: 'Public Health', actions: ['view', 'export'] },
      { module: 'Settings', actions: ['view'] },
    ],
  },
  'government-viewer': {
    name: 'Government Viewer',
    description: 'Read-only government public health visibility',
    permissions: [
      { module: 'Dashboard', actions: ['view'] },
      { module: 'Public Health', actions: ['view'] },
    ],
  },
};

const MODULE_MAP: Record<string, string> = {
  'dashboard': 'Dashboard',
  'patient-identity': 'Patients',
  'patients': 'Patients',
  'emr': 'EMR',
  'telemedicine': 'Appointments',
  'ai-clinical-intelligence': 'EMR',
  'switch-network': 'Administration',
  'appointments': 'Appointments',
  'laboratory': 'Laboratory',
  'pharmacy': 'Pharmacy',
  'billing': 'Billing',
  'analytics': 'Analytics',
  'human-resources': 'Human Resources',
  'administration': 'Administration',
  'switch-sentinel': 'Public Health',
  'subscription': 'Settings',
  'audit-logs': 'Settings',
  'settings': 'Settings',
  'help': 'Settings',
};

// ============================================
// CONTEXT
// ============================================

export interface AuthContextType {
  currentRole: UserRole;
  setCurrentRole: (role: UserRole) => void;
  roleConfig: RoleConfig | undefined;
  canView: (module: string) => boolean;
  canCreate: (module: string) => boolean;
  canEdit: (module: string) => boolean;
  canDelete: (module: string) => boolean;
  canExport: (module: string) => boolean;
  canApprove: (module: string) => boolean;
  canAccessPage: (page: string) => boolean;
  hasPermission: (module: string, action: string) => boolean;
  organization: OrganizationProfile;
  organizationType: OrganizationType;
  workspaceType: WorkspaceType;
  setActiveOrganization: (organization: OrganizationProfile | null) => void;
  isSuperAdmin: boolean;
  isDoctor: boolean;
  isReceptionist: boolean;
  isNurse: boolean;
  isLabScientist: boolean;
  isLabTechnician: boolean;
  isPharmacist: boolean;
  isBillingOfficer: boolean;
  isHospitalAdmin: boolean;
  userName: string;
  userEmail: string;
  userAvatar: string;
  setUserProfile: (profile: { name: string; email: string; avatar?: string }) => void;
  clearUserProfile: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentRole, setCurrentRole] = useState<UserRole>(() => {
    // Try to get from localStorage
    const saved = localStorage.getItem('vitalink-role');
    return (saved as UserRole) || 'super-admin';
  });
  const [organization, setOrganization] = useState<OrganizationProfile>(() => {
    const raw = localStorage.getItem('vitalink-active-organization');
    if (!raw) return DEFAULT_HEALTHCARE_ORGANIZATION;
    try {
      return JSON.parse(raw) as OrganizationProfile;
    } catch {
      return DEFAULT_HEALTHCARE_ORGANIZATION;
    }
  });

  const roleConfig = ROLE_CONFIGS[currentRole];
  const [userProfile, setUserProfileState] = useState<{ name: string; email: string; avatar?: string } | null>(() => {
    const raw = localStorage.getItem('vitalink-user-profile');
    if (!raw) return null;
    try {
      return JSON.parse(raw) as { name: string; email: string; avatar?: string };
    } catch {
      return null;
    }
  });

  const hasPermission = (module: string, action: string): boolean => {
    if (currentRole === 'super-admin') return true;
    const permission = roleConfig?.permissions.find(p => p.module === module);
    return permission?.actions.includes(action as PermissionAction) ?? false;
  };

  const canView = (module: string) => hasPermission(module, 'view');
  const canCreate = (module: string) => hasPermission(module, 'create');
  const canEdit = (module: string) => hasPermission(module, 'edit');
  const canDelete = (module: string) => hasPermission(module, 'delete');
  const canExport = (module: string) => hasPermission(module, 'export');
  const canApprove = (module: string) => hasPermission(module, 'approve');

  const canAccessPage = (page: string): boolean => {
    const pageType = page as PageType;
    if (!canAccessPageForWorkspace({
      page: pageType,
      role: currentRole,
      workspaceType: organization.workspaceType,
      organizationType: organization.organizationType,
    })) {
      return false;
    }

    const module = MODULE_MAP[page];
    if (!module) return false;
    if (currentRole === 'super-admin') return true;
    if (organization.workspaceType === 'public-health') return true;
    return canView(module);
  };

  const roleDisplayInfo: Record<UserRole, { name: string; email: string; avatar: string }> = {
    'super-admin': { name: 'Super Admin', email: 'admin@vitalink.africa', avatar: 'SA' },
    'hospital-admin': { name: 'Hospital Admin', email: 'hospital.admin@vitalink.africa', avatar: 'HA' },
    'doctor': { name: 'Dr. Sarah Johnson', email: 's.johnson@vitalink.africa', avatar: 'SJ' },
    'nurse': { name: 'Nurse Amina Bello', email: 'a.bello@vitalink.africa', avatar: 'AB' },
    'receptionist': { name: 'Receptionist John', email: 'reception@vitalink.africa', avatar: 'RJ' },
    'lab-scientist': { name: 'Lab Scientist Okonkwo', email: 'o.okonkwo@vitalink.africa', avatar: 'LO' },
    'lab-technician': { name: 'Lab Tech Ibrahim Musa', email: 'i.musa@vitalink.africa', avatar: 'LT' },
    'pharmacist': { name: 'Pharmacist Adeyemi', email: 'p.adeyemi@vitalink.africa', avatar: 'PA' },
    'billing-officer': { name: 'Billing Officer Ngozi', email: 'n.obi@vitalink.africa', avatar: 'BN' },
    'insurance-officer': { name: 'Insurance Officer Chika', email: 'insurance@vitalink.africa', avatar: 'IO' },
    'it-officer': { name: 'IT Officer Michael', email: 'it@vitalink.africa', avatar: 'IM' },
    'support-agent': { name: 'Support Agent Grace', email: 'support@vitalink.africa', avatar: 'SG' },
    'public-health-officer': { name: 'PHO Ibrahim Danladi', email: 'pho@vitalink.africa', avatar: 'PH' },
    epidemiologist: { name: 'Epidemiologist Dr. Ngozi Eze', email: 'epi@vitalink.africa', avatar: 'EP' },
    'government-authority': { name: 'Gov. Authority Panel', email: 'authority@vitalink.africa', avatar: 'GA' },
    'community-health-worker': { name: 'CHW Fatima Yusuf', email: 'chw@vitalink.africa', avatar: 'CH' },
    'who-ngo-observer': { name: 'WHO Observer', email: 'observer@vitalink.africa', avatar: 'WO' },
    'ngo-admin': { name: 'NGO Admin', email: 'ngo.admin@vitalink.africa', avatar: 'NA' },
    'program-manager': { name: 'Program Manager', email: 'programs@vitalink.africa', avatar: 'PM' },
    'data-monitoring-officer': { name: 'Data Monitoring Officer', email: 'monitoring@vitalink.africa', avatar: 'DM' },
    'field-officer': { name: 'Field Officer', email: 'field@vitalink.africa', avatar: 'FO' },
    'public-health-viewer': { name: 'Public Health Viewer', email: 'viewer@vitalink.africa', avatar: 'PV' },
    'government-admin': { name: 'Government Admin', email: 'gov.admin@vitalink.africa', avatar: 'GA' },
    'public-health-director': { name: 'Public Health Director', email: 'director@vitalink.africa', avatar: 'PD' },
    'surveillance-officer': { name: 'Surveillance Officer', email: 'surveillance@vitalink.africa', avatar: 'SO' },
    'data-analyst': { name: 'Data Analyst', email: 'analytics@vitalink.africa', avatar: 'DA' },
    'government-viewer': { name: 'Government Viewer', email: 'gov.viewer@vitalink.africa', avatar: 'GV' },
  };

  const userInfo = roleDisplayInfo[currentRole];

  const handleSetRole = (role: UserRole) => {
    setCurrentRole(role);
    localStorage.setItem('vitalink-role', role);
  };

  const setUserProfile = (profile: { name: string; email: string; avatar?: string }) => {
    setUserProfileState(profile);
    localStorage.setItem('vitalink-user-profile', JSON.stringify(profile));
  };

  const clearUserProfile = () => {
    setUserProfileState(null);
    localStorage.removeItem('vitalink-user-profile');
  };

  const setActiveOrganization = (nextOrganization: OrganizationProfile | null) => {
    const resolved = nextOrganization ?? DEFAULT_HEALTHCARE_ORGANIZATION;
    setOrganization(resolved);
    localStorage.setItem('vitalink-active-organization', JSON.stringify(resolved));
  };

  return (
    <AuthContext.Provider
      value={{
        currentRole,
        setCurrentRole: handleSetRole,
        roleConfig,
        canView,
        canCreate,
        canEdit,
        canDelete,
        canExport,
        canApprove,
        canAccessPage,
        hasPermission,
        organization,
        organizationType: organization.organizationType,
        workspaceType: organization.workspaceType,
        setActiveOrganization,
        isSuperAdmin: currentRole === 'super-admin',
        isDoctor: currentRole === 'doctor',
        isReceptionist: currentRole === 'receptionist',
        isNurse: currentRole === 'nurse',
        isLabScientist: currentRole === 'lab-scientist',
        isLabTechnician: currentRole === 'lab-technician',
        isPharmacist: currentRole === 'pharmacist',
        isBillingOfficer: currentRole === 'billing-officer',
        isHospitalAdmin: currentRole === 'hospital-admin',
        userName: userProfile?.name ?? userInfo?.name ?? 'User',
        userEmail: userProfile?.email ?? userInfo?.email ?? 'user@vitalink.africa',
        userAvatar: userProfile?.avatar ?? userInfo?.avatar ?? 'U',
        setUserProfile,
        clearUserProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
