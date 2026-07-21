// VitaLink - Role-Based Access Control (RBAC) System
// Enterprise-grade permission management for multi-hospital infrastructure

// ============================================
// PERMISSION SYSTEM
// ============================================

export type PermissionAction = 
  | 'view' 
  | 'create' 
  | 'edit' 
  | 'delete' 
  | 'export' 
  | 'approve';

export type PermissionModule =
  | 'dashboard'
  | 'appointments'
  | 'patients'
  | 'emr'
  | 'laboratory'
  | 'pharmacy'
  | 'billing'
  | 'insurance'
  | 'analytics'
  | 'inventory'
  | 'administration'
  | 'hr'
  | 'settings'
  | 'audit_logs';

export interface Permission {
  module: PermissionModule;
  actions: PermissionAction[];
}

// ============================================
// ROLE SYSTEM
// ============================================

export type DefaultRole =
  | 'super_admin'
  | 'hospital_admin'
  | 'doctor'
  | 'nurse'
  | 'receptionist'
  | 'lab_scientist'
  | 'pharmacist'
  | 'billing_officer'
  | 'it_officer';

export interface Role {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  isSystem: boolean;
  permissions: Permission[];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  staffCount: number;
}

// Pre-defined role templates
export const DEFAULT_ROLE_TEMPLATES: Record<DefaultRole, { name: string; description: string; permissions: Permission[] }> = {
  super_admin: {
    name: 'Super Admin',
    description: 'Full system access across all hospitals and modules',
    permissions: [
      { module: 'dashboard', actions: ['view', 'create', 'edit', 'delete', 'export', 'approve'] },
      { module: 'appointments', actions: ['view', 'create', 'edit', 'delete', 'export', 'approve'] },
      { module: 'patients', actions: ['view', 'create', 'edit', 'delete', 'export', 'approve'] },
      { module: 'emr', actions: ['view', 'create', 'edit', 'delete', 'export', 'approve'] },
      { module: 'laboratory', actions: ['view', 'create', 'edit', 'delete', 'export', 'approve'] },
      { module: 'pharmacy', actions: ['view', 'create', 'edit', 'delete', 'export', 'approve'] },
      { module: 'billing', actions: ['view', 'create', 'edit', 'delete', 'export', 'approve'] },
      { module: 'insurance', actions: ['view', 'create', 'edit', 'delete', 'export', 'approve'] },
      { module: 'analytics', actions: ['view', 'create', 'edit', 'delete', 'export', 'approve'] },
      { module: 'inventory', actions: ['view', 'create', 'edit', 'delete', 'export', 'approve'] },
      { module: 'administration', actions: ['view', 'create', 'edit', 'delete', 'export', 'approve'] },
      { module: 'hr', actions: ['view', 'create', 'edit', 'delete', 'export', 'approve'] },
      { module: 'settings', actions: ['view', 'create', 'edit', 'delete', 'export', 'approve'] },
      { module: 'audit_logs', actions: ['view', 'export'] },
    ],
  },
  hospital_admin: {
    name: 'Hospital Admin',
    description: 'Full access to assigned hospital and departments',
    permissions: [
      { module: 'dashboard', actions: ['view', 'export'] },
      { module: 'appointments', actions: ['view', 'create', 'edit', 'delete', 'export', 'approve'] },
      { module: 'patients', actions: ['view', 'create', 'edit', 'delete', 'export'] },
      { module: 'emr', actions: ['view', 'create', 'edit', 'export'] },
      { module: 'laboratory', actions: ['view', 'create', 'edit', 'delete', 'export', 'approve'] },
      { module: 'pharmacy', actions: ['view', 'create', 'edit', 'delete', 'export', 'approve'] },
      { module: 'billing', actions: ['view', 'create', 'edit', 'delete', 'export', 'approve'] },
      { module: 'insurance', actions: ['view', 'create', 'edit', 'delete', 'export', 'approve'] },
      { module: 'analytics', actions: ['view', 'export'] },
      { module: 'inventory', actions: ['view', 'create', 'edit', 'delete', 'export'] },
      { module: 'administration', actions: ['view', 'create', 'edit'] },
      { module: 'hr', actions: ['view', 'create', 'edit'] },
      { module: 'settings', actions: ['view', 'edit'] },
    ],
  },
  doctor: {
    name: 'Doctor',
    description: 'Access to EMR, lab results, and prescriptions',
    permissions: [
      { module: 'dashboard', actions: ['view'] },
      { module: 'appointments', actions: ['view', 'create', 'edit'] },
      { module: 'patients', actions: ['view', 'create', 'edit'] },
      { module: 'emr', actions: ['view', 'create', 'edit', 'export'] },
      { module: 'laboratory', actions: ['view', 'create', 'export'] },
      { module: 'pharmacy', actions: ['view', 'create'] },
      { module: 'analytics', actions: ['view'] },
    ],
  },
  nurse: {
    name: 'Nurse',
    description: 'Patient care, vitals, and medication administration',
    permissions: [
      { module: 'dashboard', actions: ['view'] },
      { module: 'appointments', actions: ['view', 'edit'] },
      { module: 'patients', actions: ['view', 'edit'] },
      { module: 'emr', actions: ['view', 'create', 'edit'] },
      { module: 'pharmacy', actions: ['view'] },
      { module: 'inventory', actions: ['view', 'edit'] },
    ],
  },
  receptionist: {
    name: 'Receptionist',
    description: 'Appointment booking and patient registration',
    permissions: [
      { module: 'dashboard', actions: ['view'] },
      { module: 'appointments', actions: ['view', 'create', 'edit'] },
      { module: 'patients', actions: ['view', 'create', 'edit'] },
      { module: 'billing', actions: ['view', 'create'] },
    ],
  },
  lab_scientist: {
    name: 'Lab Scientist',
    description: 'Laboratory tests and results management',
    permissions: [
      { module: 'dashboard', actions: ['view'] },
      { module: 'patients', actions: ['view'] },
      { module: 'laboratory', actions: ['view', 'create', 'edit', 'delete', 'export', 'approve'] },
      { module: 'emr', actions: ['view'] },
    ],
  },
  pharmacist: {
    name: 'Pharmacist',
    description: 'Pharmacy and inventory management',
    permissions: [
      { module: 'dashboard', actions: ['view'] },
      { module: 'patients', actions: ['view'] },
      { module: 'pharmacy', actions: ['view', 'create', 'edit', 'delete', 'export'] },
      { module: 'inventory', actions: ['view', 'create', 'edit', 'delete', 'export'] },
      { module: 'emr', actions: ['view'] },
    ],
  },
  billing_officer: {
    name: 'Billing Officer',
    description: 'Billing and insurance claims processing',
    permissions: [
      { module: 'dashboard', actions: ['view'] },
      { module: 'patients', actions: ['view'] },
      { module: 'billing', actions: ['view', 'create', 'edit', 'delete', 'export', 'approve'] },
      { module: 'insurance', actions: ['view', 'create', 'edit', 'delete', 'export', 'approve'] },
      { module: 'analytics', actions: ['view', 'export'] },
    ],
  },
  it_officer: {
    name: 'IT Officer',
    description: 'System configuration and technical support',
    permissions: [
      { module: 'dashboard', actions: ['view'] },
      { module: 'settings', actions: ['view', 'edit'] },
      { module: 'audit_logs', actions: ['view', 'export'] },
      { module: 'administration', actions: ['view'] },
    ],
  },
};

