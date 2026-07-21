// VitaLink Management System - Type Definitions
// Africa's Offline-First Digital Health Identity Infrastructure

// ============================================
// DIGITAL HEALTH IDENTITY LAYER
// ============================================

export interface DigitalHealthIdentity {
  uhin: string; // Unique Health Identity Number
  nfcCardId?: string;
  qrCode: string;
  biometricHash?: string;
  createdAt: string;
  lastSyncedAt: string;
  syncStatus: 'synced' | 'pending' | 'offline';
}

export interface NFCScanResult {
  cardId: string;
  timestamp: string;
  patientId: string;
  success: boolean;
  location: string;
}

// ============================================
// PATIENT MANAGEMENT
// ============================================

export interface Patient {
  id: string;
  identity: DigitalHealthIdentity;
  demographics: PatientDemographics;
  medicalHistory: MedicalHistory;
  allergies: Allergy[];
  medications: Medication[];
  vitals: VitalSigns[];
  emergencyContact: EmergencyContact;
  insurance: InsuranceInfo;
  visits: Visit[];
  documents: Document[];
  createdAt: string;
  updatedAt: string;
  isOffline: boolean;
}

export interface PatientDemographics {
  firstName: string;
  middleName?: string;
  lastName: string;
  dateOfBirth: string;
  gender: 'male' | 'female' | 'other' | 'unknown';
  bloodType?: 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-' | 'unknown';
  phone: string;
  email?: string;
  address: Address;
  nationality: string;
  occupation?: string;
  maritalStatus?: 'single' | 'married' | 'divorced' | 'widowed';
  language: string;
  photoUrl?: string;
}

export interface Address {
  street: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
  coordinates?: { lat: number; lng: number };
}

export interface EmergencyContact {
  name: string;
  relationship: string;
  phone: string;
  email?: string;
  address?: Address;
}

export interface InsuranceInfo {
  provider: string;
  policyNumber: string;
  groupNumber?: string;
  coverageType: 'private' | 'public' | 'corporate' | 'self';
  validFrom: string;
  validUntil: string;
  status: 'active' | 'expired' | 'pending';
  copayAmount?: number;
  annualLimit?: number;
}

// ============================================
// MEDICAL RECORDS (EMR)
// ============================================

export interface MedicalHistory {
  conditions: MedicalCondition[];
  surgeries: any[];
  familyHistory: any[];
  socialHistory: any;
  immunizations: any[];
}

export interface MedicalCondition {
  id: string;
  name: string;
  icd10Code?: string;
  diagnosedDate: string;
  status: 'active' | 'resolved' | 'chronic';
  severity: 'mild' | 'moderate' | 'severe';
  notes?: string;
  treatingPhysician?: string;
}

export interface Allergy {
  id: string;
  allergen: string;
  type: 'medication' | 'food' | 'environmental' | 'latex' | 'other';
  severity: 'mild' | 'moderate' | 'severe' | 'life-threatening';
  reaction: string;
  onsetDate?: string;
  notes?: string;
}

export interface Medication {
  id: string;
  name: string;
  genericName?: string;
  dosage: string;
  frequency: string;
  route: 'oral' | 'iv' | 'im' | 'sc' | 'topical' | 'inhalation' | 'other';
  prescribedBy: string;
  prescribedDate: string;
  startDate: string;
  endDate?: string;
  status: 'active' | 'discontinued' | 'completed' | 'on-hold';
  instructions?: string;
  refills?: number;
}

export interface VitalSigns {
  id: string;
  recordedAt: string;
  recordedBy: string;
  temperature?: number; // Celsius
  heartRate?: number; // bpm
  bloodPressure?: { systolic: number; diastolic: number };
  respiratoryRate?: number; // breaths per minute
  oxygenSaturation?: number; // percentage
  weight?: number; // kg
  height?: number; // cm
  bmi?: number;
  painScale?: number; // 0-10
  notes?: string;
}

export interface Visit {
  id: string;
  patientId: string;
  type: 'outpatient' | 'inpatient' | 'emergency' | 'telemedicine';
  department: string;
  doctorId: string;
  doctorName: string;
  scheduledDate?: string;
  actualDate: string;
  duration?: number; // minutes
  chiefComplaint: string;
  diagnosis?: Diagnosis[];
  prescriptions?: Prescription[];
  procedures?: Procedure[];
  notes?: string;
  status: 'scheduled' | 'checked-in' | 'in-progress' | 'completed' | 'cancelled' | 'no-show';
  vitals?: VitalSigns;
  followUpDate?: string;
}

export interface Diagnosis {
  id: string;
  name: string;
  icd10Code: string;
  type: 'primary' | 'secondary';
  notes?: string;
}

