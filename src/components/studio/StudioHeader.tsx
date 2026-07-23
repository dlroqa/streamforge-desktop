import { useStudio } from '@/contexts/StudioContext';
import { useAuth, displayNameOf } from '@/contexts/AuthContext';
import { Sun, Moon, Radio, LogOut, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { AccountSettings, useAvatar } from './AccountSettings';

export function StudioHeader() {
  const {
    themeMode, toggleTheme, isLive, isRecording, isBackstage,
  } = useStudio();
  const { signOut, user } = useAuth();
  const navigate = useNavigate();
  const avatar = useAvatar();
  const [elapsed, setElapsed] = useState(0);
  const [accountOpen, setAccountOpen] = useState(false);

  useEffect(() => {
    if (!isLive && !isRecording) {
      setElapsed(0);
      return;
    }
    const interval = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(interval);
  }, [isLive, isRecording]);

  const formatTime = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <header className="h-14 border-b border-border bg-card flex items-center justify-between px-5 shrink-0">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
            <Radio className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="font-bold text-foreground tracking-tight text-lg">StreamForge</span>
        </div>

        {isLive && (
          <div className="flex items-center gap-2 ml-2">
            <span className="h-2 w-2 rounded-full bg-live animate-pulse-live" />
            <span className="text-xs font-mono font-bold text-live tracking-wider">LIVE</span>
          </div>
        )}

        {!isLive && isBackstage && (
          <div className="flex items-center gap-2 ml-2 rounded-full bg-primary/10 border border-primary/30 px-2.5 py-1">
            <Users className="h-3 w-3 text-primary" />
            <span className="text-xs font-mono font-bold text-primary tracking-wider">BACKSTAGE</span>
          </div>
        )}

        {(isLive || isRecording) && (
          <span className="text-xs font-mono text-muted-foreground tabular-nums">
            {formatTime(elapsed)}
          </span>
        )}
      </div>

      <div className="flex items-center gap-3">
        {user && (
          <button
            onClick={() => setAccountOpen(true)}
            className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-secondary transition-colors group"
            title="Account settings"
          >
            <Avatar className="h-6 w-6">
              {avatar && <AvatarImage src={avatar} alt="Profile" />}
              <AvatarFallback className="bg-primary/15 text-primary text-[10px] font-semibold">
                {(displayNameOf(user) || user.email || '?').slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="text-xs text-muted-foreground group-hover:text-foreground hidden sm:inline truncate max-w-[140px]">
              {displayNameOf(user) || user.email}
            </span>
          </button>
        )}
        {user && (
          <AccountSettings open={accountOpen} onOpenChange={setAccountOpen} email={user.email ?? ''} />
        )}

        <button
          onClick={toggleTheme}
          className="p-2 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
          title={themeMode === 'night' ? 'Switch to Day' : 'Switch to Night'}
        >
          {themeMode === 'night' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>

        <button
          onClick={async () => { await signOut(); navigate('/auth'); }}
          className="p-2 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
          title="Sign out"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
