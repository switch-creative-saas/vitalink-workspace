// Guided tours for the VitaLink workspace. Written for busy clinic staff: short, plain, and about
// what each part is for. Steps point at `data-tour-id` markers in the pages; a step on a page the
// person can't open is dropped, and a step whose marker isn't on screen is skipped.
import type { UserRole } from '@/contexts/AuthContext';
import type { PageType } from '@/types';
import type { TourStep } from './runTour';

export interface WorkspaceTour {
  id: string;
  title: string;
  /** One line for the tours list. */
  summary: string;
  minutes: number;
  /** A page tour: offered the first time someone opens this page. */
  page?: PageType;
  /** Only for these roles (all roles when left out). */
  roles?: UserRole[];
  steps: Array<TourStep<PageType> & { roles?: UserRole[] }>;
}

const ADMINS: UserRole[] = ['super-admin', 'hospital-admin'];
const CLINICIANS: UserRole[] = ['super-admin', 'hospital-admin', 'doctor', 'nurse'];
const REGISTRARS: UserRole[] = ['super-admin', 'hospital-admin', 'doctor', 'nurse', 'receptionist'];
const DOCTORS: UserRole[] = ['super-admin', 'hospital-admin', 'doctor'];

export const WELCOME_TOUR_ID = 'welcome';