export interface Prescription {
  id: string;
  medicationId: string;
  medicationName: string;
  dosage: string;
  quantity: number;
  instructions: string;
  refills: number;
  prescribedBy: string;
  prescribedDate: string;
}

export interface Procedure {
  id: string;
  name: string;
  cptCode?: string;
  performedBy: string;
  performedDate: string;
  notes?: string;
  outcome?: string;
}

export interface Document {
  id: string;
  patientId: string;
  type: 'lab-report' | 'imaging' | 'prescription' | 'discharge-summary' | 'referral' | 'consent' | 'other';
  title: string;
  fileUrl: string;
  fileType: string;
  fileSize: number;
  uploadedBy: string;
  uploadedAt: string;
  tags?: string[];
  isConfidential: boolean;
}

// ============================================
// LABORATORY MODULE
// ============================================

export interface LabOrder {
  id: string;
  patientId: string;
  patientName: string;
  orderedBy: string;
  orderedDate: string;
  tests: LabTest[];
  priority: 'routine' | 'urgent' | 'stat';
  status: 'pending' | 'in-progress' | 'completed' | 'cancelled';
  notes?: string;
}

export interface LabTest {
  id: string;
  orderId: string;
  testCode: string;
  testName: string;
  category: string;
  sampleType: string;
  result?: LabResult;
  referenceRange?: string;
  units?: string;
  status: 'pending' | 'collected' | 'processing' | 'completed' | 'cancelled';
  collectedAt?: string;
  collectedBy?: string;
  completedAt?: string;
  cost?: number;
}

export interface LabResult {
  value: string | number;
  numericValue?: number;
  isAbnormal: boolean;
  abnormalFlag?: 'low' | 'high' | 'critical';
  notes?: string;
  verifiedBy?: string;
  verifiedAt?: string;
}

// ============================================
// PHARMACY MODULE
// ============================================

export interface PharmacyItem {
  id: string;
  sku: string;
  name: string;
  genericName?: string;
  category: string;
  form: 'tablet' | 'capsule' | 'syrup' | 'injection' | 'cream' | 'ointment' | 'drops' | 'inhaler' | 'other';
  strength: string;
  manufacturer?: string;
  batchNumber?: string;
  expiryDate?: string;
  quantityInStock: number;
  reorderLevel: number;
  unitPrice: number;
  status: 'active' | 'inactive' | 'discontinued';
  storageConditions?: string;
  sideEffects?: string[];
  contraindications?: string[];
}

export interface PharmacyTransaction {
  id: string;
  itemId: string;
  type: 'in' | 'out' | 'adjustment' | 'return';
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  referenceType?: 'prescription' | 'purchase' | 'waste' | 'transfer';
  referenceId?: string;
  performedBy: string;
  performedAt: string;
  notes?: string;
}

// ============================================
// APPOINTMENT SCHEDULING
// ============================================

export interface Appointment {
  id: string;
  patientId: string;
  patientName: string;
  doctorId: string;
  doctorName: string;
  department: string;
  date: string;
  startTime: string;
  endTime: string;
  duration: number;
  type: 'consultation' | 'follow-up' | 'procedure' | 'surgery' | 'telemedicine';
  status: 'scheduled' | 'confirmed' | 'checked-in' | 'in-progress' | 'completed' | 'cancelled' | 'no-show';
  chiefComplaint?: string;
  notes?: string;
  reminderSent: boolean;
  createdBy: string;
  createdAt: string;
}

export interface DoctorSchedule {
  doctorId: string;
  dayOfWeek: number; // 0-6
  startTime: string;
  endTime: string;
  slotDuration: number;
  isAvailable: boolean;
  exceptions?: ScheduleException[];
}

export interface ScheduleException {
  date: string;
  isAvailable: boolean;
  reason?: string;
}

// ============================================
// BILLING & INSURANCE
// ============================================

export interface Invoice {
  id: string;
  invoiceNumber: string;
  patientId: string;
  patientName: string;
  date: string;
  dueDate: string;
  items: InvoiceItem[];
  subtotal: number;
  discount?: number;
  tax?: number;
  total: number;
  amountPaid: number;
  balance: number;
  status: 'draft' | 'sent' | 'paid' | 'partial' | 'overdue' | 'cancelled';
  paymentMethod?: 'cash' | 'card' | 'bank-transfer' | 'insurance' | 'mobile-money';
  insuranceClaim?: InsuranceClaim;
  notes?: string;
  createdBy: string;
  createdAt: string;
}

export interface InvoiceItem {
  id: string;
  description: string;
  type: 'consultation' | 'procedure' | 'lab' | 'pharmacy' | 'room' | 'other';
  quantity: number;
  unitPrice: number;
  total: number;
  referenceId?: string;
}

