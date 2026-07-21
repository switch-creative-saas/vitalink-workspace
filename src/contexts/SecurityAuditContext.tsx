import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';

export type AuditAction = 'VIEW' | 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'EXPORT' | 'LOGOUT' | 'UNAUTHORIZED' | 'FLAG';
export type RiskLevel = 'low' | 'medium' | 'high';
export type AuditStatus = 'success' | 'failed';
export type TwoFactorMethod = 'email-otp' | 'authenticator-app';

export interface AuditLogEntry {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  role: string;
  action: AuditAction;
  resource: string;
  resourceId: string;
  module: string;
  timestamp: string;
  device: string;
  browser: string;
  location: string;
  ipAddress: string;
  riskLevel: RiskLevel;
  status: AuditStatus;
  details?: string;
  flagged?: boolean;
}

export interface ActiveSession {
  id: string;
  userEmail: string;
  userName: string;
  role: string;
  device: string;
  location: string;
  ipAddress: string;
  loginTime: string;
  lastActivity: string;
  isCurrent: boolean;
  suspicious: boolean;
  trustedDevice: boolean;
}

export interface SecurityPolicies {
  passwordMinLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requireSpecialChars: boolean;
  passwordExpiryDays: number;
  loginAttemptLimit: number;
  captchaAfterFailedAttempts: boolean;
  twoFactorEnabled: boolean;
  enforceTwoFactorRoles: string[];
  allowedTwoFactorMethods: TwoFactorMethod[];
  sessionTimeoutMinutes: number;
  deviceTrustEnabled: boolean;
}

interface SecurityAuditContextType {
  logs: AuditLogEntry[];
  sessions: ActiveSession[];
  policies: SecurityPolicies;
  logAction: (entry: Omit<AuditLogEntry, 'id' | 'timestamp' | 'device' | 'browser' | 'location' | 'ipAddress' | 'riskLevel'> & { riskLevel?: RiskLevel }) => void;
  logLoginAttempt: (status: AuditStatus, details?: string) => void;
  flagLog: (id: string) => void;
  exportLogs: (rows: AuditLogEntry[], format: 'csv' | 'pdf') => void;
  terminateSession: (sessionId: string) => void;
  terminateAllSessions: () => void;
  updatePolicy: <K extends keyof SecurityPolicies>(key: K, value: SecurityPolicies[K]) => void;
}

const SecurityAuditContext = createContext<SecurityAuditContextType | null>(null);

const logsKey = 'vitalink-security-audit-logs';
const sessionsKey = 'vitalink-security-sessions';
const policiesKey = 'vitalink-security-policies';

const defaultPolicies: SecurityPolicies = {
  passwordMinLength: 10,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: true,
  passwordExpiryDays: 90,
  loginAttemptLimit: 5,
  captchaAfterFailedAttempts: true,
  twoFactorEnabled: true,
  enforceTwoFactorRoles: ['super-admin', 'hospital-admin', 'doctor'],
  allowedTwoFactorMethods: ['email-otp', 'authenticator-app'],
  sessionTimeoutMinutes: 30,
  deviceTrustEnabled: true,
};

function userAgentDevice() {
  const ua = navigator.userAgent;
  const browser = /Chrome/i.test(ua) ? 'Chrome' : /Firefox/i.test(ua) ? 'Firefox' : /Safari/i.test(ua) ? 'Safari' : 'Browser';
  const device = /Mobile/i.test(ua) ? 'Mobile' : /Tablet|iPad/i.test(ua) ? 'Tablet' : 'Desktop';
  return { browser, device };
}

function pseudoLocationFromIp(ipAddress: string) {
  const octet = Number(ipAddress.split('.').at(-1) ?? '0');
  if (octet % 3 === 0) return 'Lagos, Nigeria';
  if (octet % 3 === 1) return 'Abuja, Nigeria';
  return 'Kano, Nigeria';
}

function randomIp() {
  return `102.89.47.${Math.floor(Math.random() * 190) + 10}`;
}

function riskFor(action: AuditAction, status: AuditStatus): RiskLevel {
  if (status === 'failed') return 'high';
  if (action === 'DELETE' || action === 'UNAUTHORIZED' || action === 'EXPORT') return 'medium';
  return 'low';
}

