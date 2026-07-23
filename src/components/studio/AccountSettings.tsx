import { useEffect, useRef, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Camera, Trash2, Radio, Circle, Activity, Loader2, Check, HardDrive, RefreshCw } from 'lucide-react';
import { getActivities, ACTIVITY_EVENT, type ActivityEntry } from '@/lib/activityLog';
import { useAuth, displayNameOf, storageBackendOf } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import * as drive from '@/lib/googleDrive';
import { isSystemAdmin, syncSystem } from '@/lib/systemSync';

const DISPLAY_NAME_MAX = 40;

const AVATAR_KEY = 'studio-avatar';
const AVATAR_EVENT = 'studio-avatar-changed';

/** Read the saved profile picture (data URL) from localStorage. */
export function getAvatar(): string | null {
  try {
    return localStorage.getItem(AVATAR_KEY);
  } catch {
    return null;
  }
}

/** Downscale an uploaded image to a small square JPEG so it fits in
 * localStorage, then persist it. Returns the data URL or null on failure. */
async function saveAvatarFromFile(file: File): Promise<string | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    // Cover-crop to a centered square
    const scale = Math.max(size / bitmap.width, size / bitmap.height);
    const w = bitmap.width * scale;
    const h = bitmap.height * scale;
    ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h);
    bitmap.close();
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    localStorage.setItem(AVATAR_KEY, dataUrl);
    window.dispatchEvent(new Event(AVATAR_EVENT));
    return dataUrl;
  } catch {
    return null;
  }
}

function clearAvatar() {
  try {
    localStorage.removeItem(AVATAR_KEY);
    window.dispatchEvent(new Event(AVATAR_EVENT));
  } catch {
    /* no-op */
  }
}