export const WORKSPACE_TOURS: WorkspaceTour[] = [
  {
    id: WELCOME_TOUR_ID,
    title: 'Getting started',
    summary: 'A quick look around: the menu, search, notifications, VitaMind AI and your account.',
    minutes: 2,
    steps: [
      { page: 'dashboard', title: 'Welcome to VitaLink', body: "Let's take two minutes to show you around. You can close this at any time and pick it up again from the question-mark button at the top of the screen." },
      { element: 'sidebar-nav', side: 'right', title: 'Your menu', body: "Every part of VitaLink you can use is listed here. You only see what your role needs. A padlock means it's included in a higher plan." },
      { element: 'sidebar-collapse', side: 'right', title: 'More room to work', body: 'Click this button on the edge of the menu to fold it away, and again to bring it back. Hover over it to see what it does.' },
      { element: 'sidebar-dashboard', side: 'right', title: 'Dashboard', body: "Your home screen: today's appointments, things that need someone's attention and shortcuts to common jobs." },
      { element: 'global-search', side: 'bottom', title: 'Find anything fast', body: "Search for a patient by name, phone number or VitaLink ID, or look up appointments and records, without leaving the page you're on." },
      { element: 'offline-status', side: 'bottom', title: 'Keeps working without internet', body: 'If the connection drops, keep working. Your changes are saved on this device and sent automatically when you are back online. Click here any time to see what is waiting to sync.' },
      { element: 'notifications', side: 'bottom', title: 'Notifications', body: 'Lab results, appointments, referrals and messages from your team arrive here. A red badge means something is new.' },
      { element: 'vitamind-button', side: 'bottom', title: 'VitaMind AI', body: "Your built-in assistant. Ask it a clinical question or how to do something in VitaLink. It helps you decide; it doesn't decide for you." },
      { element: 'sidebar-help', side: 'right', title: 'Help & Support', body: 'Stuck? Ask your workspace admins here; they can bring in the VitaLink team if needed. Quick how-tos are here too.' },
      { element: 'tour-button', side: 'bottom', title: 'Help whenever you need it', body: 'Click here to tour the page you are on, or to see every guided tour. The first time you open a page, we will offer you a short tour of it.' },
      { element: 'profile-menu', side: 'bottom', title: 'Your account', body: 'Change your profile, password, notifications and theme here, or sign out. Settings is also where you set up two-step sign-in with an authenticator app.' },
      { title: "You're all set", body: 'Next, try a tour of the page you use most, or "A patient visit, start to finish" to see how everything connects. Both are under the question-mark button.' },
    ],
  },
  {
    id: 'patient-journey',
    title: 'A patient visit, start to finish',
    summary: 'Follow one patient from registration to payment and see how the pages connect.',
    minutes: 3,
    roles: ['super-admin', 'hospital-admin', 'doctor', 'nurse', 'receptionist'],
    steps: [
      { page: 'dashboard', title: 'One visit, one record', body: 'Everything about a patient visit lands in a single record that every department can see. Let us follow one patient through VitaLink.' },
      { page: 'patients', element: 'patients-add', side: 'bottom', title: '1. Register the patient', body: 'New patients are added here. Each one gets a VitaLink ID that stays with them, even at other hospitals on VitaLink. Moving from paper or another system? Use Import for spreadsheets, EMR exports or photos of register pages. Already registered? Search for them instead. On paid plans, the last step sets up the patient’s VitaCard: they choose a PIN and you write or print their card.' },
      { page: 'appointments', element: 'appointments-new', side: 'bottom', title: '2. Book the visit', body: "Book a consultation with a doctor. It shows on the doctor's schedule and on everyone's dashboard." },
      { page: 'patients', element: 'patients-table', card: true, side: 'top', title: '3. Open their record', body: "Click a patient to open their medical record: history, vitals, clinical notes, lab results and documents, all in one place. On the Growth plan, VitaMind Scribe can listen to the consultation and draft the note for the doctor." },
      { page: 'laboratory', element: 'lab-new-order', side: 'bottom', title: '4. Order tests', body: "Lab requests go straight to the lab's queue. When results are ready, they are added to the patient's record." },
      { page: 'pharmacy', element: 'pharmacy-tabs', side: 'bottom', title: '5. Medication', body: "Prescriptions arrive at the pharmacy. The pharmacist checks stock and dispenses, and the stock count updates by itself." },
      { page: 'billing', element: 'billing-new-invoice', side: 'bottom', title: '6. Bill and get paid', body: "Visits, lab tests and dispensed drugs are added to the patient's bill automatically. Take cash, card or transfer payments and print a receipt with your hospital's name, or send the claim to the patient's HMO." },
      { title: "That's the whole visit", body: 'Each department sees the same up-to-date record, so nothing has to be re-typed or carried on paper.' },
    ],
  },

  // -------------------------------------------------------------------------
  // One short tour per page.

  {
    id: 'page:dashboard', page: 'dashboard', title: 'Dashboard', summary: 'What your home screen shows and how to use it each day.', minutes: 1,
    steps: [
      { title: 'Your dashboard', body: 'Your home screen updates as your team works, so it is a good place to start each day.' },
      { element: 'dashboard-quick-actions', card: true, title: 'Quick actions', body: 'Shortcuts to the jobs you do most, like registering a patient or booking an appointment.' },
      { element: 'dashboard-appointments', card: true, title: 'Upcoming appointments', body: "See who is coming in next and which doctor they're seeing." },
      { element: 'dashboard-attention', card: true, side: 'left', title: 'Needs attention', body: 'Things waiting on someone, from the lab, pharmacy and billing. Click an item to go straight to it.' },
    ],
  },
  {
    id: 'page:patients', page: 'patients', title: 'Patients', summary: 'Find, register, scan paper records, import and export patients.', minutes: 1,
    steps: [
      { title: 'Patient registry', body: 'Every patient registered at your facility is here.' },
      { element: 'patients-search', side: 'bottom', title: 'Search', body: 'Type a name, phone number or VitaLink ID. Use Advanced Filters to narrow by doctor, insurer, age and more.' },
      { element: 'patients-add', side: 'bottom', title: 'Add a patient', body: 'Register a new patient in a few short steps. They get a VitaLink ID straight away.' },
      { element: 'patients-scan', side: 'bottom', roles: REGISTRARS, title: 'VitaMind scan', body: 'For hard handwriting and whole patient cards: photograph up to 4 cards, forms or register pages and VitaMind AI reads them. Anything unclear is highlighted, and you check each patient before they are added. Included from the Growth plan; on Starter, use Import to read register photos on this device.' },
      { element: 'patients-import', side: 'bottom', title: 'Bring in existing patients', body: 'Moving from paper or another system? Import your list as it is: Excel or CSV from any EMR, FHIR or HL7 exports, or a photo of a register page. Columns are matched for you, ages become estimated birth dates, and you check everything before it is saved.' },
      { element: 'patients-export', side: 'bottom', title: 'Export', body: 'Download every patient matching your search and filters as CSV, Excel or a printable PDF. The columns import straight back into VitaLink.' },
      { element: 'patients-table', card: true, side: 'top', title: 'Open a record', body: "Click any patient to open their full medical record." },
    ],
  },
  {
    id: 'page:patient-identity', page: 'patient-identity', title: 'Health Identity', summary: 'Identify patients with a VitaCard, QR code or search.', minutes: 1,
    steps: [
      { title: 'Know who is in front of you', body: 'Use this page at the front desk to confirm who a patient is before you open their record.' },
      { element: 'identity-modes', side: 'bottom', title: 'Three ways to identify', body: 'Tap their VitaCard on the card reader, scan the QR code on the card, or search by name, phone or VitaLink ID.' },
      { element: 'identity-register', side: 'bottom', title: 'New patient?', body: 'If they are not in VitaLink yet, register them here and link a VitaCard.' },
    ],
  },
  {
    id: 'page:emr', page: 'emr', title: 'Medical records (EMR)', summary: 'Read and add to a patient’s record, with the consultation scribe.', minutes: 1, roles: [...CLINICIANS, 'lab-scientist', 'lab-technician'],
    steps: [
      { title: "The patient's record", body: 'Open a patient from the Patients page and their record appears here. Everything you add is saved to their timeline.' },
      { element: 'emr-patient', side: 'right', title: 'Who you are viewing', body: "The patient's name and VitaLink ID, so you always know whose record is open." },
      { element: 'emr-tabs', side: 'bottom', title: 'Sections of the record', body: 'Overview, clinical notes, lab results, documents and the full timeline. With consent, you can also see records from other hospitals and connected EMR systems.' },
      { element: 'emr-new-note', side: 'bottom', title: 'Write a clinical note', body: 'Record the consultation using the SOAP layout: what the patient says, what you find, your assessment and your plan. Every time a record is opened, it is noted in the audit log.' },
      { element: 'emr-new-note', side: 'bottom', roles: DOCTORS, title: 'Let VitaMind Scribe take the note', body: "In a new note, choose 'Listen to consultation'. With the patient's agreement, VitaMind listens, writes the note and picks out symptoms and things to consider. You check it, add your diagnosis and sign; VitaMind learns from the diagnoses you sign. Audio is not kept. Included from the Growth plan." },
      { element: 'emr-scribe', side: 'bottom', roles: DOCTORS, title: 'Start the scribe here', body: 'Tick that the patient agreed, then start listening. End the consultation when you are done and review the draft before using it.' },
    ],
  },
  {
    id: 'page:appointments', page: 'appointments', title: 'Appointments', summary: 'Book and manage appointments.', minutes: 1,
    steps: [
      { title: 'Appointments', body: "Your facility's schedule. Doctors see their own day; the front desk sees everyone's." },
      { element: 'appointments-new', side: 'bottom', title: 'Book an appointment', body: "Pick the patient, doctor, date and time. It appears on the doctor's schedule straight away." },
      { element: 'appointments-view', side: 'bottom', title: 'Calendar or list', body: 'Switch between a calendar view and a simple list.' },
      { element: 'appointments-filters', card: true, side: 'bottom', title: 'Filter the schedule', body: 'Show one doctor, one department or one status at a time.' },
    ],
  },
  {
    id: 'page:telemedicine', page: 'telemedicine', title: 'Telemedicine', summary: 'Video visits with patients and other doctors.', minutes: 1,
    steps: [
      { title: 'Care by video', body: 'See patients by video, or bring in a specialist to discuss a case.' },
      { element: 'telemedicine-modes', side: 'bottom', title: 'Two kinds of call', body: 'Patient Consultation is for video visits with patients. Specialist Conference is for doctor-to-doctor calls, with a colleague here or a specialist at another hospital on the VitaLink Network.' },
      { element: 'telemedicine-start', card: true, title: 'Start a video visit', body: 'Send the patient a link. They join from their phone or computer, with no app or account needed.' },
      { element: 'telemedicine-waiting', card: true, side: 'left', title: 'Waiting room', body: 'Patients who have joined their video visit wait here for you.' },
      { element: 'telemedicine-invite-from', side: 'bottom', title: 'Specialists from other hospitals', body: "Choose 'Another hospital' to pick a hospital from the network directory and one of its specialists. Write a short case note: they see that and the patient's name, age and sex, not your records. Invitations from other hospitals appear in your Conferences list." },
    ],
  },
  {
    id: 'page:ai-clinical-intelligence', page: 'ai-clinical-intelligence', title: 'AI Clinical Intelligence', summary: 'Diagnosis support, VitaMind AI and imaging reports.', minutes: 1,
    steps: [
      { title: 'Decision support', body: 'Tools that suggest likely diagnoses and point you to published research. They support your judgement; they never replace it.' },
      { element: 'ai-patient', side: 'bottom', title: 'Choose a patient first', body: "Pick a patient so the tools can use their age, history and local outbreak alerts." },
      { element: 'ai-tools', side: 'bottom', title: 'Four tools', body: "Symptom Diagnosis Engine ranks likely conditions from the symptoms you enter. VitaMind AI answers questions. History-Aware Analysis reviews the patient's past records. Imaging Reports helps you write up scans." },
    ],
  },
  {
    id: 'page:switch-network', page: 'switch-network', title: 'VitaLink Network', summary: 'Refer and transfer patients to other hospitals.', minutes: 1,
    steps: [
      { title: 'Hospitals working together', body: 'Find other hospitals on VitaLink, refer or transfer patients, and share their records when the patient agrees.' },
      { element: 'network-status', side: 'bottom', title: 'Your network status', body: 'Shows whether your facility is on the network and listed in the directory. Admins can change this in Network settings.' },
      { element: 'network-stats', side: 'bottom', title: 'At a glance', body: 'Referrals coming in, referrals you have sent, and what has been completed this month.' },
      { element: 'network-tabs', side: 'bottom', title: 'Directory and referrals', body: 'Search the directory to send a referral or request a transfer. Track and respond to them under Referrals & transfers. To discuss a case by video with a specialist elsewhere, invite them from Telemedicine.' },
    ],
  },
  {
    id: 'page:laboratory', page: 'laboratory', title: 'Laboratory', summary: 'Lab orders, results and test templates.', minutes: 1,
    steps: [
      { title: 'The lab', body: 'Doctors order tests here, and the lab team processes them and records results.' },
      { element: 'lab-new-order', side: 'bottom', title: 'New lab order', body: 'Choose the patient and tests. The order goes straight into the lab queue.' },
      { element: 'lab-tabs', side: 'bottom', title: 'Orders, results and templates', body: 'Lab Orders is the work queue. Results holds finished tests; abnormal values are flagged. Templates sets up the tests and normal ranges your lab uses.' },
    ],
  },
  {
    id: 'page:pharmacy', page: 'pharmacy', title: 'Pharmacy', summary: 'Stock, dispensing and purchase orders.', minutes: 1,
    steps: [
      { title: 'The pharmacy', body: 'Keep track of medicines, dispense prescriptions and reorder stock.' },
      { element: 'pharmacy-add-stock', side: 'bottom', title: 'Add stock', body: 'Record new deliveries with batch numbers and expiry dates.' },
      { element: 'pharmacy-dispense', side: 'bottom', title: 'Dispense', body: 'Give out a prescription. The stock count goes down automatically.' },
      { element: 'pharmacy-tabs', side: 'bottom', title: 'Three views', body: "Inventory shows what's on the shelf and what's running low. Dispensation is the history. Purchase Orders tracks what you've ordered from suppliers." },
      { element: 'pharmacy-export', side: 'bottom', title: 'Reports', body: 'Download the inventory with stock value, the dispensing log, or the expiry report (expired and expiring within 90 days) as CSV, Excel or a printable PDF.' },
    ],
  },
  {
    id: 'page:billing', page: 'billing', title: 'Billing', summary: 'Running bills, payments and receipts, HMO claims and prices.', minutes: 1,
    steps: [
      { title: 'Billing & insurance', body: "Visits, lab tests and dispensed drugs are added to each patient's running bill by themselves. Take payment, print receipts and claim from HMOs here." },
      { element: 'billing-new-invoice', side: 'bottom', title: 'New invoice', body: 'For anything billed outside a visit. Pick the patient and add services from your price list.' },
      { title: 'Your price list', body: 'Under Prices, use “Import price list” to bring in your tariff sheet as it is (Excel or CSV, any layout). Amounts like ₦5,000 or 12.5k are read correctly, and each item is sorted into consultation, lab, imaging and so on.' },
      { element: 'billing-tabs', side: 'bottom', title: 'Five sections', body: "Open bills fill up live as the patient is seen; take a deposit or payment and finalize when they leave. All invoices lists every bill. Payments shows what was received, with a Print button for a receipt headed with your hospital's name. HMO Claims follows up insurers. Price List sets your prices." },
    ],
  },
  {
    id: 'page:analytics', page: 'analytics', title: 'Analytics', summary: 'How your facility is doing.', minutes: 1,
    steps: [
      { title: 'How you are doing', body: 'Figures from your own records: patients, appointments, revenue, lab and pharmacy.' },
      { element: 'analytics-range', side: 'bottom', title: 'Pick a period', body: 'Look at the last day, week, month or quarter. Every figure is compared with the period before.' },
      { element: 'analytics-cards', side: 'bottom', title: 'Key numbers', body: 'The headline figures and whether they went up or down.' },
      { element: 'analytics-export', side: 'bottom', title: 'Take it with you', body: 'Download the figures as a spreadsheet for reports or board meetings.' },
    ],
  },
  {
    id: 'page:human-resources', page: 'human-resources', title: 'Staff', summary: 'Invite your team and manage their roles.', minutes: 1,
    steps: [
      { title: 'Your team', body: 'Everyone who works in this workspace, and what each person can do.' },
      { element: 'staff-invite', side: 'bottom', roles: ADMINS, title: 'Invite staff', body: "Send an invitation by email. Their role (doctor, nurse, pharmacist...) decides which pages they can see." },
      { element: 'staff-tabs', side: 'bottom', title: 'Directory and invitations', body: 'See everyone on the team, and invitations that have not been accepted yet. If someone loses the phone they use for two-step sign-in, an admin can reset it from their row.' },
    ],
  },
  {
    id: 'page:administration', page: 'administration', title: 'Administration', summary: 'Departments, facility settings and connected EMRs.', minutes: 1,
    steps: [
      { title: 'Running the facility', body: 'Set up how your facility is organised.' },
      { element: 'admin-add-department', side: 'bottom', title: 'Departments', body: 'Create departments and place staff in them. Appointments and reports can then be grouped by department.' },
      { element: 'admin-tabs', side: 'bottom', title: 'Settings and connected EMRs', body: 'Facility Settings holds your details and public health data sharing. Connected EMRs brings in records from another EMR system you already use.' },
    ],
  },
  {
    id: 'page:nfc-cards', page: 'nfc-cards', title: 'VitaCards', summary: 'Set up patient cards and order more.', minutes: 1,
    steps: [
      { title: 'VitaCards', body: "Contactless patient cards. Tapping one on any phone opens the patient's emergency profile, and their PIN opens their full record. No app needed." },
      { element: 'vitacards-cards', side: 'bottom', title: 'Set up a patient’s card', body: 'Find the patient, let them choose a 4–6 digit PIN, then write the link onto their card or print it as a QR code. Reset a forgotten PIN or switch off a lost card here too.' },
      { element: 'vitacards-order', side: 'bottom', title: 'Order cards', body: 'Order blank VitaCards in packs, choose delivery, and track each order to your door.' },
    ],
  },
  {
    id: 'page:subscription', page: 'subscription', title: 'Subscription', summary: 'Your plan and what it includes.', minutes: 1, roles: ADMINS,
    steps: [
      { element: 'subscription-current', side: 'bottom', title: 'Your current plan', body: 'Your plan and how much of it you have used this month.' },
      { element: 'subscription-plans', side: 'top', title: 'Change plan', body: 'Compare plans and upgrade when you need more pages or more users.' },
    ],
  },
  {
    id: 'page:audit-logs', page: 'audit-logs', title: 'Security', summary: 'Who did what, active sessions and security rules.', minutes: 1,
    steps: [
      { title: 'Security & audit', body: 'Every change in the workspace is recorded: who made it, when and from where.' },
      { element: 'audit-tabs', side: 'bottom', title: 'Three sections', body: 'Audit Log lists every action, including each time a patient record is opened. Sessions shows who is signed in and lets you sign a device out. Security Policy sets password and idle-timeout rules.' },
    ],
  },
  {
    id: 'page:settings', page: 'settings', title: 'Settings', summary: 'Your profile, two-step sign-in, theme and notifications.', minutes: 1,
    steps: [
      { element: 'settings-tabs', side: 'right', title: 'Your settings', body: 'Update your profile, change your password or sign-in method, pick light or dark mode, and choose which notifications you get.' },
      { element: 'settings-tabs', side: 'right', title: 'Two-step sign-in', body: 'Under Sign-in & security, set up an authenticator app (such as Google Authenticator). It is optional but strongly recommended, and a reminder shows at the top of the app until it is on. A browser you use regularly is remembered, so you are only asked for a code after 14 days away; you can forget a device there too.' },
    ],
  },
];

export const tourById = (id: string) => WORKSPACE_TOURS.find((tour) => tour.id === id);
export const pageTourId = (page: PageType) => `page:${page}`;