export function SecurityAuditProvider({ children }: { children: ReactNode }) {
  const { currentRole, userName, userEmail } = useAuth();
  const [logs, setLogs] = useState<AuditLogEntry[]>(() => {
    const saved = localStorage.getItem(logsKey);
    if (saved) return JSON.parse(saved) as AuditLogEntry[];
    return [];
  });
  const [sessions, setSessions] = useState<ActiveSession[]>(() => {
    const saved = localStorage.getItem(sessionsKey);
    if (saved) return JSON.parse(saved) as ActiveSession[];
    return [];
  });
  const [policies, setPolicies] = useState<SecurityPolicies>(() => {
    const saved = localStorage.getItem(policiesKey);
    if (saved) return JSON.parse(saved) as SecurityPolicies;
    return defaultPolicies;
  });

  useEffect(() => {
    localStorage.setItem(logsKey, JSON.stringify(logs.slice(0, 1500)));
  }, [logs]);

  useEffect(() => {
    localStorage.setItem(sessionsKey, JSON.stringify(sessions));
  }, [sessions]);

  useEffect(() => {
    localStorage.setItem(policiesKey, JSON.stringify(policies));
  }, [policies]);

  useEffect(() => {
    if (!userEmail) return;
    setSessions((prev) => {
      const existingCurrent = prev.find((entry) => entry.userEmail === userEmail && entry.isCurrent);
      if (existingCurrent) {
        return prev.map((entry) => (entry.id === existingCurrent.id ? { ...entry, lastActivity: new Date().toISOString() } : entry));
      }
      const ipAddress = randomIp();
      const session: ActiveSession = {
        id: `sess-${Date.now()}`,
        userEmail,
        userName,
        role: currentRole,
        device: `${userAgentDevice().device} - ${userAgentDevice().browser}`,
        location: pseudoLocationFromIp(ipAddress),
        ipAddress,
        loginTime: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        isCurrent: true,
        suspicious: false,
        trustedDevice: true,
      };
      return [session, ...prev.map((entry) => ({ ...entry, isCurrent: false }))].slice(0, 25);
    });
  }, [userEmail, userName, currentRole]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSessions((prev) => {
        const now = Date.now();
        const keep = prev.filter((entry) => now - new Date(entry.lastActivity).getTime() < policies.sessionTimeoutMinutes * 60_000);
        return keep;
      });
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [policies.sessionTimeoutMinutes]);

  const logAction: SecurityAuditContextType['logAction'] = (entry) => {
    const { browser, device } = userAgentDevice();
    const ipAddress = randomIp();
    const record: AuditLogEntry = {
      id: `audit-${Date.now()}-${Math.floor(Math.random() * 9999)}`,
      timestamp: new Date().toISOString(),
      browser,
      device,
      ipAddress,
      location: pseudoLocationFromIp(ipAddress),
      riskLevel: entry.riskLevel ?? riskFor(entry.action, entry.status),
      ...entry,
    };
    setLogs((prev) => [record, ...prev].slice(0, 1500));
  };

  const logLoginAttempt: SecurityAuditContextType['logLoginAttempt'] = (status, details) => {
    logAction({
      userId: userEmail || 'unknown',
      userName: userName || 'Unknown',
      userEmail: userEmail || 'unknown@vitalink.africa',
      role: currentRole,
      action: 'LOGIN',
      resource: 'System Authentication',
      resourceId: 'auth-gateway',
      module: 'Authentication',
      status,
      details,
    });
  };

  useEffect(() => {
    const onNotify = (event: Event) => {
      const detail = (event as CustomEvent<{ module?: string; type?: string; message?: string }>).detail;
      if (!detail?.module) return;
      const module = detail.module.toUpperCase();
      let action: AuditAction = 'VIEW';
      let resource = 'Module Event';
      const type = detail.type ?? 'event';
      if (/create|created|new/.test(type)) action = 'CREATE';
      if (/update|updated|changed|completed/.test(type)) action = 'UPDATE';
      if (/delete|removed|cancel/.test(type)) action = 'DELETE';
      if (/export/.test(type)) action = 'EXPORT';
      if (/login/.test(type)) action = 'LOGIN';
      if (/ticket|invoice/.test(type)) resource = 'Business Record';
      if (/diagnostic|security|audit/.test(type)) resource = 'Security Control';
      logAction({
        userId: userEmail,
        userName,
        userEmail,
        role: currentRole,
        action,
        resource,
        resourceId: type,
        module,
        status: 'success',
        details: detail.message,
      });
    };
    window.addEventListener('vitalink:notify', onNotify as EventListener);
    return () => window.removeEventListener('vitalink:notify', onNotify as EventListener);
  }, [currentRole, userEmail, userName]);

  useEffect(() => {
    const onNavigate = (event: Event) => {
      const detail = (event as CustomEvent<{ switchId?: string; page?: string }>).detail;
      if (detail?.switchId) {
        logAction({
          userId: userEmail,
          userName,
          userEmail,
          role: currentRole,
          action: 'VIEW',
          resource: 'Patient Record',
          resourceId: detail.switchId,
          module: 'EMR',
          status: 'success',
          details: 'Patient chart accessed via navigation event',
        });
      }
    };
    window.addEventListener('app:navigate', onNavigate as EventListener);
    return () => window.removeEventListener('app:navigate', onNavigate as EventListener);
  }, [currentRole, userEmail, userName]);

  useEffect(() => {
    const failedAttempts = logs.filter((entry) => entry.action === 'LOGIN' && entry.status === 'failed' && Date.now() - new Date(entry.timestamp).getTime() < 10 * 60_000);
    if (failedAttempts.length >= 3) {
      window.dispatchEvent(
        new CustomEvent('vitalink:notify', {
          detail: {
            module: 'security',
            type: 'threat-failed-logins',
            message: 'Multiple failed login attempts detected',
          },
        }),
      );
    }
    const patientViews = logs.filter((entry) => entry.resource === 'Patient Record' && entry.action === 'VIEW' && Date.now() - new Date(entry.timestamp).getTime() < 5 * 60_000);
    if (patientViews.length >= 8) {
      window.dispatchEvent(
        new CustomEvent('vitalink:notify', {
          detail: {
            module: 'security',
            type: 'threat-mass-patient-access',
            message: 'Unusual patient record access pattern detected',
          },
        }),
      );
    }
  }, [logs]);

  const flagLog = (id: string) => {
    setLogs((prev) => prev.map((entry) => (entry.id === id ? { ...entry, flagged: true, riskLevel: 'high' } : entry)));
    window.dispatchEvent(new CustomEvent('vitalink:notify', { detail: { module: 'security', type: 'manual-flag', message: 'Audit event flagged as suspicious' } }));
  };

  const exportLogs: SecurityAuditContextType['exportLogs'] = (rows, format) => {
    if (format === 'pdf') {
      window.print();
      return;
    }
    const header = ['timestamp', 'user', 'role', 'action', 'resource', 'module', 'risk', 'status', 'device', 'browser', 'location', 'ipAddress', 'details'];
    const lines = rows.map((entry) =>
      [
        entry.timestamp,
        entry.userName,
        entry.role,
        entry.action,
        entry.resource,
        entry.module,
        entry.riskLevel,
        entry.status,
        entry.device,
        entry.browser,
        entry.location,
        entry.ipAddress,
        entry.details ?? '',
      ]
        .map((value) => `"${String(value).replaceAll('"', '""')}"`)
        .join(','),
    );
    const csv = [header.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `vitalink-security-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const terminateSession = (sessionId: string) => {
    setSessions((prev) => prev.filter((entry) => entry.id !== sessionId));
    logAction({
      userId: userEmail,
      userName,
      userEmail,
      role: currentRole,
      action: 'LOGOUT',
      resource: 'User Session',
      resourceId: sessionId,
      module: 'Security',
      status: 'success',
      details: 'Remote session terminated',
    });
  };

  const terminateAllSessions = () => {
    setSessions((prev) => prev.filter((entry) => entry.isCurrent));
    logAction({
      userId: userEmail,
      userName,
      userEmail,
      role: currentRole,
      action: 'LOGOUT',
      resource: 'User Sessions',
      resourceId: 'all-remote',
      module: 'Security',
      status: 'success',
      details: 'All remote sessions terminated',
    });
  };

  const updatePolicy = <K extends keyof SecurityPolicies>(key: K, value: SecurityPolicies[K]) => {
    setPolicies((prev) => ({ ...prev, [key]: value }));
    logAction({
      userId: userEmail,
      userName,
      userEmail,
      role: currentRole,
      action: 'UPDATE',
      resource: 'Security Policy',
      resourceId: String(key),
      module: 'Security',
      status: 'success',
      details: `Policy changed: ${String(key)}`,
    });
  };

  const value = useMemo<SecurityAuditContextType>(
    () => ({
      logs,
      sessions,
      policies,
      logAction,
      logLoginAttempt,
      flagLog,
      exportLogs,
      terminateSession,
      terminateAllSessions,
      updatePolicy,
    }),
    [logs, sessions, policies],
  );

  return <SecurityAuditContext.Provider value={value}>{children}</SecurityAuditContext.Provider>;
}

export function useSecurityAudit() {
  const context = useContext(SecurityAuditContext);
  if (!context) throw new Error('useSecurityAudit must be used within SecurityAuditProvider');
  return context;
}
