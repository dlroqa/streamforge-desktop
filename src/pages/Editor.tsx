import { useEffect } from 'react';
import { EditorApp } from '@/components/editor/EditorApp';
import { trackActivity } from '@/lib/userActivity';

/** Standalone video editor, opened in its own window from Pro Control. Does not
 * mount the heavy StudioProvider — it reads recordings directly. */
export default function Editor() {
  useEffect(() => { trackActivity('Video Editor'); }, []);
  return <EditorApp />;
}
