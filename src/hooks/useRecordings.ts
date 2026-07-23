import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {
  saveLocalRecording, persistLocalHandle, cacheLocalBlob, deleteLocalHandle,
} from '@/lib/localRecordings';
import * as drive from '@/lib/googleDrive';
import { isDriveActive, isDriveLocator, driveFileId, driveLocator } from '@/lib/userStorage';

export type RecordingMode = 'local' | 'cloud' | 'both';

export interface Recording {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  duration_seconds: number | null;
  file_size_bytes: number | null;
  storage_type: 'local' | 'cloud';
  storage_path: string | null;
  thumbnail_path: string | null;
  mime_type: string;
  status: string;
  created_at: string;
  updated_at: string;
}

type RecordingUpdate = Partial<Pick<Recording, 'status' | 'title'>>;
type InsertedRecording = Pick<Recording, 'id'>;

export function useRecordings() {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(false);
  const [recordingMode, setRecordingMode] = useState<RecordingMode>('local');
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);
  const { toast } = useToast();

  const fetchRecordings = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('recordings')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setRecordings((data as unknown as Recording[]) || []);
    } catch (err) {
      if (import.meta.env.DEV) console.error('Fetch recordings error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRecordings();
  }, [fetchRecordings]);

  const startRecording = useCallback((stream: MediaStream, title?: string) => {
    if (!stream) return;
    try {
      // Scale bitrate to the captured resolution (MediaRecorder's default
      // ~2.5 Mbps looks terrible above 720p)
      const height = stream.getVideoTracks()[0]?.getSettings().height ?? 720;
      const videoBitsPerSecond = height >= 2000 ? 25_000_000 : height >= 1000 ? 8_000_000 : 5_000_000;
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm', videoBitsPerSecond });
      recordedChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
        const duration = Math.round((Date.now() - startTimeRef.current) / 1000);
        const recordingTitle = title || `Event ${new Date().toLocaleString()}`;
        const wantsLocal = recordingMode === 'local' || recordingMode === 'both';
        const wantsCloud = recordingMode === 'cloud' || recordingMode === 'both';
        const suggestedName = `${recordingTitle.replace(/[^a-zA-Z0-9]/g, '_')}.webm`;

        if (!wantsCloud) {
          // Pure local: save via the File System Access picker when available
          // (do this FIRST, while the stop-click user gesture is still fresh)
          // so the library can reopen the file later. Falls back to a plain
          // download otherwise.
          const saved = await saveLocalRecording(blob, suggestedName);
          toast({
            title: '💾 Recording saved locally',
            description: `${saved.fileName} (${formatFileSize(blob.size)})${saved.viaPicker ? '' : ' — in your Downloads folder'}`,
          });

          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            const { data: row } = await supabase.from('recordings').insert({
              user_id: user.id,
              title: recordingTitle,
              duration_seconds: duration,
              file_size_bytes: blob.size,
              storage_type: 'local' as const,
              storage_path: saved.fileName, // filename for the library display
              status: 'ready' as const,
            } as never).select().single();
            const rowId = (row as { id?: string } | null)?.id;
            if (rowId) {
              cacheLocalBlob(rowId, blob);
              if (saved.handle) await persistLocalHandle(rowId, saved.handle);
            }
            fetchRecordings();
          }
        } else {
          if (wantsLocal) {
            // 'Both': plain download alongside the cloud upload (the cloud
            // copy is the playable library entry)
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = suggestedName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            toast({ title: '💾 Copy saved to device', description: suggestedName });
          }
          // Cloud upload (also the library row for 'both' — one entry, playable)
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) {
            toast({ title: 'Upload failed', description: 'You must be logged in', variant: 'destructive' });
            return;
          }

          // Route to the user's own Google Drive when they've opted in; the
          // Drive file id is stored as a `drive:` locator in storage_path, while
          // storage_type stays 'cloud' so the whole library treats it uniformly.
          if (await isDriveActive()) {
            toast({ title: '☁️ Uploading to your Google Drive...', description: recordingTitle });
            try {
              const fileId = await drive.uploadFile(blob, suggestedName);
              await supabase.from('recordings').insert({
                user_id: user.id,
                title: recordingTitle,
                duration_seconds: duration,
                file_size_bytes: blob.size,
                storage_type: 'cloud' as const,
                storage_path: driveLocator(fileId),
                status: 'ready' as const,
              } as never);
              toast({ title: '☁️ Recording saved to Drive!', description: `${recordingTitle} (${formatFileSize(blob.size)})` });
            } catch (err) {
              toast({ title: 'Upload failed', description: err instanceof Error ? err.message : 'Could not upload to Google Drive', variant: 'destructive' });
            }
            fetchRecordings();
            return;
          }

          const fileName = `${user.id}/${Date.now()}_${recordingTitle.replace(/[^a-zA-Z0-9]/g, '_')}.webm`;

          // Insert record as uploading
          const { data: record, error: insertError } = await supabase
            .from('recordings')
            .insert({
              user_id: user.id,
              title: recordingTitle,
              duration_seconds: duration,
              file_size_bytes: blob.size,
              storage_type: 'cloud' as const,
              storage_path: fileName,
              status: 'uploading' as const,
            } as never)
            .select()
            .single();

          if (insertError) {
            toast({ title: 'Recording failed', description: insertError.message, variant: 'destructive' });
            return;
          }

          toast({ title: '☁️ Uploading to cloud...', description: recordingTitle });

          const { error: uploadError } = await supabase.storage
            .from('recordings')
            .upload(fileName, blob, { contentType: 'video/webm' });

          if (uploadError) {
            await supabase.from('recordings').update({ status: 'error' } as RecordingUpdate as never).eq('id', (record as InsertedRecording).id);
            toast({ title: 'Upload failed', description: uploadError.message, variant: 'destructive' });
          } else {
            await supabase.from('recordings').update({ status: 'ready' } as RecordingUpdate as never).eq('id', (record as InsertedRecording).id);
            toast({ title: '☁️ Recording uploaded!', description: `${recordingTitle} (${formatFileSize(blob.size)})` });
          }
          fetchRecordings();
        }
      };
      recorder.start(1000);
      startTimeRef.current = Date.now();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch (err) {
      if (import.meta.env.DEV) console.error('Recording failed:', err);
      toast({ title: 'Recording failed', description: 'Could not start recording', variant: 'destructive' });
    }
  }, [recordingMode, toast, fetchRecordings]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }, [isRecording]);

  const deleteRecording = useCallback(async (id: string) => {
    const recording = recordings.find(r => r.id === id);
    if (!recording) return;

    if (recording.storage_type === 'cloud' && recording.storage_path) {
      if (isDriveLocator(recording.storage_path)) {
        await drive.deleteFile(driveFileId(recording.storage_path));
      } else {
        await supabase.storage.from('recordings').remove([recording.storage_path]);
      }
    }
    if (recording.storage_type === 'local') {
      // Forget the file handle/blob (the file itself stays on disk)
      await deleteLocalHandle(id);
    }

    await supabase.from('recordings').delete().eq('id', id);
    setRecordings(prev => prev.filter(r => r.id !== id));
    toast({ title: 'Recording deleted' });
  }, [recordings, toast]);

  const renameRecording = useCallback(async (id: string, title: string) => {
    const clean = title.trim().slice(0, 120);
    if (!clean) return;
    // Optimistic local update, then persist to the recordings table (this is
    // the same row the Studio Archive shows, so the new name follows it there).
    setRecordings(prev => prev.map(r => (r.id === id ? { ...r, title: clean } : r)));
    await supabase.from('recordings').update({ title: clean } as never).eq('id', id);
  }, []);

  const getCloudUrl = useCallback(async (storagePath: string): Promise<string | null> => {
    if (isDriveLocator(storagePath)) {
      return drive.getFileObjectUrl(driveFileId(storagePath));
    }
    const { data } = await supabase.storage
      .from('recordings')
      .createSignedUrl(storagePath, 3600);
    return data?.signedUrl || null;
  }, []);

  const uploadVideoFile = useCallback(async (file: File, title?: string): Promise<boolean> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast({ title: 'Upload failed', description: 'You must be logged in', variant: 'destructive' });
      return false;
    }

    const recordingTitle = title || file.name.replace(/\.[^/.]+$/, '');
    const ext = file.name.split('.').pop() || 'mp4';

    // Route to the user's own Google Drive when they've opted in.
    if (await isDriveActive()) {
      toast({ title: '☁️ Uploading to your Google Drive...', description: recordingTitle });
      try {
        const safe = recordingTitle.replace(/[^a-zA-Z0-9]/g, '_');
        const fileId = await drive.uploadFile(file, `${safe}.${ext}`);
        await supabase.from('recordings').insert({
          user_id: user.id,
          title: recordingTitle,
          file_size_bytes: file.size,
          storage_type: 'cloud' as const,
          storage_path: driveLocator(fileId),
          mime_type: file.type || 'video/mp4',
          status: 'ready' as const,
        } as never);
      } catch (err) {
        toast({ title: 'Upload failed', description: err instanceof Error ? err.message : 'Could not upload to Google Drive', variant: 'destructive' });
        return false;
      }
      toast({ title: '☁️ Video saved to Drive!', description: `${recordingTitle} (${formatFileSize(file.size)})` });
      fetchRecordings();
      return true;
    }

    const fileName = `${user.id}/${Date.now()}_${recordingTitle.replace(/[^a-zA-Z0-9]/g, '_')}.${ext}`;

    // Insert record as uploading
    const { data: record, error: insertError } = await supabase
      .from('recordings')
      .insert({
        user_id: user.id,
        title: recordingTitle,
        file_size_bytes: file.size,
        storage_type: 'cloud' as const,
        storage_path: fileName,
        mime_type: file.type || 'video/mp4',
        status: 'uploading' as const,
      } as never)
      .select()
      .single();

    if (insertError) {
      toast({ title: 'Upload failed', description: insertError.message, variant: 'destructive' });
      return false;
    }

    toast({ title: '☁️ Uploading video...', description: recordingTitle });

    const { error: uploadError } = await supabase.storage
      .from('recordings')
      .upload(fileName, file, { contentType: file.type || 'video/mp4' });

    if (uploadError) {
      await supabase.from('recordings').update({ status: 'error' } as RecordingUpdate as never).eq('id', (record as InsertedRecording).id);
      toast({ title: 'Upload failed', description: uploadError.message, variant: 'destructive' });
      return false;
    }

    await supabase.from('recordings').update({ status: 'ready' } as RecordingUpdate as never).eq('id', (record as InsertedRecording).id);
    toast({ title: '☁️ Video uploaded!', description: `${recordingTitle} (${formatFileSize(file.size)})` });
    fetchRecordings();
    return true;
  }, [toast, fetchRecordings]);

  return {
    recordings,
    loading,
    recordingMode,
    setRecordingMode,
    isRecording,
    startRecording,
    stopRecording,
    deleteRecording,
    renameRecording,
    getCloudUrl,
    fetchRecordings,
    uploadVideoFile,
  };
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
