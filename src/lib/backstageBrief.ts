// "Backstage brief" — the shared topic/agenda note the host writes in the
// waiting room and every guest sees live. Like Forge Chat it rides Daily's
// app-message channel (peer-to-peer, no backend), so it needs no DB table: the
// host broadcasts the current text on change and re-broadcasts it whenever a
// guest joins, so late arrivals catch up.

/** app-message discriminator + wire shape sent via Daily sendAppMessage. */
export const BACKSTAGE_BRIEF_TYPE = 'backstage-brief';

/** Cap so a runaway paste can't flood the data channel. */
export const BACKSTAGE_BRIEF_MAX = 2000;

export interface BackstageBriefWire {
  t: typeof BACKSTAGE_BRIEF_TYPE;
  /** The full agenda text (empty string clears it on the guest side). */
  text: string;
  /** ms epoch of the last edit — guests keep the newest, ignoring stragglers. */
  updatedAt: number;
}

export function isBackstageBriefWire(data: unknown): data is BackstageBriefWire {
  return !!data && typeof data === 'object'
    && (data as { t?: unknown }).t === BACKSTAGE_BRIEF_TYPE
    && typeof (data as BackstageBriefWire).text === 'string'
    && typeof (data as BackstageBriefWire).updatedAt === 'number';
}
