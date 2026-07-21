import { useMemo, useState } from 'react';
import { AlertTriangle, Calendar, CheckCircle, Clock, Download, Eye, Globe, History, LogOut, Monitor, RefreshCw, Search, Shield, UserX, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useSecurityAudit, type AuditLogEntry } from '@/contexts/SecurityAuditContext';
import { toast } from 'sonner';

const getActionColor = (action: string) => {
  if (action === 'DELETE' || action === 'UNAUTHORIZED') return 'bg-red-500/10 text-red-600 border-red-200';
  if (action === 'CREATE') return 'bg-green-500/10 text-green-600 border-green-200';
  if (action === 'UPDATE') return 'bg-amber-500/10 text-amber-600 border-amber-200';
  if (action === 'EXPORT') return 'bg-purple-500/10 text-purple-600 border-purple-200';
  if (action === 'LOGIN' || action === 'LOGOUT') return 'bg-slate-500/10 text-slate-600 border-slate-200';
  return 'bg-blue-500/10 text-blue-600 border-blue-200';
};

const getDeviceIcon = (device: string) => {
  if (/mobile/i.test(device)) return <Eye className="w-5 h-5" />;
  if (/tablet/i.test(device)) return <Eye className="w-5 h-5" />;
  return <Monitor className="w-5 h-5" />;
};

const formatDateTime = (isoString: string) => {
  const date = new Date(isoString);
  return {
    date: date.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }),
    time: date.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })
  };
};

