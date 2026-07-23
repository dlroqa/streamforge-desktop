-- Cloud media sync: move the Media Library "Excerpts", the Video Editor project,
-- and the editor's uploaded assets from device-local storage (IndexedDB /
-- localStorage) to per-user server storage so they follow the user across
-- devices. Mirrors the existing `recordings` table + bucket pattern.

-- ── Excerpts: edited videos exported from the Video Editor into the Media Library ──
CREATE TABLE public.excerpts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL DEFAULT 'Excerpt',
  mime TEXT NOT NULL DEFAULT 'video/webm',
  size BIGINT NOT NULL DEFAULT 0,
  duration DOUBLE PRECISION NOT NULL DEFAULT 0,
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  storage_path TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.excerpts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own excerpts"
ON public.excerpts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own excerpts"
ON public.excerpts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own excerpts"
ON public.excerpts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own excerpts"
ON public.excerpts FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_excerpts_updated_at
BEFORE UPDATE ON public.excerpts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Editor project: one autosaved timeline per user (the whole project JSON) ──
CREATE TABLE public.editor_projects (
  user_id UUID NOT NULL PRIMARY KEY,
  project JSONB NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.editor_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own editor project"
ON public.editor_projects FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own editor project"
ON public.editor_projects FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own editor project"
ON public.editor_projects FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own editor project"
ON public.editor_projects FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_editor_projects_updated_at
BEFORE UPDATE ON public.editor_projects
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Editor small JSON state (e.g. the Media Bin list), keyed per user + key ──
CREATE TABLE public.editor_meta (
  user_id UUID NOT NULL,
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

ALTER TABLE public.editor_meta ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own editor meta"
ON public.editor_meta FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own editor meta"
ON public.editor_meta FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own editor meta"
ON public.editor_meta FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own editor meta"
ON public.editor_meta FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_editor_meta_updated_at
BEFORE UPDATE ON public.editor_meta
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Storage buckets (private; first path segment must be the owner's uid) ──
INSERT INTO storage.buckets (id, name, public)
VALUES ('excerpts', 'excerpts', false) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public)
VALUES ('editor-assets', 'editor-assets', false) ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users can upload own excerpt files"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'excerpts' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can view own excerpt files"
ON storage.objects FOR SELECT
USING (bucket_id = 'excerpts' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can delete own excerpt files"
ON storage.objects FOR DELETE
USING (bucket_id = 'excerpts' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can upload own editor assets"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'editor-assets' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can view own editor assets"
ON storage.objects FOR SELECT
USING (bucket_id = 'editor-assets' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can delete own editor assets"
ON storage.objects FOR DELETE
USING (bucket_id = 'editor-assets' AND auth.uid()::text = (storage.foldername(name))[1]);