// ============================================
// STAFF / USER SYSTEM
// ============================================

export type StaffStatus = 'active' | 'inactive' | 'pending' | 'suspended';
export type InviteStatus = 'pending' | 'accepted' | 'expired' | 'revoked';

export interface Staff {
  id: string;
  userId: string;
  hospitalId: string;
  departmentId: string;
  roleId: string;
  
  // Personal Information
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  photoUrl?: string;
  
  // Professional Information
  employeeId: string;
  licenseNumber?: string;
  specialization?: string;
  qualification?: string;
  yearsOfExperience?: number;
  
  // Status
  status: StaffStatus;
  isEmailVerified: boolean;
  twoFactorEnabled: boolean;
  
  // Timestamps
  joinedAt: string;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
  
  // Invite Information
  inviteStatus?: InviteStatus;
  inviteSentAt?: string;
  inviteExpiresAt?: string;
  invitedBy?: string;
  
  // Relations
  role?: Role;
  department?: Department;
}

// ============================================
// INVITE SYSTEM
// ============================================

export interface StaffInvite {
  id: string;
  token: string;
  email: string;
  roleId: string;
  departmentId: string;
  hospitalId: string;
  invitedBy: string;
  status: InviteStatus;
  sentAt: string;
  expiresAt: string;
  acceptedAt?: string;
  revokedAt?: string;
  revokedBy?: string;
}

// ============================================
// DEPARTMENT SYSTEM
// ============================================

