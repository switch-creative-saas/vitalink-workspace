import { useState, useRef, useEffect } from 'react';
import { Bell, X, CheckCircle, Clock, AlertTriangle, CreditCard, UserPlus, FlaskConical, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';

interface Notification {
  id: string;
  type: 'appointment' | 'lab' | 'ai' | 'payment' | 'staff' | 'system';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  route?: string;
  priority: 'low' | 'medium' | 'high';
}

const mockNotifications: Notification[] = [
  {
    id: 'N-001',
    type: 'appointment',
    title: 'New Appointment Booked',
    message: 'Chioma Okonkwo booked a follow-up for tomorrow at 09:00 AM',
    timestamp: '2026-02-23T14:32:00Z',
    read: false,
    route: '/appointments',
    priority: 'medium'
  },
  {
    id: 'N-002',
    type: 'lab',
    title: 'Lab Result Ready',
    message: 'HbA1c results for Adebayo Johnson are now available',
    timestamp: '2026-02-23T13:45:00Z',
    read: false,
    route: '/laboratory',
    priority: 'high'
  },
  {
    id: 'N-003',
    type: 'ai',
    title: 'VitaMind AI Alert',
    message: 'Abnormal glucose pattern detected in 3 patients this week',
    timestamp: '2026-02-23T12:20:00Z',
    read: false,
    route: '/analytics',
    priority: 'high'
  },
  {
    id: 'N-004',
    type: 'payment',
    title: 'Payment Failed',
    message: 'Invoice #VLI-2026-002 payment attempt failed for Chioma Okonkwo',
    timestamp: '2026-02-23T11:15:00Z',
    read: true,
    route: '/billing',
    priority: 'medium'
  },
  {
    id: 'N-005',
    type: 'staff',
    title: 'Staff Invite Accepted',
    message: 'Dr. Michael Chen accepted the invitation and completed onboarding',
    timestamp: '2026-02-23T10:30:00Z',
    read: true,
    route: '/human-resources',
    priority: 'low'
  },
  {
    id: 'N-006',
    type: 'appointment',
    title: 'Appointment Cancelled',
    message: 'Emmanuel Adeyemi cancelled his consultation for today',
    timestamp: '2026-02-23T09:45:00Z',
    read: true,
    route: '/appointments',
    priority: 'medium'
  }
];

const typeConfig = {
  appointment: { icon: Clock, color: 'bg-blue-100 text-blue-600', border: 'border-blue-200' },
  lab: { icon: FlaskConical, color: 'bg-purple-100 text-purple-600', border: 'border-purple-200' },
  ai: { icon: AlertTriangle, color: 'bg-amber-100 text-amber-600', border: 'border-amber-200' },
  payment: { icon: CreditCard, color: 'bg-red-100 text-red-600', border: 'border-red-200' },
  staff: { icon: UserPlus, color: 'bg-green-100 text-green-600', border: 'border-green-200' },
  system: { icon: CheckCircle, color: 'bg-gray-100 text-gray-600', border: 'border-gray-200' },
};

function formatTimeAgo(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

export function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState(mockNotifications);
  const panelRef = useRef<HTMLDivElement>(null);
  const { canAccessPage } = useAuth();

  const unreadCount = notifications.filter(n => !n.read).length;

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    document.body.dataset.overlayOpen = isOpen ? 'true' : 'false';
    return () => {
      document.body.dataset.overlayOpen = 'false';
    };
  }, [isOpen]);

  useEffect(() => {
    const onNotify = (event: Event) => {
      const detail = (event as CustomEvent<{ module?: string; type?: string; message?: string }>).detail;
      if (!detail?.message) return;
      const type: Notification['type'] =
        detail.module === 'lab'
          ? 'lab'
          : detail.module === 'billing'
            ? 'payment'
            : detail.module === 'support'
              ? 'system'
              : detail.module === 'auth'
                ? 'staff'
                : 'system';
      const message = detail.message;
      const priority: Notification['priority'] = /critical|failed|unauthorized|threat/i.test(message) ? 'high' : 'medium';
      setNotifications((prev) => [
        {
          id: `N-${Date.now()}`,
          type,
          title: `${(detail.module ?? 'system').toUpperCase()} Alert`,
          message,
          timestamp: new Date().toISOString(),
          read: false,
          priority,
        },
        ...prev,
      ].slice(0, 30));
    };
    window.addEventListener('vitalink:notify', onNotify as EventListener);
    return () => window.removeEventListener('vitalink:notify', onNotify as EventListener);
  }, []);

  const markAsRead = (id: string) => {
    setNotifications(prev =>
      prev.map(n => n.id === id ? { ...n, read: true } : n)
    );
  };

  const markAllAsRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const handleNotificationClick = (notification: Notification) => {
    markAsRead(notification.id);
    setIsOpen(false);
    if (notification.route) {
      console.log('Navigate to:', notification.route);
    }
  };

  const filteredNotifications = notifications.filter(n => {
    if (n.route && !canAccessPage(n.route.replace('/', ''))) return false;
    return true;
  });

  return (
    <div ref={panelRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "relative p-2.5 rounded-xl transition-all duration-200",
          isOpen 
            ? "bg-[#1E4ED8]/10 text-[#1E4ED8]" 
            : "text-gray-500 hover:bg-gray-100 hover:text-gray-700"
        )}
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center animate-pulse">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Notification Panel */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-3 w-[min(100vw-2rem,24rem)] max-w-sm bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-gray-100/50 overflow-hidden z-50 animate-in slide-in-from-top-2 duration-200">
          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-gray-900">Notifications</h3>
              <p className="text-xs text-gray-500">{unreadCount} unread</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={markAllAsRead}
                className="text-xs text-[#1E4ED8] hover:text-[#1E4ED8]/80 font-medium px-2 py-1 rounded-lg hover:bg-[#1E4ED8]/5 transition-colors"
              >
                Mark all read
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Notification List */}
          <div className="max-h-[400px] overflow-y-auto">
            {filteredNotifications.length === 0 ? (
              <div className="p-8 text-center">
                <Bell className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-500">No notifications</p>
              </div>
            ) : (
              filteredNotifications.map((notification) => {
                const config = typeConfig[notification.type];
                const Icon = config.icon;
                
                return (
                  <button
                    key={notification.id}
                    onClick={() => handleNotificationClick(notification)}
                    className={cn(
                      "w-full px-4 py-3 flex items-start gap-3 text-left transition-all duration-150 border-l-3",
                      !notification.read 
                        ? "bg-[#1E4ED8]/[0.02] border-l-[#1E4ED8]" 
                        : "border-l-transparent hover:bg-gray-50",
                      notification.priority === 'high' && !notification.read && "bg-red-50/[0.3]"
                    )}
                  >
                    <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5", config.color)}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className={cn("text-sm font-medium truncate min-w-0", !notification.read ? "text-gray-900" : "text-gray-600")}>
                          {notification.title}
                        </p>
                        {!notification.read && (
                          <span className="w-2 h-2 bg-[#1E4ED8] rounded-full flex-shrink-0" />
                        )}
                      </div>
                      <p className="text-xs text-gray-500 line-clamp-2">{notification.message}</p>
                      <p className="text-[10px] text-gray-400 mt-1">{formatTimeAgo(notification.timestamp)}</p>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2 border-t border-gray-100 bg-gray-50/50">
            <button className="w-full text-xs text-[#1E4ED8] font-medium flex items-center justify-center gap-1 py-1.5 hover:bg-[#1E4ED8]/5 rounded-lg transition-colors">
              View all notifications
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
