import { Navigate, useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { ArrowLeft, Check, UserRound } from 'lucide-react';
import * as api from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { invalidateLibraryQueries } from '@/lib/queryClient';
import { useUiStore } from '@/store/uiStore';
import { Button } from '@/components/ui/button';
import { showToast } from '@/hooks/useToast';
import {
  ConnectReaderSection,
  DangerZoneSection,
  GuestAccessSection,
  ServerInfoSection,
  TemporaryPasswordSection,
  ThemePickerSection,
} from '@/components/admin/settings/SystemSettingsSections';
import { PairDeviceSection } from '@/components/admin/settings/PairDeviceSection';
import { ReaderDefaultsSection } from '@/components/admin/settings/ReaderDefaultsSection';
import { DuplicatesSection } from '@/components/admin/settings/DuplicatesSection';
import { MissingFilesSection } from '@/components/admin/settings/MissingFilesSection';
import { WatchedRootsSection } from '@/components/admin/WatchedRootsSection';
import { DiagnosticsSection } from '@/components/admin/settings/DiagnosticsSection';
import {
  PAIR_TOKEN_REFRESH_MS,
  THEME_LIST,
  buildPairPayload,
  clearLibraryRemovedMessage,
  pairOriginCandidates,
  pairOriginWarning,
} from '@/components/admin/settingsPanelHelpers';

type SettingsSection = 'reading' | 'account' | 'library' | 'diagnostics' | 'access' | 'danger';

const SECTIONS: Array<{ id: SettingsSection; label: string; hint: string; admin?: boolean }> = [
  { id: 'reading', label: 'Reading', hint: 'Reader defaults and appearance' },
  { id: 'account', label: 'Account & connection', hint: 'Pair devices and external readers' },
  { id: 'library', label: 'Library', hint: 'Watched folders and catalog cleanup', admin: true },
  { id: 'diagnostics', label: 'Diagnostics', hint: 'Jobs, errors, cache and backup', admin: true },
  { id: 'access', label: 'Access', hint: 'Guest browsing permissions', admin: true },
  { id: 'danger', label: 'Danger zone', hint: 'Destructive catalog actions', admin: true },
];

function SectionIntro({ title, hint }: { title: string; hint: string }) {
  return <div className="mb-5 border-b border-border pb-4"><h2 className="text-xl font-semibold tracking-tight text-foreground">{title}</h2><p className="mt-1 text-sm text-muted-foreground">{hint}</p></div>;
}

function AccountSummary({ username, isAdmin }: { username: string; isAdmin: boolean }) {
  return <div className="mb-4 flex items-center gap-3 rounded-lg border border-border bg-secondary/20 p-3.5"><div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-primary"><UserRound className="h-4 w-4" /></div><div className="min-w-0"><div className="truncate text-sm font-semibold text-foreground">{username}</div><div className="text-[11px] text-muted-foreground">{isAdmin ? 'Administrator' : 'Signed-in account'}</div></div><Check className="ml-auto h-4 w-4 text-emerald-500" aria-label="Signed in" /></div>;
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { theme: activeTheme, setTheme } = useUiStore();
  const { data: session, isLoading } = useQuery({ queryKey: ['session'], queryFn: api.getSession });
  const [section, setSection] = useState<SettingsSection>('reading');
  const [clearingLibrary, setClearingLibrary] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [clearingTempPass, setClearingTempPass] = useState(false);
  const [pairOrigins, setPairOrigins] = useState<string[]>([]);
  const [selectedPairOrigin, setSelectedPairOrigin] = useState('');
  const [pairQrDataUrl, setPairQrDataUrl] = useState<string | null>(null);
  const [pairError, setPairError] = useState<string | null>(null);
  const [pairRevealed, setPairRevealed] = useState(false);
  const pairRequestId = useRef(0);
  const lastPairRefreshAt = useRef(0);
  const currentOrigin = window.location.origin;

  useEffect(() => {
    if (!session?.authenticated) return;
    api.fetchPairInfo().then(({ origins }) => {
      const candidates = pairOriginCandidates(origins, currentOrigin);
      setPairOrigins(candidates);
      setSelectedPairOrigin((current) => current || candidates[0] || currentOrigin);
    }).catch(() => {
      setPairOrigins([currentOrigin]);
      setSelectedPairOrigin((current) => current || currentOrigin);
    });
  }, [currentOrigin, session?.authenticated]);

  useEffect(() => {
    if (!selectedPairOrigin || !session?.authenticated) return undefined;
    const refresh = async () => {
      const now = Date.now();
      if (now - lastPairRefreshAt.current < 1000) return;
      lastPairRefreshAt.current = now;
      const requestId = ++pairRequestId.current;
      try {
        const { token } = await api.createPairToken();
        const dataUrl = await QRCode.toDataURL(buildPairPayload(selectedPairOrigin, token), { margin: 1, width: 400 });
        if (requestId !== pairRequestId.current) return;
        setPairQrDataUrl(dataUrl);
        setPairError(null);
      } catch (err) {
        if (requestId !== pairRequestId.current) return;
        setPairQrDataUrl(null);
        setPairError(errorMessage(err, "Couldn't create a pairing code. Try reopening Settings."));
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), PAIR_TOKEN_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [selectedPairOrigin, session?.authenticated]);

  useEffect(() => {
    api.fetchInitialCredentials().then((creds) => {
      if (creds?.initial_password) setTempPassword(creds.initial_password);
    }).catch(() => {});
  }, []);

  const isAdmin = session?.user?.isAdmin === true;
  const visibleSections = SECTIONS.filter((item) => !item.admin || isAdmin);
  const currentSection = visibleSections.find((item) => item.id === section) ?? visibleSections[0];
  const guestAccessMutation = useMutation({
    mutationFn: (enabled: boolean) => api.setGuestAccess(enabled),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['session'] }); showToast('Guest access updated'); },
    onError: (err) => showToast(errorMessage(err, 'Failed to update guest access')),
  });

  if (isLoading) return null;
  if (!session?.authenticated) return <Navigate to="/login" replace />;

  const clearLibrary = async () => {
    const confirmation = window.prompt('Type CLEAR to wipe the library catalog. Files on disk will not be deleted.');
    if (confirmation !== 'CLEAR') return;
    setClearingLibrary(true);
    try {
      const response = await api.clearLibrary();
      await invalidateLibraryQueries(queryClient);
      showToast(clearLibraryRemovedMessage(response.removed.comics));
      setSection('reading');
    } catch (err) {
      showToast(errorMessage(err, 'Failed to clear library.'));
    } finally { setClearingLibrary(false); }
  };

  const copyPassword = () => {
    if (!tempPassword) return;
    navigator.clipboard?.writeText(tempPassword).then(() => showToast('Copied to clipboard')).catch(() => {});
  };
  const clearPassword = async () => {
    setClearingTempPass(true);
    try { await api.clearInitialCredentials(); setTempPassword(null); showToast('Temporary password cleared'); }
    catch (err) { showToast(errorMessage(err, 'Failed to clear temporary password')); }
    finally { setClearingTempPass(false); }
  };

  const panel = () => {
    switch (currentSection?.id) {
      case 'account':
        return <div className="space-y-4"><AccountSummary username={session.user?.username ?? 'Account'} isAdmin={isAdmin} /><ServerInfoSection />{tempPassword && <TemporaryPasswordSection tempPassword={tempPassword} clearingTempPass={clearingTempPass} onCopy={copyPassword} onClear={() => void clearPassword()} />}<PairDeviceSection origins={pairOrigins} selectedOrigin={selectedPairOrigin} onSelectOrigin={setSelectedPairOrigin} qrDataUrl={pairQrDataUrl} warning={selectedPairOrigin ? pairOriginWarning(selectedPairOrigin, currentOrigin, pairOrigins.length) : null} error={pairError} revealed={pairRevealed} onToggleReveal={() => setPairRevealed((value) => !value)} /><ConnectReaderSection catalogUrl={`${currentOrigin}/api/opds`} onCopy={() => navigator.clipboard?.writeText(`${currentOrigin}/api/opds`).then(() => showToast('Copied to clipboard')).catch(() => {})} /></div>;
      case 'library': return <div className="space-y-4"><WatchedRootsSection /><DuplicatesSection /><MissingFilesSection /></div>;
      case 'diagnostics': return <DiagnosticsSection />;
      case 'access': return <GuestAccessSection enabled={session.guestAccess === true} pending={guestAccessMutation.isPending} onChange={(enabled) => guestAccessMutation.mutate(enabled)} />;
      case 'danger': return <DangerZoneSection clearingLibrary={clearingLibrary} onClearLibrary={() => void clearLibrary()} />;
      case 'reading':
      default: return <div className="space-y-5"><ThemePickerSection themes={THEME_LIST} activeTheme={activeTheme} onSelect={setTheme} /><ReaderDefaultsSection /></div>;
    }
  };

  return <div className="min-h-full w-full px-4 py-5 text-left sm:px-6 sm:py-8"><div className="mx-auto max-w-5xl">
    <header className="mb-6 flex items-center gap-3"><button type="button" onClick={() => navigate('/')} className="rounded-full p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground" aria-label="Back to library"><ArrowLeft className="h-4 w-4" /></button><div><h1 className="text-2xl font-semibold tracking-tight text-foreground">Settings</h1><p className="text-sm text-muted-foreground">Your account, reader defaults and server tools</p></div></header>
    <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
      <nav aria-label="Settings sections" className="flex gap-1 overflow-x-auto lg:block lg:space-y-1">{visibleSections.map((item) => <button key={item.id} type="button" onClick={() => setSection(item.id)} className={`min-w-max rounded-lg border px-3 py-2 text-left transition lg:block lg:w-full ${item.id === currentSection?.id ? 'border-primary/40 bg-primary/10 text-foreground' : 'border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground'}`}><span className="block text-sm font-medium">{item.label}</span><span className="hidden text-[11px] leading-tight text-muted-foreground lg:block">{item.hint}</span></button>)}</nav>
      <main className="min-w-0 rounded-xl border border-border bg-card/40 p-4 shadow-sm sm:p-6"><SectionIntro title={currentSection?.label ?? 'Settings'} hint={currentSection?.hint ?? ''} />{panel()}</main>
    </div>
    <div className="mt-5 flex justify-end"><Button variant="outline" className="border-border text-foreground hover:bg-muted" onClick={() => navigate('/')}>Close</Button></div>
  </div></div>;
}
