import { useStudio } from '@/contexts/StudioContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Star, MessageCircle } from 'lucide-react';
import { useState } from 'react';

export function QAPanel() {
  const { questions, addQuestion, highlightQuestion } = useStudio();
  const [author, setAuthor] = useState('');
  const [newQuestion, setNewQuestion] = useState('');

  const handleAdd = () => {
    if (!newQuestion.trim()) return;
    addQuestion({
      author: author.trim() || 'Viewer',
      platform: 'Chat',
      text: newQuestion.trim(),
    });
    setNewQuestion('');
    setAuthor('');
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Input
          placeholder="Viewer name (optional)"
          value={author}
          onChange={e => setAuthor(e.target.value)}
          className="text-sm"
        />
        <div className="flex gap-2">
          <Input
            placeholder="Question from your chat…"
            value={newQuestion}
            onChange={e => setNewQuestion(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            className="text-sm"
          />
          <Button size="sm" onClick={handleAdd} className="px-3 shrink-0">
            <MessageCircle className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">
        Copy questions from your platform chats here, then click one to show it
        on the broadcast.
      </p>

      <div className="space-y-2">
        {questions.map(q => (
          <button
            key={q.id}
            onClick={() => highlightQuestion(q.id)}
            className={`w-full text-left p-3 rounded-lg border transition-all duration-150 ${
              q.highlighted
                ? 'border-primary bg-primary/10 shadow-md'
                : 'border-border bg-secondary/30 hover:bg-secondary/50'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-foreground">{q.author}</span>
              {q.highlighted && <Star className="h-3 w-3 text-accent fill-accent" />}
            </div>
            <p className="text-sm text-foreground leading-snug">{q.text}</p>
          </button>
        ))}
      </div>

      {questions.length === 0 && (
        <div className="text-center py-6">
          <MessageCircle className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No questions yet</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Add questions from your chat to feature them on stream
          </p>
        </div>
      )}
    </div>
  );
}
