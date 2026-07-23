import { useStudio, type Destination } from '@/contexts/StudioContext';
import {
  Plus, Trash2, Share, BarChart3, Pencil, Loader2, Radio, Globe,
  ChevronDown, ExternalLink, AlertTriangle, RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useState, useEffect, useCallback } from 'react';
import { StreamStatusPanel } from './StreamStatusPanel';
import { PlatformIcon } from './PlatformIcon';
import {
  getConnectProviders, connectPlatform,
  type ProviderMap, type ConnectPlatform,
} from '@/lib/platformConnect';
import {
  getLivepushConfigured, connectLivepush, getStoredLivepushConnection,
  hydrateLivepushConnection, clearStoredLivepushConnection, listLivepushDestinations,
  setLivepushDestinationEnabled, type LivepushDestination,
} from '@/lib/livepushConnect';

// The user's own Livepush dashboard. Livepush resolves this from THEIR browser
// session, so the one URL always lands each user on their own account — no
// per-user path needed (and livepush.io/dashboard is a dead link).
const LIVEPUSH_DASHBOARD_URL = 'https://app.livepush.io/overview';

const defaultUrls: Record<string, string> = {
  youtube: 'rtmp://a.rtmp.youtube.com/live2',
  twitch: 'rtmp://live.twitch.tv/app',
  facebook: 'rtmps://live-api-s.facebook.com:443/rtmp/',
  custom: '',
};

const channelIdPlaceholders: Record<string, string> = {
  youtube: 'YouTube Channel ID (e.g. UCxxxxxxxx)',
  twitch: 'Twitch Username (e.g. ninja)',
  facebook: 'Facebook Live Video ID',
  custom: 'Channel identifier (optional)',
};

