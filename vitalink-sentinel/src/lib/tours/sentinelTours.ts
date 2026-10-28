// Guided tours for VitaLink Sentinel, written for surveillance officers and field staff rather
// than developers. Steps point at `data-tour-id` markers; ones not on screen are skipped.
import type { SentinelMe } from '@/lib/supabase/sentinel';
import type { SentinelRoute } from '@/store/useSentinelStore';
import type { TourStep } from './runTour';

type Role = SentinelMe['role'];

export interface SentinelTour {
  id: string;
  title: string;
  summary: string;
  minutes: number;
  /** A page tour: offered the first time someone opens this page. */
  route?: SentinelRoute;
  steps: Array<TourStep<SentinelRoute> & { roles?: Role[] }>;
}

const REPORTERS: Role[] = ['admin', 'officer', 'field_worker'];
const DECLARERS: Role[] = ['admin', 'officer'];

export const SENTINEL_WELCOME_ID = 'sentinel:welcome';
export const sentinelPageTourId = (route: SentinelRoute) => `sentinel:page:${route}`;

export const SENTINEL_TOURS: SentinelTour[] = [
  {
    id: SENTINEL_WELCOME_ID,
    title: 'Getting started',
    summary: 'Find your way around Sentinel in two minutes.',
    minutes: 2,
    steps: [
      { page: 'dashboard', title: 'Welcome to Sentinel', body: 'Sentinel helps you spot outbreaks early and respond together. Here is a quick look around. You can close this at any time and replay it from the question-mark button.' },
      { element: 'top-nav', side: 'bottom', title: 'Main sections', body: 'The places you will use every day: dashboard, outbreaks, cases, alerts, heatmaps, facilities and reports.' },
      { element: 'rail', side: 'right', title: 'More tools', body: 'Contact tracing, epidemiology, the disease registry, NTD programmes, vaccination, emergency response and community reports. Hover over an icon to see its name.' },
      { element: 'rail-report', side: 'right', roles: REPORTERS, title: 'Report a case quickly', body: 'Use this plus button to report a new case from anywhere in Sentinel.' },
      { element: 'search', side: 'bottom', title: 'Search everything', body: 'Find a case by its ID, an outbreak, an alert, a facility or a disease. You can also press Ctrl + K.' },
      { element: 'inbox', side: 'bottom', title: 'Activity', body: 'New case reports, outbreak updates and facility responses from your team and partner hospitals since you last looked.' },
      { element: 'alerts-bell', side: 'bottom', title: 'Alerts', body: 'Open alerts, live. Urgent ones also pop up wherever you are, and you can acknowledge them from here.' },
      { element: 'profile', side: 'bottom', title: 'Your account', body: 'Your role, your organisation, settings, dark mode and sign out.' },
      { element: 'tour-button', side: 'bottom', title: 'Tours on every page', body: 'Click here to tour the page you are on, or to see every tour. The first time you open a page, we will offer you a short tour of it.' },
      { title: "You're ready", body: 'Start with the dashboard each day: it shows what has changed and what needs a response.' },
    ],
  },
  {
    id: sentinelPageTourId('dashboard'), route: 'dashboard', title: 'Dashboard', summary: 'The national picture at a glance.', minutes: 1,
    steps: [
      { element: 'dashboard-period', side: 'bottom', title: 'Choose a period', body: 'Look at the last 7, 30 or 90 days. Every figure is compared with the period before.' },
      { element: 'dashboard-trends', card: true, title: 'Case trends', body: 'Daily cases for the diseases with the most reports, so you can see what is rising.' },
      { element: 'dashboard-status', card: true, side: 'left', title: 'Are facilities reporting?', body: 'Which sharing facilities have reported recently, which are late and which have gone quiet.' },
      { element: 'dashboard-outbreaks', card: true, title: 'Active outbreaks', body: 'Outbreaks your team has declared and is responding to.' },
      { element: 'dashboard-alerts', card: true, side: 'left', title: 'Alert feed', body: 'The newest open alerts. Click one to deal with it.' },
      { element: 'dashboard-risk', card: true, title: 'Risk by state', body: 'Where activity is highest across Nigeria right now.' },
    ],
  },
  {
    id: sentinelPageTourId('cases'), route: 'cases', title: 'Cases', summary: 'Report, find and update cases.', minutes: 1,
    steps: [
      { title: 'The case registry', body: 'Every case reported to your organisation, from linked hospitals, partner systems and your own team. Patient names are never shared with Sentinel.' },
      { element: 'cases-report', side: 'bottom', roles: REPORTERS, title: 'Report a case', body: 'Choose the disease, where it happened, age group, sex and status. Cases that match an open outbreak can be linked to it.' },
      { element: 'cases-filters', side: 'bottom', title: 'Find cases', body: 'Search by case ID, disease, state or LGA, and filter by disease, status, source and date.' },
      { element: 'cases-table', side: 'top', title: 'Open a case', body: 'Click a case to update its status, record a lab confirmation, start contact tracing or add a note. Every change is kept in its history.' },
    ],
  },
  {
    id: sentinelPageTourId('outbreaks'), route: 'outbreaks', title: 'Outbreaks', summary: 'Declare and manage outbreaks.', minutes: 1,
    steps: [
      { title: 'Outbreaks', body: 'Track each outbreak from declaration to closure: its cases, deaths, severity and the response.' },
      { element: 'outbreaks-signals', card: true, title: 'Possible outbreaks', body: 'Sentinel flags diseases rising faster than usual in an area. Review them and declare an outbreak if needed.' },
      { element: 'outbreaks-declare', side: 'bottom', roles: DECLARERS, title: 'Declare an outbreak', body: 'Choose the disease and location. Matching cases can be linked automatically, and the figures update as new cases arrive.' },
    ],
  },
  {
    id: sentinelPageTourId('alerts'), route: 'alerts', title: 'Alerts', summary: 'Respond to and issue alerts.', minutes: 1,
    steps: [
      { title: 'Alerts', body: 'Sentinel raises alerts from new cases, outbreaks and facilities that stop reporting. Your team can also issue its own.' },
      { element: 'alerts-status', side: 'bottom', title: 'Open, acknowledged, resolved', body: 'Acknowledge an alert when someone is on it, and resolve it when it is dealt with. Add a note so others know what was done.' },
      { element: 'alerts-issue', side: 'bottom', roles: REPORTERS, title: 'Issue an alert', body: 'Send a bulletin or warning to everyone in your organisation.' },
    ],
  },
  {
    id: sentinelPageTourId('facilities'), route: 'facilities', title: 'Facilities', summary: 'Where your data comes from.', minutes: 1,
    steps: [
      { element: 'facilities-tabs', side: 'bottom', title: 'Your reporting network', body: 'Hospitals on VitaLink that share with you, sites that report directly, data requests, and partner systems that send data automatically.' },
      { element: 'facilities-table', side: 'top', title: 'Who is reporting', body: 'Each facility, how it connects, when it last reported and how many cases it has sent.' },
      { element: 'facilities-add', side: 'bottom', roles: REPORTERS, title: 'Add a reporting site', body: 'Add a clinic, lab or community site that reports to you directly.' },
    ],
  },
  {
    id: sentinelPageTourId('reports'), route: 'reports', title: 'Reports', summary: 'Weekly and custom surveillance reports.', minutes: 1,
    steps: [
      { element: 'reports-kinds', side: 'bottom', title: 'Pick a report', body: 'Weekly epidemiological report, disease trends, NTDs, outbreaks, or your own date range. They are built from your live data.' },
      { element: 'reports-export', side: 'bottom', title: 'Share it', body: 'Save the report as a PDF to send to partners, or export the figures as a spreadsheet.' },
    ],
  },
];
