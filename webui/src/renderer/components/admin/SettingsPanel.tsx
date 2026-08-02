import React, { useCallback, useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import * as api from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { invalidateLibraryQueries } from '@/lib/queryClient';
import { useUiStore } from '@/store/uiStore';
import { Button } from '@/components/ui/button';
import { showToast } from '@/hooks/useToast';
import { ArrowLeft } from 'lucide-react';
import {
  AutoRescanSection,
  ConnectReaderSection,
  DangerZoneSection,
  GuestAccessSection,
  PairDeviceSection,
  TemporaryPasswordSection,
  ThemePickerSection,
} from './SettingsPanelSections';
import {
  PAIR_TOKEN_REFRESH_MS,
  THEME_LIST,
  autoRescanSavedMessage,
  buildPairPayload,
  clearLibraryRemovedMessage,
  pairOriginCandidates,
  pairOriginWarning,
  parseAutoRescanMinutes,
} from './settingsPanelHelpers';

interface SettingsPanelProps {
  onBack: () => void;
  onClose: () => void;
}

export default function SettingsPanel({ onBack, onClose }: SettingsPanelProps) {
  const queryClient = useQueryClient();
  const { theme: activeTheme, setTheme } = useUiStore();
  const { data: session } = useQuery({
    queryKey: ['session'],
    queryFn: api.getSession,
  });
  // Settings is visible to every signed-in user (for the theme picker), but the
  // guest-access, auto-rescan, and clear-library controls all hit requireAdmin
  // routes — hide them from non-admins instead of showing switches that 403.
  const isAdmin = session?.user?.isAdmin === true;

  // Temporary password state
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [clearingTempPass, setClearingTempPass] = useState(false);

  // Auto-rescan interval
  const [rescanInterval, setRescanInterval] = useState('0');
  const [savingRescan, setSavingRescan] = useState(false);

  // Clear library state
  const [clearingLibrary, setClearingLibrary] = useState(false);

  // --- Pair a device (QR) ---
  const [pairOrigins, setPairOrigins] = useState<string[]>([]);
  const [selectedPairOrigin, setSelectedPairOrigin] = useState('');
  const [pairQrDataUrl, setPairQrDataUrl] = useState<string | null>(null);
  const [pairError, setPairError] = useState<string | null>(null);
  const [pairRevealed, setPairRevealed] = useState(false);
  const pairRequestId = useRef(0);
  const pairMounted = useRef(true);

  useEffect(() => {
    pairMounted.current = true;
    return () => { pairMounted.current = false; };
  }, []);

  const currentOrigin = window.location.origin;

  useEffect(() => {
    api.fetchPairInfo()
      .then(({ origins }) => {
        if (!pairMounted.current) return;
        const candidates = pairOriginCandidates(origins, currentOrigin);
        setPairOrigins(candidates);
        setSelectedPairOrigin((current) => current || candidates[0] || currentOrigin);
      })
      .catch(() => {
        if (!pairMounted.current) return;
        setPairOrigins([currentOrigin]);
        setSelectedPairOrigin((current) => current || currentOrigin);
      });
  }, [currentOrigin]);

  const refreshPairCode = useCallback(async () => {
    if (!selectedPairOrigin) return;
    const requestId = ++pairRequestId.current;
    try {
      const { token } = await api.createPairToken();
      const payload = buildPairPayload(selectedPairOrigin, token);
      const dataUrl = await QRCode.toDataURL(payload, { margin: 1, width: 400 });
      if (!pairMounted.current || requestId !== pairRequestId.current) return;
      setPairQrDataUrl(dataUrl);
      setPairError(null);
    } catch (err) {
      if (!pairMounted.current || requestId !== pairRequestId.current) return;
      setPairQrDataUrl(null);
      setPairError(errorMessage(err, "Couldn't create a pairing code. Try reopening Settings."));
    }
  }, [selectedPairOrigin]);

  useEffect(() => {
    if (!selectedPairOrigin) return;
    void refreshPairCode();
    const interval = setInterval(() => { void refreshPairCode(); }, PAIR_TOKEN_REFRESH_MS);
    const onFocus = () => {
      if (document.visibilityState === 'visible') void refreshPairCode();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [selectedPairOrigin, refreshPairCode]);

  const pairWarning = selectedPairOrigin
    ? pairOriginWarning(selectedPairOrigin, currentOrigin, pairOrigins.length)
    : null;

  const guestAccessMutation = useMutation({
    mutationFn: (enabled: boolean) => api.setGuestAccess(enabled),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['session'] });
      showToast('Guest access updated');
    },
    onError: (err) => {
      showToast(errorMessage(err, 'Failed to update guest access'));
    },
  });

  // Fetch initial system credentials on mount
  useEffect(() => {
    api.fetchInitialCredentials()
      .then((creds) => {
        if (creds?.initial_password) {
          setTempPassword(creds.initial_password);
        }
      })
      .catch(() => {});

    api.fetchAutoRescanInterval()
      .then(({ minutes }) => setRescanInterval(String(minutes)))
      .catch(() => {});
  }, []);

  // OPDS catalog URL for external reader apps (same origin as the web UI)
  const opdsCatalogUrl = `${window.location.origin}/api/opds`;
  const handleCopyCatalogUrl = () => {
    navigator.clipboard?.writeText(opdsCatalogUrl)
      .then(() => showToast('Copied to clipboard'))
      .catch(() => {});
  };

  // Copy initial password helper
  const handleCopyPassword = () => {
    if (!tempPassword) return;
    navigator.clipboard?.writeText(tempPassword)
      .then(() => showToast('Copied to clipboard'))
      .catch(() => {});
  };

  // Clear initial password
  const handleClearPassword = async () => {
    setClearingTempPass(true);
    try {
      await api.clearInitialCredentials();
      setTempPassword(null);
      showToast('Temporary password cleared');
    } catch (err) {
      showToast(errorMessage(err, 'Failed to clear temporary password'));
    } finally {
      setClearingTempPass(false);
    }
  };

  const handleSaveRescanInterval = async (e: React.FormEvent) => {
    e.preventDefault();
    const minutes = parseAutoRescanMinutes(rescanInterval);
    if (minutes == null) {
      showToast('Enter a number of minutes (0 to disable).');
      return;
    }
    setSavingRescan(true);
    try {
      await api.setAutoRescanInterval(minutes);
      showToast(autoRescanSavedMessage(minutes));
    } catch (err) {
      showToast(errorMessage(err, 'Failed to save interval'));
    } finally {
      setSavingRescan(false);
    }
  };

  // Clear library catalog zone
  const handleClearLibrary = async () => {
    const confirmation = window.prompt(
      'Type CLEAR to wipe the library catalog. Files on disk will not be deleted.'
    );
    if (confirmation !== 'CLEAR') return;

    setClearingLibrary(true);
    try {
      const response = await api.clearLibrary();
      const n = response?.removed?.comics ?? 0;
      await invalidateLibraryQueries(queryClient);
      showToast(clearLibraryRemovedMessage(n));
      onClose();
    } catch (err) {
      showToast(errorMessage(err, 'Failed to clear library.'));
    } finally {
      setClearingLibrary(false);
    }
  };

  return (
    <div className="space-y-4 text-left">
      <div className="flex items-center gap-2">
        <button
          onClick={onBack}
          className="p-1.5 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h2 className="text-xl font-bold tracking-tight text-foreground">Settings</h2>
      </div>

      {tempPassword && (
        <TemporaryPasswordSection
          tempPassword={tempPassword}
          clearingTempPass={clearingTempPass}
          onCopy={handleCopyPassword}
          onClear={handleClearPassword}
        />
      )}

      <ThemePickerSection themes={THEME_LIST} activeTheme={activeTheme} onSelect={setTheme} />

      <PairDeviceSection
        origins={pairOrigins}
        selectedOrigin={selectedPairOrigin}
        onSelectOrigin={setSelectedPairOrigin}
        qrDataUrl={pairQrDataUrl}
        warning={pairWarning}
        error={pairError}
        revealed={pairRevealed}
        onToggleReveal={() => setPairRevealed((shown) => !shown)}
      />

      <ConnectReaderSection catalogUrl={opdsCatalogUrl} onCopy={handleCopyCatalogUrl} />

      {isAdmin && (
        <>
          <GuestAccessSection
            enabled={session?.guestAccess === true}
            pending={guestAccessMutation.isPending}
            onChange={(checked) => guestAccessMutation.mutate(checked)}
          />

          <AutoRescanSection
            rescanInterval={rescanInterval}
            savingRescan={savingRescan}
            onIntervalChange={setRescanInterval}
            onSubmit={handleSaveRescanInterval}
          />

          <DangerZoneSection clearingLibrary={clearingLibrary} onClearLibrary={handleClearLibrary} />
        </>
      )}

      <div className="flex justify-end pt-2 border-t border-border">
        <Button variant="outline" className="border-border text-foreground hover:bg-muted" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}
