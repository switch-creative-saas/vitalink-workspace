// Renders the console section for the current /console/<section>/<id> route.
import { FulfilmentPanel } from '@/components/nfc/LiveNfcOrders';
import { ConsoleInbox } from './ConsoleInbox';
import { ConsoleSettings, NotificationsFeed } from './ConsoleNotifications';
import {
  AdminsTab, LogTab, OverviewTab, PaymentsTab, WorkspacePanel, WorkspacesTab, type ConsoleSection,
} from './ConsoleSections';

export type ConsoleRoute = { section: ConsoleSection; id: string | null };

export function ConsoleBody({ route, go, email, admins, onFeedRead }: {
  route: ConsoleRoute;
  go: (route: ConsoleRoute) => void;
  email: string;
  admins: string[];
  onFeedRead: () => void;
}) {
  const openWorkspace = (id: string) => go({ section: 'workspaces', id });
  const openTicket = (id: string | null) => go({ section: 'inbox', id });

  switch (route.section) {
    case 'inbox':
      return <ConsoleInbox ticketId={route.id} onOpenTicket={openTicket} onOpenWorkspace={openWorkspace} admins={admins} myEmail={email} />;
    case 'notifications':
      return <NotificationsFeed onOpenWorkspace={openWorkspace} onOpenTicket={openTicket} onRead={onFeedRead} />;
    case 'workspaces':
      return route.id
        ? <WorkspacePanel key={route.id} id={route.id} onBack={() => go({ section: 'workspaces', id: null })} onOpenTicket={openTicket} />
        : <WorkspacesTab onOpen={openWorkspace} />;
    case 'payments':
      return <PaymentsTab onOpen={openWorkspace} />;
    case 'orders':
      return <FulfilmentPanel onChanged={() => undefined} />;
    case 'admins':
      return <AdminsTab />;
    case 'log':
      return <LogTab onOpen={openWorkspace} />;
    case 'settings':
      return <ConsoleSettings />;
    default:
      return <OverviewTab onOpenTab={(section) => go({ section, id: null })} />;
  }
}
