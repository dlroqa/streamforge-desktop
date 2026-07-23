import { useStudio } from '@/contexts/StudioContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Play, Pause, Trash2 } from 'lucide-react';
import { useState } from 'react';

export function PollPanel() {
  const { polls, addPoll, togglePoll, votePoll, removePoll } = useStudio();
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);

  const handleCreate = () => {
    const validOptions = options.filter(o => o.trim());
    if (!question.trim() || validOptions.length < 2) return;
    addPoll(question, validOptions);
    setQuestion('');
    setOptions(['', '']);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <Input
          placeholder="Poll question"
          value={question}
          onChange={e => setQuestion(e.target.value)}
          className="text-sm"
        />
        {options.map((opt, i) => (
          <Input
            key={i}
            placeholder={`Option ${i + 1}`}
            value={opt}
            onChange={e => {
              const next = [...options];
              next[i] = e.target.value;
              setOptions(next);
            }}
            className="text-sm"
          />
        ))}
        <div className="flex gap-2">
          {options.length < 4 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setOptions([...options, ''])}
              className="gap-1 text-xs"
            >
              <Plus className="h-3 w-3" /> Option
            </Button>
          )}
          <Button size="sm" onClick={handleCreate} className="flex-1 text-xs">
            Create Poll
          </Button>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Active polls appear on the broadcast. Ask viewers to vote in chat,
          then tally their votes below.
        </p>
      </div>

      {polls.length > 0 && (
        <div className="border-t border-border pt-4 space-y-3">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Active Polls</h3>
          {polls.map(poll => {
            const total = poll.options.reduce((s, o) => s + o.votes, 0);
            return (
              <div key={poll.id} className="bg-secondary/40 rounded-lg p-3 space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-foreground leading-snug">{poll.question}</p>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant={poll.active ? 'destructive' : 'secondary'}
                      onClick={() => togglePoll(poll.id)}
                      className="h-7 w-7 p-0"
                      title={poll.active ? 'Take off stream' : 'Show on stream'}
                    >
                      {poll.active ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                    </Button>
                    <button
                      onClick={() => removePoll(poll.id)}
                      className="p-1.5 rounded text-muted-foreground hover:text-destructive transition-colors"
                      title="Delete poll"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {poll.options.map((opt, i) => {
                  const pct = total > 0 ? (opt.votes / total) * 100 : 0;
                  return (
                    <div key={i} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-foreground">{opt.text}</span>
                        <span className="text-muted-foreground font-mono">
                          {opt.votes} ({Math.round(pct)}%)
                        </span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
                {poll.active && (
                  <div className="pt-1 space-y-1">
                    <p className="text-[11px] text-muted-foreground">Tally votes from chat:</p>
                    <div className="flex gap-1">
                      {poll.options.map((opt, i) => (
                        <Button
                          key={i}
                          size="sm"
                          variant="outline"
                          onClick={() => votePoll(poll.id, i)}
                          className="text-[11px] flex-1 h-7"
                        >
                          +1 {opt.text}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