export interface Department {
  id: string;
  hospitalId: string;
  name: string;
  code: string;
  description?: string;
  
  // Leadership
  headId?: string;
  headName?: string;
  
  // Configuration
  workingHours: WorkingHours[];
  
  // Modules this department has access to
  allowedModules: PermissionModule[];
  
  // Statistics
  staffCount: number;
  patientCount: number;
  
  // Status
  isActive: boolean;
  
  // Timestamps
  createdAt: string;
  updatedAt: string;
}

export interface WorkingHours {
  dayOfWeek: number; // 0 = Sunday, 1 = Monday, etc.
  isOpen: boolean;
  openTime: string; // HH:MM format
  closeTime: string; // HH:MM format
  slotDuration: number; // minutes
}

// ============================================
// AUDIT LOG SYSTEM
// ============================================

export type AuditAction = 
  | 'login'
  | 'logout'
  | 'create'
  | 'update'
  | 'delete'
  | 'view'
  | 'export'
  | 'approve'
  | 'reject'
  | 'invite_sent'
  | 'invite_accepted'
  | 'role_changed'
  | 'permission_changed';

export interface AuditLog {
  id: string;
  timestamp: string;
  
  // Actor
  userId: string;
  userName: string;
  userEmail: string;
  userRole: string;
  ipAddress: string;
  userAgent: string;
  deviceInfo?: string;
  
  // Action
  action: AuditAction;
  module: PermissionModule;
  resourceType: string;
  resourceId: string;
  
  // Details
  description: string;
  oldValue?: Record<string, any>;
  newValue?: Record<string, any>;
  
  // Context
  hospitalId: string;
  departmentId?: string;
  
  // Risk
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

// ============================================
// SESSION & SECURITY
// ============================================

export interface UserSession {
  id: string;
  userId: string;
  token: string;
  
  // Device Info
  deviceId: string;
  deviceName: string;
  deviceType: 'desktop' | 'mobile' | 'tablet';
  browser: string;
  os: string;
  
  // Location
  ipAddress: string;
  location?: string;
  
  // Timestamps
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
  
  // Status
  isActive: boolean;
}

// ============================================
// SUBSCRIPTION & BILLING
// ============================================

export type SubscriptionPlan = 'starter' | 'professional' | 'enterprise';
export type BillingCycle = 'monthly' | 'annual';
export type PaymentStatus = 'paid' | 'pending' | 'failed' | 'refunded';

export interface Subscription {
  id: string;
  hospitalId: string;
  plan: SubscriptionPlan;
  billingCycle: BillingCycle;
  
  // Pricing
  basePrice: number;
  perUserPrice: number;
  totalPrice: number;
  
  // Usage
  maxUsers: number;
  maxPatients: number;
  maxStorageGB: number;
  
  // Current Usage
  currentUsers: number;
  currentPatients: number;
  currentStorageGB: number;
  
  // Status
  status: 'active' | 'cancelled' | 'suspended' | 'trial';
  autoRenew: boolean;
  
  // Dates
  startDate: string;
  endDate: string;
  nextBillingDate: string;
  trialEndsAt?: string;
  
  // Payment
  paymentMethod?: PaymentMethod;
}

export interface PaymentMethod {
  id: string;
  type: 'card' | 'bank_transfer' | 'mobile_money';
  last4?: string;
  brand?: string;
  expiryMonth?: number;
  expiryYear?: number;
  isDefault: boolean;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  hospitalId: string;
  subscriptionId: string;
  
  // Amounts
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  
  // Details
  description: string;
  lineItems: InvoiceLineItem[];
  
  // Status
  status: PaymentStatus;
  paidAt?: string;
  
  // Dates
  issueDate: string;
  dueDate: string;
  
  // PDF
  pdfUrl?: string;
}

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

// ============================================
// FACILITY / HOSPITAL
// ============================================

export interface Hospital {
  id: string;
  name: string;
  code: string;
  
  // Contact
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  country: string;
  
  // Registration
  registrationNumber: string;
  taxId?: string;
  licenseNumber: string;
  licenseExpiry?: string;
  
  // Branding
  logoUrl?: string;
  primaryColor?: string;
  
  // Settings
  timezone: string;
  currency: string;
  language: string;
  
  // Status
  isActive: boolean;
  isVerified: boolean;
  
  // Parent (for multi-branch)
  parentHospitalId?: string;
  
  // Timestamps
  createdAt: string;
  updatedAt: string;
}