/** Live avatar value that follows uploads/removals across the app. */
export function useAvatar(): string | null {
  const [avatar, setAvatar] = useState<string | null>(getAvatar);
  useEffect(() => {
    const sync = () => setAvatar(getAvatar());
    window.addEventListener(AVATAR_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(AVATAR_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return avatar;
}

const iconFor = (label: string) =>
  label.includes('live') || label.includes('stream') ? Radio : Circle;

function timeAgo(at: number): string {
  const s = Math.round((Date.now() - at) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  return new Date(at).toLocaleDateString();
}

export function AccountSettings({
  open, onOpenChange, email,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  email: string;
}) {
  const avatar = useAvatar();
  const { user, updateDisplayName, updateStorageBackend } = useAuth();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [activities, setActivities] = useState<ActivityEntry[]>([]);

  // Editable display name. Seeded from the account and re-seeded whenever the
  // dialog opens (so it always reflects the saved value).
  const savedName = displayNameOf(user);
  const [name, setName] = useState(savedName);
  const [savingName, setSavingName] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  useEffect(() => {
    if (open) setName(displayNameOf(user));
    // Re-seed on open; user identity change also refreshes it.
  }, [open, user]);

  const trimmedName = name.trim();
  const nameDirty = trimmedName !== savedName && trimmedName.length > 0;

  const handleSaveName = async () => {
    if (!nameDirty || savingName) return;
    setSavingName(true);
    const { error } = await updateDisplayName(trimmedName);
    setSavingName(false);
    if (error) {
      toast({ title: 'Could not save name', description: error.message, variant: 'destructive' });
      return;
    }
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
  };

  // ── Google Drive storage ──
  // Whether the server has Drive OAuth configured, the connected account email
  // (null when not connected), and the account's storage preference.
  const [driveConfigured, setDriveConfigured] = useState(true);
  const [driveEmail, setDriveEmail] = useState<string | null>(drive.isLoggedIn() ? '' : null);
  const [driveBusy, setDriveBusy] = useState(false);
  const useDrive = storageBackendOf(user) === 'drive';

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void drive.isConfigured().then(c => { if (!cancelled) setDriveConfigured(c); });
    // Confirm the stored session is still valid and surface the account email.
    if (drive.isLoggedIn()) {
      drive.getMe()
        .then(me => { if (!cancelled) setDriveEmail(me.email); })
        .catch(() => { if (!cancelled) { drive.logout(); setDriveEmail(null); } });
    } else {
      setDriveEmail(null);
    }
    return () => { cancelled = true; };
  }, [open]);

  const handleConnectDrive = async () => {
    if (driveBusy) return;
    setDriveBusy(true);
    try {
      await drive.login();
      const me = await drive.getMe();
      setDriveEmail(me.email);
      toast({ title: '✅ Google Drive connected', description: me.email });
    } catch (err) {
      toast({ title: 'Could not connect Google Drive', description: err instanceof Error ? err.message : 'Please try again', variant: 'destructive' });
    } finally {
      setDriveBusy(false);
    }
  };

  const handleDisconnectDrive = async () => {
    drive.logout();
    setDriveEmail(null);
    // Fall back to Supabase for new files so nothing silently fails to save.
    if (useDrive) await updateStorageBackend('supabase');
    toast({ title: 'Google Drive disconnected' });
  };

  const handleToggleDrive = async (on: boolean) => {
    if (driveBusy) return;
    setDriveBusy(true);
    const { error } = await updateStorageBackend(on ? 'drive' : 'supabase');
    setDriveBusy(false);
    if (error) {
      toast({ title: 'Could not save preference', description: error.message, variant: 'destructive' });
    }
  };

  // Refresh the log whenever the dialog opens or a new activity is recorded
  useEffect(() => {
    if (!open) return;
    const sync = () => setActivities(getActivities());
    sync();
    window.addEventListener(ACTIVITY_EVENT, sync);
    return () => window.removeEventListener(ACTIVITY_EVENT, sync);
  }, [open]);

  // ── UPDATE SYSTEM (admin only) ──
  // Pushes this admin account's shared settings onto every other account.
  const canUpdateSystem = isSystemAdmin(user?.email);
  const [confirmSystem, setConfirmSystem] = useState(false);
  const [systemBusy, setSystemBusy] = useState(false);

  const handleUpdateSystem = async () => {
    setSystemBusy(true);
    try {
      const res = await syncSystem();
      const detail = res.updated === res.scanned
        ? `${res.updated} account${res.updated === 1 ? '' : 's'} updated`
        : `${res.updated} of ${res.scanned} accounts updated`;
      toast({
        title: '✅ System updated',
        description: res.failed > 0 ? `${detail} · ${res.failed} failed` : detail,
      });
    } catch (err) {
      toast({
        title: 'Update failed',
        description: err instanceof Error ? err.message : 'Please try again',
        variant: 'destructive',
      });
    } finally {
      setSystemBusy(false);
      setConfirmSystem(false);
    }
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    await saveAvatarFromFile(file);
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const initials = (savedName || email).slice(0, 2).toUpperCase();
  const lastTwo = activities.slice(0, 2);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Account settings</DialogTitle>
          <DialogDescription className="truncate">{email}</DialogDescription>
        </DialogHeader>

        {/* Profile picture */}
        <div className="flex items-center gap-4">
          <div className="relative">
            <Avatar className="h-16 w-16">
              {avatar && <AvatarImage src={avatar} alt="Profile picture" />}
              <AvatarFallback className="bg-primary/15 text-primary font-semibold">
                {initials}
              </AvatarFallback>
            </Avatar>
          </div>
          <div className="flex-1 space-y-1.5">
            <p className="text-sm font-medium text-foreground">Profile picture</p>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" className="gap-1.5" onClick={() => fileRef.current?.click()} disabled={uploading}>
                <Camera className="h-3.5 w-3.5" />
                {avatar ? 'Change' : 'Add photo'}
              </Button>
              {avatar && (
                <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground hover:text-destructive" onClick={clearAvatar}>
                  <Trash2 className="h-3.5 w-3.5" /> Remove
                </Button>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
          </div>
        </div>

        {/* Display name */}
        <div className="border-t border-border pt-4 space-y-1.5">
          <label htmlFor="account-display-name" className="text-sm font-medium text-foreground">
            Display name
          </label>
          <div className="flex gap-2">
            <Input
              id="account-display-name"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleSaveName(); } }}
              placeholder="Your name"
              maxLength={DISPLAY_NAME_MAX}
              className="flex-1"
            />
            <Button
              size="sm"
              onClick={handleSaveName}
              disabled={!nameDirty || savingName}
              className="gap-1.5 shrink-0"
            >
              {savingName ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : justSaved ? <Check className="h-3.5 w-3.5" />
                : null}
              {justSaved ? 'Saved' : 'Save'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Shown across your studio. Defaults to your email name until you set one.
          </p>
        </div>

        {/* Storage — store your files in your own Google Drive */}
        <div className="border-t border-border pt-4 space-y-3">
          <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <HardDrive className="h-4 w-4 text-primary" /> Storage
          </div>

          {!driveConfigured ? (
            <p className="text-xs text-muted-foreground">
              Google Drive storage isn’t available yet. Once it’s configured you’ll be
              able to keep your recordings, edits and graphics in your own Drive.
            </p>
          ) : (
            <>
              <div className="flex items-center gap-3 rounded-md bg-secondary/40 px-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">Google Drive</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {driveEmail === null ? 'Store your files in your own account' : (driveEmail || 'Connected')}
                  </p>
                </div>
                {driveEmail !== null ? (
                  <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground hover:text-destructive shrink-0" onClick={handleDisconnectDrive}>
                    Disconnect
                  </Button>
                ) : (
                  <Button size="sm" variant="secondary" className="gap-1.5 shrink-0" onClick={handleConnectDrive} disabled={driveBusy}>
                    {driveBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    Connect
                  </Button>
                )}
              </div>

              <label className="flex items-center gap-3" htmlFor="use-drive-toggle">
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">Store my new files on my Google Drive</p>
                  <p className="text-xs text-muted-foreground">
                    Recordings, edited videos and graphics you create will be saved to
                    your Drive. Files already in the cloud stay where they are.
                  </p>
                </div>
                <Switch
                  id="use-drive-toggle"
                  checked={useDrive}
                  onCheckedChange={handleToggleDrive}
                  disabled={driveBusy || driveEmail === null}
                />
              </label>
            </>
          )}
        </div>

        {/* UPDATE SYSTEM — admin only */}
        {canUpdateSystem && (
          <div className="border-t border-border pt-4 space-y-2.5">
            <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <RefreshCw className="h-4 w-4 text-primary" /> System
            </div>
            <p className="text-xs text-muted-foreground">
              Push your shared app settings to every other account so everyone matches
              your setup. Each user keeps their own name and uploaded videos & graphics.
            </p>
            <Button
              className="w-full gap-1.5 font-semibold tracking-wide"
              onClick={() => setConfirmSystem(true)}
              disabled={systemBusy}
            >
              {systemBusy
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <RefreshCw className="h-4 w-4" />}
              UPDATE SYSTEM
            </Button>
          </div>
        )}

        <AlertDialog open={confirmSystem} onOpenChange={o => { if (!systemBusy) setConfirmSystem(o); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Update all accounts?</AlertDialogTitle>
              <AlertDialogDescription>
                This copies your shared settings onto every other account. Each user's
                display name and uploaded videos & graphics are left untouched. This
                can't be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={systemBusy}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={e => { e.preventDefault(); void handleUpdateSystem(); }}
                disabled={systemBusy}
                className="gap-1.5"
              >
                {systemBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Update system
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Recent activity */}
        <div className="border-t border-border pt-4">
          <div className="flex items-center gap-1.5 text-sm font-medium text-foreground mb-2.5">
            <Activity className="h-4 w-4 text-primary" /> Recent activity
          </div>
          {lastTwo.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">
              No activity yet — going live or recording will show up here.
            </p>
          ) : (
            <ul className="space-y-2">
              {lastTwo.map((a, i) => {
                const Icon = iconFor(a.label.toLowerCase());
                return (
                  <li key={`${a.at}-${i}`} className="flex items-center gap-2.5 rounded-md bg-secondary/40 px-3 py-2">
                    <Icon className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span className="text-xs font-medium text-foreground flex-1">{a.label}</span>
                    <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">{timeAgo(a.at)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
