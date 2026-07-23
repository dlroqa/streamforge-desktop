import { Zap, Radio } from 'lucide-react';

/** Brand icons for stream platforms (inline SVGs, currentColor-friendly). */
export function PlatformIcon({ platform, className = 'h-4 w-4' }: { platform: string; className?: string }) {
  switch (platform) {
    case 'youtube':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="#FF0000" aria-label="YouTube">
          <path d="M23.5 6.2a3 3 0 0 0-2.12-2.12C19.51 3.55 12 3.55 12 3.55s-7.51 0-9.38.53A3 3 0 0 0 .5 6.2 31.4 31.4 0 0 0 0 12a31.4 31.4 0 0 0 .5 5.8 3 3 0 0 0 2.12 2.12c1.87.53 9.38.53 9.38.53s7.51 0 9.38-.53a3 3 0 0 0 2.12-2.12A31.4 31.4 0 0 0 24 12a31.4 31.4 0 0 0-.5-5.8zM9.6 15.6V8.4l6.27 3.6-6.27 3.6z" />
        </svg>
      );
    case 'twitch':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="#9146FF" aria-label="Twitch">
          <path d="M11.57 4.71h1.71v5.14h-1.71V4.71zm4.72 0H18v5.14h-1.71V4.71zM4.29 0 0 4.29v15.42h5.14V24l4.29-4.29h3.43L20.57 12V0H4.29zm14.57 11.14-3.43 3.43h-3.43l-3 3v-3H5.14V1.71h13.72v9.43z" />
        </svg>
      );
    case 'facebook':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="#1877F2" aria-label="Facebook">
          <path d="M24 12a12 12 0 1 0-13.88 11.85v-8.38H7.08V12h3.04V9.36c0-3 1.79-4.67 4.53-4.67 1.31 0 2.68.24 2.68.24v2.95H15.8c-1.49 0-1.95.93-1.95 1.87V12h3.32l-.53 3.47h-2.79v8.38A12 12 0 0 0 24 12z" />
        </svg>
      );
    case 'livepush':
      // Livepush "universal output" — a broadcast/relay glyph (one-in, many-out).
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="#6D5EF8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Livepush">
          <circle cx="12" cy="12" r="2.5" fill="#6D5EF8" stroke="none" />
          <path d="M6.34 6.34a8 8 0 0 0 0 11.32M17.66 6.34a8 8 0 0 1 0 11.32M3.51 3.51a12 12 0 0 0 0 16.98M20.49 3.51a12 12 0 0 1 0 16.98" />
        </svg>
      );
    case 'tiktok':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-label="TikTok">
          <path d="M16.6 5.82a4.28 4.28 0 0 1-1.06-2.82h-3.09v12.4a2.59 2.59 0 0 1-2.59 2.5 2.59 2.59 0 1 1 .77-5.06V9.66a5.67 5.67 0 0 0-.77-.05 5.66 5.66 0 1 0 5.66 5.66V9.01a7.3 7.3 0 0 0 4.27 1.37V7.29a4.28 4.28 0 0 1-3.19-1.47z" />
        </svg>
      );
    case 'x':
    case 'twitter':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-label="X">
          <path d="M18.9 2.5h3.34l-7.3 8.34L23.5 21.5h-6.7l-5.25-6.86-6 6.86H2.2l7.8-8.92L1.9 2.5h6.87l4.75 6.28L18.9 2.5zm-1.17 17h1.85L7.36 4.4H5.38l12.35 15.1z" />
        </svg>
      );
    case 'linkedin':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="#0A66C2" aria-label="LinkedIn">
          <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.55V9h3.57v11.45zM22.22 0H1.77C.8 0 0 .78 0 1.75v20.5C0 23.22.8 24 1.77 24h20.45c.98 0 1.78-.78 1.78-1.75V1.75C24 .78 23.2 0 22.22 0z" />
        </svg>
      );
    case 'instagram':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="#E4405F" aria-label="Instagram">
          <path d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41a3.7 3.7 0 0 1-1.38-.9 3.7 3.7 0 0 1-.9-1.38c-.16-.42-.36-1.06-.41-2.23C2.17 15.58 2.16 15.2 2.16 12s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41C8.42 2.17 8.8 2.16 12 2.16zm0 3.68a6.16 6.16 0 1 0 0 12.32 6.16 6.16 0 0 0 0-12.32zm0 10.16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm7.84-10.4a1.44 1.44 0 1 1-2.88 0 1.44 1.44 0 0 1 2.88 0z" />
        </svg>
      );
    case 'custom':
      return <Zap className={`${className} text-accent`} aria-label="Custom RTMP" />;
    default:
      return <Radio className={`${className} text-muted-foreground`} aria-label={platform} />;
  }
}