export function AuditLogsPage() {
  const { currentRole, userEmail } = useAuth();
  const { subscription } = useSubscription();
  const { logs, sessions, policies, flagLog, exportLogs, terminateSession, terminateAllSessions, updatePolicy } = useSecurityAudit();
  const [selectedTab, setSelectedTab] = useState('logs');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterUser, setFilterUser] = useState('all');
  const [filterRole, setFilterRole] = useState('all');
  const [filterModule, setFilterModule] = useState('all');
  const [filterAction, setFilterAction] = useState('all');
  const [filterRisk, setFilterRisk] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedLog, setSelectedLog] = useState<AuditLogEntry | null>(null);
  const [showTerminateDialog, setShowTerminateDialog] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const canAdmin = currentRole === 'super-admin' || currentRole === 'hospital-admin' || currentRole === 'it-officer';
  const canSupport = currentRole === 'support-agent';
  const canConfigurePolicies = canAdmin;
  const proAccess = subscription.plan !== 'free';
  const enterpriseAccess = subscription.plan === 'enterprise';

  const baseVisibleLogs = useMemo(() => {
    if (canAdmin) return logs;
    if (canSupport) return logs.filter((entry) => entry.riskLevel !== 'high');
    return logs.filter((entry) => entry.userEmail === userEmail);
  }, [logs, canAdmin, canSupport, userEmail]);

  const filteredLogs = useMemo(
    () =>
      baseVisibleLogs.filter((entry) => {
        const text = `${entry.userName} ${entry.userEmail} ${entry.action} ${entry.resource} ${entry.module} ${entry.details ?? ''}`.toLowerCase();
        const searchMatch = !searchQuery || text.includes(searchQuery.toLowerCase());
        const userMatch = filterUser === 'all' || entry.userEmail === filterUser;
        const roleMatch = filterRole === 'all' || entry.role === filterRole;
        const moduleMatch = filterModule === 'all' || entry.module === filterModule;
        const actionMatch = filterAction === 'all' || entry.action === filterAction;
        const riskMatch = filterRisk === 'all' || entry.riskLevel === filterRisk;
        const day = entry.timestamp.slice(0, 10);
        const fromMatch = !dateFrom || day >= dateFrom;
        const toMatch = !dateTo || day <= dateTo;
        return searchMatch && userMatch && roleMatch && moduleMatch && actionMatch && riskMatch && fromMatch && toMatch;
      }),
    [baseVisibleLogs, searchQuery, filterUser, filterRole, filterModule, filterAction, filterRisk, dateFrom, dateTo],
  );

  const users = Array.from(new Set(baseVisibleLogs.map((entry) => entry.userEmail)));
  const roles = Array.from(new Set(baseVisibleLogs.map((entry) => entry.role)));
  const modules = Array.from(new Set(baseVisibleLogs.map((entry) => entry.module)));
  const actions = Array.from(new Set(baseVisibleLogs.map((entry) => entry.action)));

  const stats = useMemo(() => {
    const successful = filteredLogs.filter((entry) => entry.status === 'success').length;
    const failed = filteredLogs.filter((entry) => entry.status === 'failed').length;
    const highRisk = filteredLogs.filter((entry) => entry.riskLevel === 'high').length;
    const active = sessions.length;
    return { successful, failed, highRisk, active };
  }, [filteredLogs, sessions.length]);

  const handleTerminateSession = (sessionId: string) => {
    setSelectedSessionId(sessionId);
    setShowTerminateDialog(true);
  };

  const confirmTerminate = () => {
    if (selectedSessionId) terminateSession(selectedSessionId);
    setShowTerminateDialog(false);
    setSelectedSessionId(null);
    toast.success('Session terminated');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[#1E4ED8]">Security & Audit</h1>
          <p className="text-sm text-gray-500 mt-1">Compliance-ready audit trails, session control, and role-aware security policies.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="gap-2" disabled={!proAccess} onClick={() => exportLogs(filteredLogs, 'csv')}>
            <Download className="w-4 h-4" />
            Export CSV
          </Button>
          <Button variant="outline" className="gap-2" disabled={!proAccess} onClick={() => exportLogs(filteredLogs, 'pdf')}>PDF</Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={selectedTab} onValueChange={setSelectedTab} className="space-y-6">
        <TabsList className="bg-white/50 backdrop-blur-sm border border-white/60 p-1">
          <TabsTrigger value="logs" className="gap-2 data-[state=active]:bg-[#1E4ED8] data-[state=active]:text-white">
            <History className="w-4 h-4" />
            Audit Logs
          </TabsTrigger>
          <TabsTrigger value="sessions" className="gap-2 data-[state=active]:bg-[#1E4ED8] data-[state=active]:text-white">
            <Monitor className="w-4 h-4" />
            Active Sessions
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-2 data-[state=active]:bg-[#1E4ED8] data-[state=active]:text-white">
            <Shield className="w-4 h-4" />
            Security Settings
          </TabsTrigger>
        </TabsList>

        {/* Audit Logs Tab */}
        <TabsContent value="logs" className="space-y-6">
          {/* Stats Cards */}
          <div className="dashboard-stat-grid">
            <button className="bg-white/70 text-left backdrop-blur-xl border border-white/60 shadow-sm p-4 rounded-xl hover:bg-white/80 transition-all duration-300" onClick={() => setFilterAction('all')}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                  <CheckCircle className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <p className="text-2xl font-semibold text-[#1E4ED8]">{stats.successful}</p>
                  <p className="text-xs text-gray-500">Successful Actions</p>
                </div>
              </div>
            </button>
            <button className="bg-white/70 text-left backdrop-blur-xl border border-white/60 shadow-sm p-4 rounded-xl hover:bg-white/80 transition-all duration-300" onClick={() => setFilterRisk('high')}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center">
                  <XCircle className="w-5 h-5 text-red-600" />
                </div>
                <div>
                  <p className="text-2xl font-semibold text-[#1E4ED8]">{stats.failed}</p>
                  <p className="text-xs text-gray-500">Failed Attempts</p>
                </div>
              </div>
            </button>
            <button className="bg-white/70 text-left backdrop-blur-xl border border-white/60 shadow-sm p-4 rounded-xl hover:bg-white/80 transition-all duration-300" onClick={() => setFilterRisk('high')}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <p className="text-2xl font-semibold text-[#1E4ED8]">{stats.highRisk}</p>
                  <p className="text-xs text-gray-500">High Risk Events</p>
                </div>
              </div>
            </button>
            <button className="bg-white/70 text-left backdrop-blur-xl border border-white/60 shadow-sm p-4 rounded-xl hover:bg-white/80 transition-all duration-300" onClick={() => setSelectedTab('sessions')}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <Eye className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-2xl font-semibold text-[#1E4ED8]">{stats.active}</p>
                  <p className="text-xs text-gray-500">Active Sessions</p>
                </div>
              </div>
            </button>
          </div>

          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Search by user, action, resource, or module..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 bg-white/50 backdrop-blur-sm border-white/60"
              />
            </div>
            <div className="flex gap-2 items-center">
              <Calendar className="w-4 h-4 text-gray-400" />
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
            </div>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
            <select className="h-10 rounded-md border border-input px-3 text-sm bg-white" value={filterUser} onChange={(e) => setFilterUser(e.target.value)} disabled={!proAccess}>
              <option value="all">All users</option>
              {users.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
            </select>
            <select className="h-10 rounded-md border border-input px-3 text-sm bg-white" value={filterRole} onChange={(e) => setFilterRole(e.target.value)} disabled={!proAccess}>
              <option value="all">All roles</option>
              {roles.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
            </select>
            <select className="h-10 rounded-md border border-input px-3 text-sm bg-white" value={filterModule} onChange={(e) => setFilterModule(e.target.value)} disabled={!proAccess}>
              <option value="all">All modules</option>
              {modules.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
            </select>
            <select className="h-10 rounded-md border border-input px-3 text-sm bg-white" value={filterAction} onChange={(e) => setFilterAction(e.target.value)} disabled={!proAccess}>
              <option value="all">All actions</option>
              {actions.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
            </select>
            <select className="h-10 rounded-md border border-input px-3 text-sm bg-white" value={filterRisk} onChange={(e) => setFilterRisk(e.target.value)} disabled={!proAccess}>
              <option value="all">All risks</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>

          {/* Audit Logs Table */}
          <div className="bg-white/70 backdrop-blur-xl border border-white/60 shadow-sm rounded-xl overflow-hidden hover:bg-white/80 transition-all duration-300">
            <div className="responsive-table-wrap">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-white/20">
                    <TableHead className="text-[#1E4ED8] font-medium">Timestamp</TableHead>
                    <TableHead className="text-[#1E4ED8] font-medium">User</TableHead>
                    <TableHead className="text-[#1E4ED8] font-medium">Action</TableHead>
                    <TableHead className="text-[#1E4ED8] font-medium">Resource</TableHead>
                    <TableHead className="text-[#1E4ED8] font-medium">Module</TableHead>
                    <TableHead className="text-[#1E4ED8] font-medium">Device</TableHead>
                    <TableHead className="text-[#1E4ED8] font-medium">Risk</TableHead>
                    <TableHead className="text-[#1E4ED8] font-medium">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLogs.map((log) => {
                    const { date, time } = formatDateTime(log.timestamp);
                    return (
                      <TableRow key={log.id} className="hover:bg-white/40 border-white/20 cursor-pointer" onClick={() => setSelectedLog(log)}>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="text-sm font-medium text-gray-900">{date}</span>
                            <span className="text-xs text-gray-500">{time}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#1E4ED8] to-[#6D28D9] flex items-center justify-center text-white text-xs font-medium">
                              {log.userName.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                            </div>
                            <div className="flex flex-col">
                              <span className="text-sm font-medium text-gray-900">{log.userName}</span>
                              <span className="text-xs text-gray-500">{log.role}</span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`gap-1 ${getActionColor(log.action)}`}>
                            {log.action}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="text-sm text-gray-900">{log.resource}</span>
                            <span className="text-xs text-gray-500">{log.resourceId}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-gray-700">{log.module}</span>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {getDeviceIcon(log.device.split(' - ')[0].toLowerCase())}
                            <div className="flex flex-col">
                              <span className="text-sm text-gray-900">{log.device} - {log.browser}</span>
                              <span className="text-xs text-gray-500 flex items-center gap-1">
                                <Globe className="w-3 h-3" />
                                {log.location}
                              </span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell><Badge variant="outline" className={log.riskLevel === 'high' ? 'bg-red-500/10 text-red-600 border-red-200' : log.riskLevel === 'medium' ? 'bg-amber-500/10 text-amber-600 border-amber-200' : 'bg-emerald-500/10 text-emerald-600 border-emerald-200'}>{log.riskLevel}</Badge></TableCell>
                        <TableCell>
                          <Badge 
                            variant="outline" 
                            className={log.status === 'success' 
                              ? 'bg-emerald-500/10 text-emerald-600 border-emerald-200' 
                              : 'bg-red-500/10 text-red-600 border-red-200'
                            }
                          >
                            {log.status === 'success' ? 'Success' : 'Failed'}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>

        {/* Active Sessions Tab */}
        <TabsContent value="sessions" className="space-y-6">
          <div className="flex justify-end">
            <Button variant="outline" className="text-red-600 border-red-200 hover:bg-red-50" onClick={terminateAllSessions} disabled={!canAdmin}>
              <UserX className="w-4 h-4 mr-2" />
              Terminate all remote sessions
            </Button>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {sessions.map((session) => {
              const started = formatDateTime(session.loginTime);
              const lastActive = formatDateTime(session.lastActivity);
              return (
                <div key={session.id} className="bg-white/70 backdrop-blur-xl border border-white/60 shadow-sm p-4 rounded-xl hover:bg-white/80 transition-all duration-300">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#1E4ED8] to-[#6D28D9] flex items-center justify-center text-white font-medium">
                        {session.userName.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium text-[#1E4ED8]">{session.userName}</h3>
                          {session.isCurrent && (
                            <Badge className="bg-[#1E4ED8] text-white text-xs">Current</Badge>
                          )}
                          {session.suspicious && <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-200">Suspicious</Badge>}
                        </div>
                        <p className="text-sm text-gray-500">{session.userEmail}</p>
                        <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                          <span className="flex items-center gap-1">
                            {session.device}
                          </span>
                          <span className="flex items-center gap-1">
                            <Globe className="w-3 h-3" />
                            {session.location}
                          </span>
                        </div>
                        <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            Started: {started.time}
                          </span>
                          <span className="flex items-center gap-1">
                            <RefreshCw className="w-3 h-3" />
                            Last active: {lastActive.time}
                          </span>
                        </div>
                      </div>
                    </div>
                    {!session.isCurrent && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-red-600 border-red-200 hover:bg-red-50"
                        onClick={() => handleTerminateSession(session.id)}
                        disabled={!canAdmin}
                      >
                        <LogOut className="w-4 h-4 mr-1" />
                        Terminate
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </TabsContent>

        {/* Security Settings Tab */}
        <TabsContent value="settings" className="space-y-6">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-white/70 border border-white/60 rounded-xl p-4 space-y-3">
              <p className="font-medium text-[#1E4ED8]">Authentication Policies</p>
              <div className="flex items-center justify-between"><Label>Password min length ({policies.passwordMinLength})</Label><Input className="w-20" type="number" value={policies.passwordMinLength} onChange={(e) => updatePolicy('passwordMinLength', Number(e.target.value))} disabled={!canConfigurePolicies} /></div>
              <div className="flex items-center justify-between"><Label>Uppercase</Label><Switch checked={policies.requireUppercase} onCheckedChange={(v) => updatePolicy('requireUppercase', v)} disabled={!canConfigurePolicies} /></div>
              <div className="flex items-center justify-between"><Label>Numbers</Label><Switch checked={policies.requireNumbers} onCheckedChange={(v) => updatePolicy('requireNumbers', v)} disabled={!canConfigurePolicies} /></div>
              <div className="flex items-center justify-between"><Label>Password expiry ({policies.passwordExpiryDays} days)</Label><Input className="w-20" type="number" value={policies.passwordExpiryDays} onChange={(e) => updatePolicy('passwordExpiryDays', Number(e.target.value))} disabled={!canConfigurePolicies} /></div>
              <div className="flex items-center justify-between"><Label>Login attempt limit ({policies.loginAttemptLimit})</Label><Input className="w-20" type="number" value={policies.loginAttemptLimit} onChange={(e) => updatePolicy('loginAttemptLimit', Number(e.target.value))} disabled={!canConfigurePolicies} /></div>
              <div className="flex items-center justify-between"><Label>CAPTCHA after failures</Label><Switch checked={policies.captchaAfterFailedAttempts} onCheckedChange={(v) => updatePolicy('captchaAfterFailedAttempts', v)} disabled={!canConfigurePolicies} /></div>
            </div>
            <div className="bg-white/70 border border-white/60 rounded-xl p-4 space-y-3">
              <p className="font-medium text-[#1E4ED8]">2FA and Session Control</p>
              <div className="flex items-center justify-between"><Label>Enable 2FA</Label><Switch checked={policies.twoFactorEnabled} onCheckedChange={(v) => updatePolicy('twoFactorEnabled', v)} disabled={!canConfigurePolicies} /></div>
              <div className="flex items-center justify-between"><Label>Session timeout ({policies.sessionTimeoutMinutes} min)</Label><Input className="w-20" type="number" value={policies.sessionTimeoutMinutes} onChange={(e) => updatePolicy('sessionTimeoutMinutes', Number(e.target.value))} disabled={!canConfigurePolicies} /></div>
              <div className="flex items-center justify-between"><Label>Device trust</Label><Switch checked={policies.deviceTrustEnabled} onCheckedChange={(v) => updatePolicy('deviceTrustEnabled', v)} disabled={!canConfigurePolicies} /></div>
              <div className="text-xs text-gray-500">2FA enforced roles: {policies.enforceTwoFactorRoles.join(', ')}</div>
              <div className="text-xs text-gray-500">Methods: {policies.allowedTwoFactorMethods.join(', ')}</div>
              {!enterpriseAccess && <div className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-md p-2">Enterprise unlocks advanced monitoring and automated threat workflows.</div>}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Terminate Session Dialog */}
      <Dialog open={showTerminateDialog} onOpenChange={setShowTerminateDialog}>
        <DialogContent className="bg-white/90 backdrop-blur-xl">
          <DialogHeader>
            <DialogTitle className="text-[#1E4ED8] flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Terminate Session
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to terminate this session? The user will be logged out immediately.
            </DialogDescription>
          </DialogHeader>
          {selectedSessionId && (
            <div className="bg-slate-50 p-4 rounded-lg space-y-2">
              <p>This session will be terminated immediately.</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTerminateDialog(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmTerminate}>
              <LogOut className="w-4 h-4 mr-2" />
              Terminate Session
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!selectedLog} onOpenChange={(open) => !open && setSelectedLog(null)}>
        <DialogContent className="bg-white/90 backdrop-blur-xl">
          {selectedLog && (
            <>
              <DialogHeader>
                <DialogTitle className="text-[#1E4ED8]">Audit Event Details</DialogTitle>
                <DialogDescription>Full compliance breakdown and risk analysis</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <p><strong>User:</strong> {selectedLog.userName}</p>
                <p><strong>Role:</strong> {selectedLog.role}</p>
                <p><strong>Action:</strong> {selectedLog.action}</p>
                <p><strong>Module:</strong> {selectedLog.module}</p>
                <p><strong>Resource:</strong> {selectedLog.resource}</p>
                <p><strong>Resource ID:</strong> {selectedLog.resourceId}</p>
                <p><strong>Device:</strong> {selectedLog.device}</p>
                <p><strong>Browser:</strong> {selectedLog.browser}</p>
                <p><strong>Location:</strong> {selectedLog.location}</p>
                <p><strong>IP:</strong> {selectedLog.ipAddress}</p>
                <p><strong>Risk:</strong> {selectedLog.riskLevel}</p>
                <p><strong>Status:</strong> {selectedLog.status}</p>
              </div>
              {selectedLog.details && <div className="text-sm bg-gray-50 border border-gray-100 rounded-md p-2">{selectedLog.details}</div>}
              <DialogFooter>
                <Button variant="outline" onClick={() => selectedLog && flagLog(selectedLog.id)}><AlertTriangle className="w-4 h-4 mr-2" />Flag suspicious activity</Button>
                <Button onClick={() => setSelectedLog(null)}>Close</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
