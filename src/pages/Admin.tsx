/**
 * Hidden admin panel, served at /ed/admin (deliberately unlinked from the app
 * chrome). Own credential system — see src/lib/adminApi.ts. Lists every
 * platform user; clicking a row expands their details: date joined, auth
 * providers, the last five activities (timestamp + work area), and a
 * block/unblock control.
 */
import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Loader2, LogOut, KeyRound, RefreshCw, ShieldAlert, Shield, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/use-toast';
import {
  AdminAuthError, adminChangePassword, adminListUsers, adminLogin, adminLogout,
  adminSetBlocked, adminUserActivity, getAdminToken,
  type AdminActivity, type AdminUser,
} from '@/lib/adminApi';

type View = 'checking' | 'login' | 'force-change' | 'dashboard';

const fmt = (iso: string | null) => (iso ? format(new Date(iso), 'MMM d, yyyy h:mm a') : '—');
const fmtDay = (iso: string) => format(new Date(iso), 'MMM d, yyyy');

export default function Admin() {
  const { toast } = useToast();
  const [view, setView] = useState<View>('checking');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activities, setActivities] = useState<Record<string, AdminActivity[] | 'loading'>>({});
  const [confirmBlock, setConfirmBlock] = useState<AdminUser | null>(null);
  const [blockBusy, setBlockBusy] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);

  const loadUsers = useCallback(async () => {
    setLoadingUsers(true);
    try {
      setUsers(await adminListUsers());
      setView('dashboard');
    } catch (e) {
      if (e instanceof AdminAuthError) setView('login');
      else toast({ title: 'Could not load users', description: (e as Error).message });
    } finally {
      setLoadingUsers(false);
    }
  }, [toast]);

  useEffect(() => {
    if (getAdminToken()) void loadUsers();
    else setView('login');
  }, [loadUsers]);

  const toggleExpand = (u: AdminUser) => {
    const next = expandedId === u.id ? null : u.id;
    setExpandedId(next);
    if (next && !activities[u.id]) {
      setActivities(a => ({ ...a, [u.id]: 'loading' }));
      adminUserActivity(u.id)
        .then(rows => setActivities(a => ({ ...a, [u.id]: rows })))
        .catch(() => setActivities(a => ({ ...a, [u.id]: [] })));
    }
  };

  const applyBlock = async (u: AdminUser, blocked: boolean) => {
    setBlockBusy(true);
    try {
      await adminSetBlocked(u.id, blocked);
      setUsers(list => list.map(x => (x.id === u.id ? { ...x, blocked } : x)));
      toast({ title: blocked ? 'User blocked' : 'User unblocked', description: u.email ?? u.id });
    } catch (e) {
      toast({ title: 'Action failed', description: (e as Error).message });
    } finally {
      setBlockBusy(false);
      setConfirmBlock(null);
    }
  };

  if (view === 'checking') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (view === 'login') {
    return <AdminLogin onSuccess={must => (must ? setView('force-change') : void loadUsers())} />;
  }

  if (view === 'force-change') {
    return (
      <ChangePasswordForm
        forced
        onDone={() => { toast({ title: 'Password updated' }); void loadUsers(); }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-4xl mx-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-semibold">StreamForge Admin</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => void loadUsers()} disabled={loadingUsers} className="gap-1.5">
              {loadingUsers ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Refresh
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPwOpen(true)} className="gap-1.5">
              <KeyRound className="h-3.5 w-3.5" /> Change password
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { void adminLogout(); setView('login'); }}
              className="gap-1.5"
            >
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </Button>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          {users.length} user{users.length === 1 ? '' : 's'} · click a row for details, activity, and blocking
        </p>

        <div className="rounded-lg border border-border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Email</TableHead>
                <TableHead>Date joined</TableHead>
                <TableHead>Last sign-in</TableHead>
                <TableHead>Sign-in method</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map(u => (
                <UserRows
                  key={u.id}
                  user={u}
                  expanded={expandedId === u.id}
                  activity={activities[u.id]}
                  onToggle={() => toggleExpand(u)}
                  onBlockClick={() => (u.blocked ? void applyBlock(u, false) : setConfirmBlock(u))}
                  blockBusy={blockBusy}
                />
              ))}
              {users.length === 0 && !loadingUsers && (
                <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">No users found.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={pwOpen} onOpenChange={setPwOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Change admin password</DialogTitle>
            <DialogDescription>Other admin sessions are signed out after a change.</DialogDescription>
          </DialogHeader>
          <ChangePasswordForm bare onDone={() => { setPwOpen(false); toast({ title: 'Password updated' }); }} />
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmBlock} onOpenChange={open => { if (!open) setConfirmBlock(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Block {confirmBlock?.email ?? 'this user'}?</AlertDialogTitle>
            <AlertDialogDescription>
              They will be unable to sign in (any method, including OAuth). Active sessions end within an hour.
              You can unblock them at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={blockBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={blockBusy}
              onClick={e => { e.preventDefault(); if (confirmBlock) void applyBlock(confirmBlock, true); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {blockBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Block user'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function UserRows({
  user: u, expanded, activity, onToggle, onBlockClick, blockBusy,
}: {
  user: AdminUser;
  expanded: boolean;
  activity: AdminActivity[] | 'loading' | undefined;
  onToggle: () => void;
  onBlockClick: () => void;
  blockBusy: boolean;
}) {
  return (
    <>
      <TableRow onClick={onToggle} className="cursor-pointer">
        <TableCell className="pr-0">
          {expanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        </TableCell>
        <TableCell className="font-medium text-sm">{u.email ?? <span className="text-muted-foreground">(no email)</span>}</TableCell>
        <TableCell className="text-sm">{fmtDay(u.createdAt)}</TableCell>
        <TableCell className="text-sm">{fmt(u.lastSignInAt)}</TableCell>
        <TableCell className="text-sm capitalize">{u.providers.join(', ') || '—'}</TableCell>
        <TableCell>
          {u.blocked
            ? <Badge variant="destructive" className="text-[10px]">Blocked</Badge>
            : <Badge variant="secondary" className="text-[10px]">Active</Badge>}
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={6} className="bg-secondary/30 p-4">
            <div className="space-y-3">
              <div className="grid gap-1 text-xs text-muted-foreground">
                <span><span className="text-foreground font-medium">User ID:</span> <span className="font-mono">{u.id}</span></span>
                <span><span className="text-foreground font-medium">Joined:</span> {fmt(u.createdAt)}</span>
              </div>

              <div>
                <p className="text-xs font-medium mb-1.5">Last five activities</p>
                {activity === 'loading' || activity === undefined ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
                  </div>
                ) : activity.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-1">No activity recorded yet.</p>
                ) : (
                  <div className="rounded-md border border-border overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="h-8 text-xs">Timestamp</TableHead>
                          <TableHead className="h-8 text-xs">Work area</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {activity.map((a, i) => (
                          <TableRow key={i}>
                            <TableCell className="py-1.5 text-xs">{fmt(a.at)}</TableCell>
                            <TableCell className="py-1.5 text-xs">{a.area}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>

              <Button
                size="sm"
                variant={u.blocked ? 'outline' : 'destructive'}
                disabled={blockBusy}
                onClick={e => { e.stopPropagation(); onBlockClick(); }}
                className="gap-1.5"
              >
                <ShieldAlert className="h-3.5 w-3.5" />
                {u.blocked ? 'Unblock user' : 'Block user'}
              </Button>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function AdminLogin({ onSuccess }: { onSuccess: (mustChangePassword: boolean) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { mustChangePassword } = await adminLogin(username.trim(), password);
      onSuccess(mustChangePassword);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-xs space-y-3 rounded-lg border border-border p-6">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Shield className="h-4 w-4 text-primary" /> Admin sign in
        </div>
        <Input autoFocus placeholder="Username" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} disabled={busy} />
        <Input type="password" placeholder="Password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} disabled={busy} />
        {error && <p className="text-[11px] text-destructive">{error}</p>}
        <Button type="submit" size="sm" className="w-full" disabled={busy || !username || !password}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Sign in'}
        </Button>
      </form>
    </div>
  );
}

function ChangePasswordForm({ forced = false, bare = false, onDone }: {
  forced?: boolean;
  /** Render only the fields (for embedding in a dialog). */
  bare?: boolean;
  onDone: () => void;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (next !== confirm) { setError('New passwords do not match.'); return; }
    setBusy(true);
    setError(null);
    try {
      await adminChangePassword(current, next);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const fields = (
    <form onSubmit={submit} className="space-y-3">
      {forced && (
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          The default admin password must be changed before the panel unlocks.
          Use at least 10 characters.
        </p>
      )}
      <Input type="password" placeholder="Current password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} disabled={busy} />
      <Input type="password" placeholder="New password (min 10 characters)" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} disabled={busy} />
      <Input type="password" placeholder="Repeat new password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} disabled={busy} />
      {error && <p className="text-[11px] text-destructive">{error}</p>}
      <DialogFooter className={bare ? '' : 'sm:justify-start'}>
        <Button type="submit" size="sm" className={bare ? '' : 'w-full'} disabled={busy || !current || !next || !confirm}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Update password'}
        </Button>
      </DialogFooter>
    </form>
  );

  if (bare) return fields;
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-xs space-y-3 rounded-lg border border-border p-6">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <KeyRound className="h-4 w-4 text-primary" /> Set a new admin password
        </div>
        {fields}
      </div>
    </div>
  );
}