function EditDestinationForm({
  destination, onDone,
}: {
  destination: Destination;
  onDone: () => void;
}) {
  const { updateDestination } = useStudio();
  const [name, setName] = useState(destination.name);
  const [streamKey, setStreamKey] = useState('');
  const [streamUrl, setStreamUrl] = useState(destination.streamUrl);
  const [channelId, setChannelId] = useState(destination.platformChannelId ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  const handleSave = async () => {
    if (!name.trim() || !streamUrl.trim()) return;
    setSaving(true);
    setError(false);
    const ok = await updateDestination(destination.id, {
      name: name.trim(),
      streamUrl: streamUrl.trim(),
      platformChannelId: channelId.trim() || undefined,
      streamKey: streamKey.trim() || undefined,
    });
    setSaving(false);
    if (ok) onDone();
    else setError(true);
  };

  return (
    <div className="space-y-2.5 pt-2 border-t border-border animate-fade-in">
      <Input
        placeholder="Display name"
        value={name}
        onChange={e => setName(e.target.value)}
        className="text-sm"
      />
      <div>
        <Input
          placeholder="New stream key (leave blank to keep current)"
          type="password"
          value={streamKey}
          onChange={e => setStreamKey(e.target.value)}
          className="text-sm"
        />
        <p className="text-[11px] text-muted-foreground/60 mt-1">
          The saved key stays unless you enter a new one.
        </p>
      </div>
      <Input
        placeholder="RTMP URL"
        value={streamUrl}
        onChange={e => setStreamUrl(e.target.value)}
        className="text-xs font-mono"
      />
      <Input
        placeholder={channelIdPlaceholders[destination.platform] || 'Channel identifier (optional)'}
        value={channelId}
        onChange={e => setChannelId(e.target.value)}
        className="text-xs"
      />
      {error && (
        <p className="text-[11px] text-destructive">Could not save changes — try again.</p>
      )}
      <div className="flex gap-2">
        <Button size="sm" onClick={handleSave} disabled={saving} className="flex-1 gap-1.5">
          {saving && <Loader2 className="h-3 w-3 animate-spin" />}
          Save
        </Button>
        <Button size="sm" variant="outline" onClick={onDone} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * Universal Output — the primary way to broadcast. Links the user's OWN Livepush
 * account via one-click OAuth; the studio then pushes a single composite to their
 * Livepush ingest and Livepush fans it out to the 40+ platforms they've linked
 * inside Livepush. Rendered only when our Livepush app is configured server-side.
 */
function UniversalOutput({
  destination, onConnected,
}: {
  destination: Destination | undefined;
  onConnected: () => void;
}) {
  const { addDestination, removeDestination, toggleDestination } = useStudio();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The user's Livepush destinations (the per-platform fan-out targets).
  const [platforms, setPlatforms] = useState<LivepushDestination[]>([]);
  const [loadingPlatforms, setLoadingPlatforms] = useState(false);
  // Destination ids with an in-flight enable/disable call.
  const [pending, setPending] = useState<Set<string>>(new Set());
  // Does THIS browser hold the Livepush OAuth session yet? Seeded from
  // localStorage, then confirmed after hydrating from the account (so a fresh
  // computer restores the link instead of showing "No platforms linked yet").
  const [hasToken, setHasToken] = useState(!!getStoredLivepushConnection()?.accessToken);

  const linked = !!destination && hasToken;

  const loadPlatforms = useCallback(async () => {
    if (!getStoredLivepushConnection()?.accessToken) return;
    setLoadingPlatforms(true);
    try {
      setPlatforms(await listLivepushDestinations());
    } finally {
      setLoadingPlatforms(false);
    }
  }, []);

  // On a new device the destination row syncs from the DB but the OAuth token
  // doesn't — restore it from the account so the platform list can load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const conn = await hydrateLivepushConnection();
      if (!cancelled && conn?.accessToken) setHasToken(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // Pull the real destination list once Livepush is linked.
  useEffect(() => {
    if (linked) loadPlatforms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linked]);

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);
    try {
      const r = await connectLivepush();
      await addDestination({
        platform: 'livepush',
        name: r.displayName,
        streamKey: r.streamKey,
        streamUrl: r.streamUrl,
        enabled: true,
      });
      setPlatforms(r.destinations);
      setHasToken(true);
      onConnected();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (destination) await removeDestination(destination.id);
    clearStoredLivepushConnection();
    setHasToken(false);
    setPlatforms([]);
  };

  // Optimistically flip a platform, reverting on API failure.
  const handleTogglePlatform = async (dest: LivepushDestination) => {
    const nextEnabled = dest.isDisabled; // enabling when currently disabled
    setError(null);
    setPending(prev => new Set(prev).add(dest.id));
    setPlatforms(prev => prev.map(d => (d.id === dest.id ? { ...d, isDisabled: !nextEnabled } : d)));
    try {
      await setLivepushDestinationEnabled(dest.id, nextEnabled);
    } catch (e) {
      // Revert.
      setPlatforms(prev => prev.map(d => (d.id === dest.id ? { ...d, isDisabled: dest.isDisabled } : d)));
      setError((e as Error).message);
    } finally {
      setPending(prev => {
        const next = new Set(prev);
        next.delete(dest.id);
        return next;
      });
    }
  };

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
      {!destination ? (
        <>
          <div className="flex items-start gap-2.5">
            <Globe className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-foreground">Universal Output</div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Stream to 40+ platforms at once. Sign in with your own Livepush
                account — your social logins stay entirely yours.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            onClick={handleConnect}
            disabled={connecting}
            className="w-full gap-2"
          >
            {connecting
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <PlatformIcon platform="livepush" className="h-3.5 w-3.5" />}
            Connect Livepush
          </Button>
          {error && <p className="text-[11px] text-destructive">{error}</p>}
        </>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <PlatformIcon platform="livepush" className="h-4 w-4 shrink-0" />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-foreground truncate">
                  {destination.name || 'Livepush'}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Universal Output · {platforms.length
                    ? `${platforms.filter(p => !p.isDisabled).length}/${platforms.length} platform${platforms.length > 1 ? 's' : ''} live`
                    : 'relays to your linked platforms'}
                </p>
              </div>
            </div>
            <Switch
              checked={destination.enabled}
              onCheckedChange={() => toggleDestination(destination.id)}
              title={destination.enabled ? 'Disable Universal Output' : 'Enable Universal Output'}
            />
          </div>

          {/* Per-platform toggles — choose which social platforms go live. */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-muted-foreground">
                Broadcast to
              </span>
              <button
                onClick={loadPlatforms}
                disabled={loadingPlatforms}
                title="Refresh platforms from Livepush"
                className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`h-3 w-3 ${loadingPlatforms ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {loadingPlatforms && platforms.length === 0 ? (
              <p className="text-[11px] text-muted-foreground py-1">Loading platforms…</p>
            ) : platforms.length === 0 ? (
              <p className="text-[11px] text-muted-foreground py-1">
                No platforms linked yet — add them on Livepush, then refresh.
              </p>
            ) : (
              <div className="space-y-1">
                {platforms.map(p => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-2 rounded-md bg-background/60 px-2 py-1.5"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <PlatformIcon platform={p.appName} className="h-3.5 w-3.5 shrink-0" />
                      <span className="text-[12px] text-foreground truncate">{p.label}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {pending.has(p.id) && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                      <Switch
                        checked={!p.isDisabled}
                        disabled={pending.has(p.id)}
                        onCheckedChange={() => handleTogglePlatform(p)}
                        title={p.isDisabled ? `Stream to ${p.label}` : `Stop streaming to ${p.label}`}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {error && <p className="text-[11px] text-destructive">{error}</p>}
          </div>

          <div className="flex items-center justify-between pt-0.5">
            <a
              href={LIVEPUSH_DASHBOARD_URL}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-primary hover:underline inline-flex items-center gap-1"
            >
              Manage on Livepush <ExternalLink className="h-3 w-3" />
            </a>
            <button
              onClick={handleDisconnect}
              className="text-[11px] text-muted-foreground hover:text-destructive transition-colors"
            >
              Disconnect
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function StreamDestinations() {
  const {
    destinations, addDestination, removeDestination, toggleDestination,
  } = useStudio();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [platform, setPlatform] = useState('youtube');
  const [name, setName] = useState('');
  const [streamKey, setStreamKey] = useState('');
  const [streamUrl, setStreamUrl] = useState(defaultUrls.youtube);
  const [channelId, setChannelId] = useState('');
  // OAuth "Connect account" — which platforms are configured, + connect state
  const [providers, setProviders] = useState<ProviderMap>({ twitch: false, youtube: false, facebook: false });
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connectedName, setConnectedName] = useState<string | null>(null);
  // Facebook auto-publish: a connected Page token replaces the manual stream key.
  const [autoPublish, setAutoPublish] = useState(false);
  const [providerToken, setProviderToken] = useState<string | undefined>();
  const [providerAccountId, setProviderAccountId] = useState<string | undefined>();
  // Livepush "Universal Output" — is our developer app configured server-side?
  const [livepushConfigured, setLivepushConfigured] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => { getConnectProviders().then(setProviders); }, []);
  useEffect(() => { getLivepushConfigured().then(setLivepushConfigured); }, []);

  // Livepush owns the hero; every other destination lives in the Advanced list.
  const livepushDest = destinations.find(d => d.platform === 'livepush');
  const manualDests = destinations.filter(d => d.platform !== 'livepush');

  const resetConnectState = () => {
    setConnectError(null);
    setConnectedName(null);
    setAutoPublish(false);
    setProviderToken(undefined);
    setProviderAccountId(undefined);
  };

  const handleConnect = async () => {
    if (platform === 'custom') return;
    setConnecting(true);
    resetConnectState();
    try {
      const r = await connectPlatform(platform as ConnectPlatform);
      if (!name.trim()) setName(r.display_name);
      setStreamKey(r.stream_key);
      if (r.stream_url) setStreamUrl(r.stream_url);
      if (r.platform_channel_id) setChannelId(r.platform_channel_id);
      setConnectedName(r.display_name);
      // Auto-publish (Facebook): store the Page token; no manual key needed.
      if (r.auto_publish) {
        setAutoPublish(true);
        setProviderToken(r.provider_token);
        setProviderAccountId(r.provider_account_id);
      }
    } catch (e) {
      setConnectError((e as Error).message);
    } finally {
      setConnecting(false);
    }
  };

  const handleAdd = () => {
    // Auto-publish destinations authenticate with a Page token, not a key.
    if (!name.trim() || (!autoPublish && !streamKey.trim())) return;
    addDestination({
      platform, name,
      streamKey: autoPublish ? '' : streamKey,
      streamUrl: streamUrl || defaultUrls[platform],
      enabled: true,
      platformChannelId: channelId.trim() || undefined,
      providerToken: autoPublish ? providerToken : undefined,
      providerAccountId: autoPublish ? providerAccountId : undefined,
    });
    setShowForm(false);
    setName('');
    setStreamKey('');
    setStreamUrl(defaultUrls.youtube);
    setPlatform('youtube');
    setChannelId('');
    resetConnectState();
  };

  const enabledCount = manualDests.filter(d => d.enabled).length;
  const allEnabled = manualDests.length > 0 && enabledCount === manualDests.length;
  // Simulcast master toggle for the manual/direct destinations (Livepush already
  // fans out on its own, so it's controlled separately in the hero).
  const setAllManualEnabled = (enabled: boolean) =>
    Promise.all(manualDests.filter(d => d.enabled !== enabled).map(d => toggleDestination(d.id)));

  // Livepush relays to its own linked platforms; enabling direct destinations at
  // the same time sends the composite twice.
  const doubleStream = !!livepushDest?.enabled && manualDests.some(d => d.enabled);

  const manualSection = (
    <div className="space-y-4">
      {/* Simulcast master toggle — flips every direct destination at once */}
      <div className="flex items-center justify-between rounded-lg border border-border bg-secondary/40 px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            <Radio className="h-3.5 w-3.5 text-primary shrink-0" /> Simulcast
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {manualDests.length === 0
              ? 'Add direct RTMP destinations to broadcast to them at once'
              : allEnabled
                ? `Broadcasting to all ${manualDests.length} destination${manualDests.length > 1 ? 's' : ''}`
                : `${enabledCount} of ${manualDests.length} destinations active`}
          </p>
        </div>
        <Switch
          checked={allEnabled}
          onCheckedChange={() => setAllManualEnabled(!allEnabled)}
          disabled={manualDests.length === 0}
          title={allEnabled ? 'Turn off all destinations' : 'Enable all destinations'}
        />
      </div>

      {manualDests.length === 0 && !showForm && (
        <div className="text-center py-6">
          <Share className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No direct destinations configured</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Add platforms to stream to</p>
        </div>
      )}

      {manualDests.map(dest => (
        <div key={dest.id} className="bg-secondary/40 rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <PlatformIcon platform={dest.platform} className="h-4 w-4 shrink-0" />
              <span className="text-sm font-medium text-foreground truncate">{dest.name}</span>
              {dest.autoPublish && (
                <span className="shrink-0 text-[9px] uppercase tracking-wider font-semibold text-success bg-success/10 border border-success/30 rounded px-1.5 py-0.5">
                  Auto-post
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={dest.enabled}
                onCheckedChange={() => toggleDestination(dest.id)}
              />
              <button
                onClick={() => setEditingId(editingId === dest.id ? null : dest.id)}
                className={`p-1 rounded transition-colors ${
                  editingId === dest.id
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                title={`Edit ${dest.name}`}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button
                    className="p-1 rounded text-muted-foreground hover:text-destructive transition-colors"
                    title={`Remove ${dest.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Remove destination?</AlertDialogTitle>
                    <AlertDialogDescription>
                      "{dest.name}" and its stream key will be permanently deleted.
                      You'll need to re-enter the key to stream here again.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => removeDestination(dest.id)}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Remove
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground font-mono truncate">{dest.streamUrl}</p>
          {dest.platformChannelId && (
            <p className="text-[11px] text-muted-foreground/60 truncate flex items-center gap-1">
              <BarChart3 className="h-3 w-3 shrink-0" /> {dest.platformChannelId}
            </p>
          )}
          {editingId === dest.id && (
            <EditDestinationForm
              destination={dest}
              onDone={() => setEditingId(null)}
            />
          )}
        </div>
      ))}

      {showForm ? (
        <div className="border border-border rounded-lg p-3 space-y-3 animate-fade-in">
          <div className="grid grid-cols-2 gap-1.5">
            {(['youtube', 'twitch', 'facebook', 'custom'] as const).map(p => (
              <button
                key={p}
                onClick={() => { setPlatform(p); setStreamUrl(defaultUrls[p]); resetConnectState(); }}
                className={`text-xs py-2 rounded-md transition-colors capitalize font-medium flex items-center justify-center gap-1.5 ${
                  platform === p
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                }`}
              >
                <PlatformIcon platform={p} className="h-3.5 w-3.5" /> {p}
              </button>
            ))}
          </div>

          {/* One-click Connect — auto-fetches the stream key (when configured) */}
          {platform !== 'custom' && providers[platform as ConnectPlatform] && (
            <div className="space-y-1.5">
              <Button
                size="sm"
                variant="secondary"
                onClick={handleConnect}
                disabled={connecting}
                className="w-full gap-2 capitalize"
              >
                {connecting
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <PlatformIcon platform={platform} className="h-3.5 w-3.5" />}
                Connect {platform}
              </Button>
              {connectedName && (
                <p className="text-[11px] text-success">
                  {autoPublish
                    ? `Connected to ${connectedName} — going live will auto-post to this Page. No stream key needed.`
                    : `Connected as ${connectedName} — stream key filled in below.`}
                </p>
              )}
              {connectError && (
                <p className="text-[11px] text-destructive">{connectError}</p>
              )}
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground/50 uppercase tracking-wider">
                <span className="h-px flex-1 bg-border" /> or enter manually <span className="h-px flex-1 bg-border" />
              </div>
            </div>
          )}

          <Input
            placeholder="Display name"
            value={name}
            onChange={e => setName(e.target.value)}
            className="text-sm"
          />
          {autoPublish ? (
            <div className="rounded-md border border-success/30 bg-success/10 px-2.5 py-2 flex items-center gap-1.5">
              <Radio className="h-3.5 w-3.5 text-success shrink-0" />
              <p className="text-[11px] text-success">
                Auto-post enabled — no stream key required.
              </p>
            </div>
          ) : (
            <Input
              placeholder="Stream key"
              type="password"
              value={streamKey}
              onChange={e => setStreamKey(e.target.value)}
              className="text-sm"
            />
          )}
          {!autoPublish && (
            <Input
              placeholder="RTMP URL"
              value={streamUrl}
              onChange={e => setStreamUrl(e.target.value)}
              className="text-xs font-mono"
            />
          )}
          <div className="border-t border-border pt-2">
            <label className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium mb-1 block">
              Viewer Analytics (optional)
            </label>
            <Input
              placeholder={channelIdPlaceholders[platform]}
              value={channelId}
              onChange={e => setChannelId(e.target.value)}
              className="text-xs"
            />
            <p className="text-[11px] text-muted-foreground/60 mt-1">
              Used to show real-time viewer counts during streams
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleAdd} className="flex-1">Add</Button>
            <Button size="sm" variant="outline" onClick={() => { setShowForm(false); resetConnectState(); }}>Cancel</Button>
          </div>
        </div>
      ) : (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setShowForm(true)}
          className="w-full gap-2"
        >
          <Plus className="h-3.5 w-3.5" /> Add Destination
        </Button>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      {livepushConfigured && (
        <UniversalOutput
          destination={livepushDest}
          onConnected={() => setShowAdvanced(false)}
        />
      )}

      {doubleStream && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 flex items-start gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
          <p className="text-[11px] text-amber-600 dark:text-amber-400">
            Livepush already relays to your linked platforms and direct destinations
            below are also on — your stream will be sent twice. Disable one to avoid
            duplicates.
          </p>
        </div>
      )}

      <StreamStatusPanel />

      {/* Direct RTMP destinations. When Livepush is available this is the advanced
          fallback, collapsed by default; otherwise it's the main destinations UI. */}
      {livepushConfigured ? (
        <div className="rounded-lg border border-border">
          <button
            onClick={() => setShowAdvanced(v => !v)}
            className="w-full flex items-center justify-between px-3 py-2.5 text-left"
          >
            <div>
              <div className="text-sm font-medium text-foreground">Advanced — direct RTMP</div>
              <p className="text-[11px] text-muted-foreground">
                Add individual platform stream keys{manualDests.length ? ` · ${manualDests.length} set up` : ''}
              </p>
            </div>
            <ChevronDown
              className={`h-4 w-4 text-muted-foreground transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
            />
          </button>
          {showAdvanced && <div className="p-3 pt-0">{manualSection}</div>}
        </div>
      ) : (
        manualSection
      )}
    </div>
  );
}
