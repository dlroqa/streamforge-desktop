import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { Destination } from '@/contexts/StudioContext';

interface ApiDestination {
  id: string;
  platform: string;
  name: string;
  stream_url: string;
  enabled: boolean;
  platform_channel_id?: string;
  provider_account_id?: string; // present = Facebook auto-publish connected
  created_at: string;
  updated_at: string;
}

function toDestination(row: ApiDestination): Destination {
  return {
    id: row.id,
    platform: row.platform,
    name: row.name,
    streamKey: '••••••••', // Stream keys are never returned to the client
    streamUrl: row.stream_url,
    enabled: row.enabled,
    platformChannelId: row.platform_channel_id || undefined,
    // Page token stays server-side; the id flags auto-publish for the UI.
    autoPublish: !!row.provider_account_id,
    providerAccountId: row.provider_account_id || undefined,
  };
}

export function useStreamDestinations() {
  const { user } = useAuth();
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDestinations = useCallback(async () => {
    if (!user) {
      setDestinations([]);
      setLoading(false);
      return;
    }
    try {
      const { data, error } = await supabase.functions.invoke('manage-destinations', {
        body: { action: 'list' },
      });

      if (error) {
        if (import.meta.env.DEV) console.error('Failed to fetch destinations:', error);
        return;
      }

      setDestinations((data?.destinations || []).map(toDestination));
    } catch (err) {
      if (import.meta.env.DEV) console.error('Destination fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchDestinations();
  }, [fetchDestinations]);

  const addDestination = useCallback(async (d: Omit<Destination, 'id'>) => {
    if (!user) return;

    const { data, error } = await supabase.functions.invoke('manage-destinations', {
      body: {
        action: 'add',
        platform: d.platform,
        name: d.name,
        stream_key: d.streamKey,
        stream_url: d.streamUrl,
        enabled: d.enabled,
        platform_channel_id: d.platformChannelId || null,
        // Facebook auto-publish: server encrypts the Page token, never returns it.
        provider_token: d.providerToken || null,
        provider_account_id: d.providerAccountId || null,
      },
    });

    if (error) {
      if (import.meta.env.DEV) console.error('Failed to add destination:', error);
      return;
    }

    if (data?.destination) {
      setDestinations(prev => [...prev, toDestination(data.destination)]);
    }
  }, [user]);

  const updateDestination = useCallback(async (
    id: string,
    patch: { name: string; streamUrl: string; platformChannelId?: string; streamKey?: string },
  ): Promise<boolean> => {
    const { data, error } = await supabase.functions.invoke('manage-destinations', {
      body: {
        action: 'update',
        id,
        name: patch.name,
        stream_url: patch.streamUrl,
        platform_channel_id: patch.platformChannelId || '',
        // Blank = keep the existing key (keys are write-only)
        stream_key: patch.streamKey || '',
      },
    });

    if (error || !data?.destination) {
      if (import.meta.env.DEV) console.error('Failed to update destination:', error || data);
      return false;
    }

    setDestinations(prev =>
      prev.map(d => d.id === id ? toDestination(data.destination) : d)
    );
    return true;
  }, []);

  const removeDestination = useCallback(async (id: string) => {
    const { error } = await supabase.functions.invoke('manage-destinations', {
      body: { action: 'delete', id },
    });

    if (error) {
      if (import.meta.env.DEV) console.error('Failed to remove destination:', error);
      return;
    }

    setDestinations(prev => prev.filter(d => d.id !== id));
  }, []);

  const toggleDestination = useCallback(async (id: string) => {
    const { data, error } = await supabase.functions.invoke('manage-destinations', {
      body: { action: 'toggle', id },
    });

    if (error) {
      if (import.meta.env.DEV) console.error('Failed to toggle destination:', error);
      return;
    }

    if (data?.success) {
      setDestinations(prev =>
        prev.map(d => d.id === id ? { ...d, enabled: data.enabled } : d)
      );
    }
  }, []);

  // Simulcast master control: flip every destination that isn't already at the
  // target state, reusing the per-destination toggle (no new backend action).
  const setAllDestinationsEnabled = useCallback(async (enabled: boolean) => {
    const targets = destinations.filter(d => d.enabled !== enabled);
    await Promise.all(targets.map(d => toggleDestination(d.id)));
  }, [destinations, toggleDestination]);

  return {
    destinations,
    loading,
    addDestination,
    updateDestination,
    removeDestination,
    toggleDestination,
    setAllDestinationsEnabled,
  };
}
