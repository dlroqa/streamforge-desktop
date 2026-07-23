import { useStudio } from '@/contexts/StudioContext';
import { createGuestInvite } from '@/lib/streamApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { UserPlus, Copy, Check, UserX, Loader2, Video, VideoOff, Users, DoorOpen } from 'lucide-react';
import { useState } from 'react';
import { BACKSTAGE_BRIEF_MAX } from '@/lib/backstageBrief';

export function GuestsPanel() {
  const {
    guests, ejectGuest,
    isLive, isBackstage, isEnteringBackstage, enterWaitingRoom, leaveWaitingRoom,
    backstageBrief, setBackstageBrief,
  } = useStudio();
  const { toast } = useToast();
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCreateInvite = async () => {
    const email = guestEmail.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast({ title: 'Invalid email', description: 'Enter a valid email or leave it blank.', variant: 'destructive' });
      return;
    }
    setCreating(true);
    setCopied(false);
    try {
      const result = await createGuestInvite({
        guestName: guestName.trim() || undefined,
        email: email || undefined,
      });
      if (result.success && result.join_url) {
        setInviteUrl(result.join_url);
        setGuestName('');
        setGuestEmail('');
        toast({
          title: result.emailed ? 'Invite sent' : 'Invite link ready',
          description: result.emailed
            ? `We emailed the invite to ${email}.`
            : 'Copy the link below and send it to your guest.',
        });
      } else {
        toast({
          title: 'Could not create invite',
          description: result.error || 'Please try again',
          variant: 'destructive',
        });
      }
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: 'Copy failed', description: 'Select and copy the link manually', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4">
      {/* Waiting room — join invited guests to prep (camera, audio, slides,
          chat) before broadcasting. Enter/leave also available from the header. */}
      <div className="border border-border rounded-lg p-3 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs font-semibold text-foreground">Waiting room</span>
          </div>
          {isBackstage && !isLive && (
            <span className="text-[10px] font-mono font-bold text-primary uppercase tracking-wider">Backstage</span>
          )}
        </div>
        {!isLive && (
          isBackstage ? (
            <Button size="sm" variant="outline" onClick={leaveWaitingRoom} className="w-full gap-2">
              <DoorOpen className="h-3.5 w-3.5" /> Leave Waiting Room
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={enterWaitingRoom} disabled={isEnteringBackstage} className="w-full gap-2">
              {isEnteringBackstage ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Users className="h-3.5 w-3.5" />}
              Enter Waiting Room
            </Button>
          )
        )}
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">Topic / agenda</label>
          <Textarea
            value={backstageBrief}
            onChange={e => setBackstageBrief(e.target.value.slice(0, BACKSTAGE_BRIEF_MAX))}
            placeholder="Brief your guests — the topic, running order, talking points…"
            className="text-sm min-h-[88px] resize-y"
            maxLength={BACKSTAGE_BRIEF_MAX}
          />
          <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
            Guests see this live in their waiting room{isBackstage || isLive ? '' : ' once you enter the waiting room or go live'}.
          </p>
        </div>
      </div>

      {/* Invite creation — works before AND during the stream (green room) */}
      <div className="space-y-2">
        <Input
          placeholder="Guest name (optional)"
          value={guestName}
          onChange={e => setGuestName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !creating && handleCreateInvite()}
          className="text-sm"
          maxLength={40}
        />
        <Input
          type="email"
          placeholder="Guest email (optional — we'll email the invite)"
          value={guestEmail}
          onChange={e => setGuestEmail(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !creating && handleCreateInvite()}
          className="text-sm"
          maxLength={254}
        />
        <Button
          size="sm"
          onClick={handleCreateInvite}
          disabled={creating}
          className="w-full gap-2"
        >
          {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
          {guestEmail.trim() ? 'Send Invite' : 'Create Invite Link'}
        </Button>
      </div>

      {inviteUrl && (
        <div className="border border-border rounded-lg p-3 space-y-2 animate-fade-in">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">Invite link</p>
          <p className="text-xs text-foreground font-mono break-all leading-relaxed">{inviteUrl}</p>
          <Button size="sm" variant="outline" onClick={handleCopy} className="w-full gap-2">
            {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied!' : 'Copy Link'}
          </Button>
        </div>
      )}

      <p className="text-xs text-muted-foreground leading-relaxed">
        Invite guests before or during your stream. They open the link, land in a
        studio green room, allow camera and mic, and appear on the broadcast as a
        tile. Up to 7 guests.
      </p>

      {/* Scene layout (Split / PiP / Solo) lives on the video preview itself as a
          floating rail on the right edge — see StageLayoutRail in VideoPreview. */}

      {/* Joined guests */}
      <div className="border-t border-border pt-4 space-y-2">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          On stream ({guests.length})
        </h3>
        {guests.length === 0 ? (
          <p className="text-xs text-muted-foreground/60 py-2">No guests have joined yet</p>
        ) : (
          guests.map(guest => (
            <div
              key={guest.sessionId}
              className="flex items-center gap-2 bg-secondary/40 rounded-lg px-3 py-2"
            >
              {guest.videoTrack ? (
                <Video className="h-3.5 w-3.5 text-success shrink-0" />
              ) : (
                <VideoOff className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              )}
              <span className="text-sm text-foreground truncate flex-1">{guest.userName}</span>
              <button
                onClick={() => ejectGuest(guest.sessionId)}
                className="p-1 rounded text-muted-foreground hover:text-destructive transition-colors"
                title={`Remove ${guest.userName}`}
              >
                <UserX className="h-3.5 w-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