export interface InsuranceClaim {
  id: string;
  invoiceId: string;
  provider: string;
  policyNumber: string;
  claimNumber: string;
  claimedAmount: number;
  approvedAmount?: number;
  status: 'pending' | 'submitted' | 'processing' | 'approved' | 'rejected' | 'partial';
  submittedDate: string;
  responseDate?: string;
  rejectionReason?: string;
}

export interface Payment {
  id: string;
  invoiceId: string;
  amount: number;
  method: 'cash' | 'card' | 'bank-transfer' | 'insurance' | 'mobile-money';
  referenceNumber?: string;
  receivedBy: string;
  receivedAt: string;
  notes?: string;
}

// ============================================
// ANALYTICS & REPORTING
// ============================================

export interface DashboardMetric {
  id: string;
  name: string;
  value: number;
  previousValue?: number;
  change?: number;
  changeType?: 'increase' | 'decrease' | 'neutral';
  unit?: string;
  icon: string;
  color: string;
}

export interface AnalyticsReport {
  id: string;
  name: string;
  type: 'patient' | 'financial' | 'clinical' | 'operational';
  dateRange: { start: string; end: string };
  filters?: Record<string, any>;
  generatedAt: string;
  generatedBy: string;
  data: any;
}

// ============================================
// VitaMind AI
// ============================================

export interface VitaMindAIInsight {
  id: string;
  type: 'risk-alert' | 'trend' | 'diagnosis-suggestion' | 'duplicate-detection' | 'prediction';
  patientId?: string;
  patientName?: string;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  confidence?: number;
  recommendedAction?: string;
  createdAt: string;
  isRead: boolean;
}

// ============================================
// USER MANAGEMENT & RBAC
// ============================================

export type UserRole = 
  | 'super-admin'
  | 'state-admin'
  | 'facility-admin'
  | 'doctor'
  | 'nurse'
  | 'lab-technician'
  | 'pharmacist'
  | 'receptionist'
  | 'billing'
  | 'patient-viewer';

export interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  role: UserRole;
  department?: string;
  facilityId?: string;
  stateId?: string;
  licenseNumber?: string;
  specialties?: string[];
  permissions: Permission[];
  status: 'active' | 'inactive' | 'suspended';
  lastLoginAt?: string;
  createdAt: string;
  photoUrl?: string;
}

export interface Permission {
  resource: string;
  actions: ('create' | 'read' | 'update' | 'delete' | 'approve')[];
}

// ============================================
// FACILITY & INFRASTRUCTURE
// ============================================

export interface Facility {
  id: string;
  name: string;
  type: 'hospital' | 'clinic' | 'phc' | 'lab' | 'pharmacy' | 'specialized';
  stateId: string;
  stateName: string;
  lga?: string;
  address: Address;
  contact: {
    phone: string;
    email?: string;
    website?: string;
  };
  services: string[];
  departments: Department[];
  operatingHours?: OperatingHours;
  status: 'active' | 'inactive';
  createdAt: string;
}

export interface Department {
  id: string;
  name: string;
  code: string;
  headId?: string;
  headName?: string;
  services: string[];
  status: 'active' | 'inactive';
}

export interface OperatingHours {
  dayOfWeek: number;
  openTime: string;
  closeTime: string;
  isOpen: boolean;
}

// ============================================
// AUDIT & COMPLIANCE
// ============================================

export interface AuditLog {
  id: string;
  userId: string;
  userName: string;
  userRole: UserRole;
  action: string;
  resource: string;
  resourceId: string;
  oldValue?: any;
  newValue?: any;
  ipAddress?: string;
  userAgent?: string;
  timestamp: string;
  facilityId?: string;
}

// ============================================
// OFFLINE SYNC
// ============================================

export interface SyncQueueItem {
  id: string;
  entityType: string;
  entityId: string;
  operation: 'create' | 'update' | 'delete';
  data: any;
  timestamp: string;
  retryCount: number;
  status: 'pending' | 'syncing' | 'completed' | 'failed';
  errorMessage?: string;
}

// ============================================
// UI STATE
// ============================================

export type PageType = 
  | 'dashboard'
  | 'patient-identity'
  | 'patients'
  | 'emr'
  | 'telemedicine'
  | 'ai-clinical-intelligence'
  | 'switch-network'
  | 'appointments'
  | 'laboratory'
  | 'pharmacy'
  | 'billing'
  | 'analytics'
  | 'human-resources'
  | 'administration'
  | 'switch-sentinel'
  | 'subscription'
  | 'audit-logs'
  | 'settings'
  | 'help';

export interface Notification {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  timestamp: string;
  isRead: boolean;
  actionUrl?: string;
}
