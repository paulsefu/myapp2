"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  contributionForMonth,
  computeObjective,
  currentIsoDate,
  currentTrackingSummary,
  demoVaultData,
  emptyVaultData,
  formatMoney,
  formatMonthLabel,
  isoToRomanianDate,
  monthKey,
  monthlyTrackingTotals,
  nextRecurringDate,
  objectivePlannedAmountForMonth,
  parseMoneyInput,
  romanianDateToIso,
  trackedMonthKeys,
  type Objective,
  type RecurrenceType,
  type VaultData,
} from "../lib/objectives";
import {
  assertVaultEnvelope,
  createVault,
  encryptUpdatedVault,
  unlockVaultWithPassphrase,
  unlockVaultWithRecoveryCode,
  type VaultEnvelope,
} from "../lib/vault-crypto";
import {
  deleteVaultRecord,
  loadVaultRecord,
  saveVaultRecord,
  VaultConflictError,
} from "../lib/vault-store";

type AppMode = "loading" | "setup" | "locked" | "unlocked" | "error";
type SyncState = "idle" | "syncing" | "saved" | "error" | "demo";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<{ outcome: "accepted" | "dismissed" }>;
};

type ObjectiveVaultAppProps = {
  displayName: string;
  demoMode?: boolean;
  onSignOut?: () => Promise<void> | void;
};

function createObjectiveId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

function importedBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    return ["1", "true", "da", "yes"].includes(value.trim().toLowerCase());
  }
  return false;
}

function parseDesktopObjectives(value: unknown): Objective[] {
  if (!Array.isArray(value)) {
    throw new Error("Fișierul trebuie să conțină lista obiectivelor.");
  }

  return value.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`Înregistrarea ${index + 1} nu este validă.`);
    }
    const source = item as Record<string, unknown>;
    const denumire = String(source.denumire ?? "").trim();
    const valoare = Number(source.valoare);
    if (!denumire || !Number.isFinite(valoare) || valoare <= 0) {
      throw new Error(`Înregistrarea ${index + 1} nu are denumire sau valoare validă.`);
    }
    const recurring = importedBoolean(source.plata_recurenta);
    const recurrenceType =
      recurring && source.tip_recurenta === "lunar"
        ? "lunar"
        : recurring
          ? "zile"
          : "";
    const interval = Number(source.interval_zile);
    const objective: Objective = {
      id:
        typeof source.id === "string" && source.id.trim()
          ? source.id
          : createObjectiveId(),
      denumire,
      valoare,
      categorie: String(source.categorie ?? "General").trim() || "General",
      data_tinta: String(source.data_tinta ?? "").trim(),
      plata_recurenta: recurring,
      tip_recurenta: recurrenceType,
      interval_zile:
        recurrenceType === "zile" && Number.isInteger(interval) && interval > 0
          ? interval
          : null,
      data_start_recurenta:
        recurring
          ? String(source.data_start_recurenta ?? source.data_tinta ?? "").trim()
          : "",
      created_at:
        typeof source.created_at === "string" && source.created_at
          ? source.created_at
          : recurring && String(source.data_start_recurenta ?? "").trim()
            ? romanianDateToIso(String(source.data_start_recurenta))
            : currentIsoDate(),
    };
    const computed = computeObjective(objective);
    return {
      ...objective,
      data_tinta:
        recurrenceType === "zile" && computed.displayDate !== "—"
          ? computed.displayDate
          : objective.data_tinta,
      zile_ramase: computed.daysRemaining ?? 0,
      suma_luna: Math.round(computed.monthlyAmount * 100) / 100,
    };
  });
}

export default function ObjectiveVaultApp({
  displayName,
  demoMode = false,
  onSignOut = () => undefined,
}: ObjectiveVaultAppProps) {
  const [mode, setMode] = useState<AppMode>(demoMode ? "unlocked" : "loading");
  const [vaultData, setVaultData] = useState<VaultData | null>(() =>
    demoMode ? demoVaultData() : null,
  );
  const [envelope, setEnvelope] = useState<VaultEnvelope | null>(null);
  const [revision, setRevision] = useState(0);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<SyncState>(
    demoMode ? "demo" : "idle",
  );
  const [globalError, setGlobalError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorObjective, setEditorObjective] = useState<Objective | "new" | null>(
    null,
  );
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const masterKeyRef = useRef<CryptoKey | null>(null);

  useEffect(() => {
    if (demoMode) {
      return;
    }

    let cancelled = false;
    async function loadVault() {
      try {
        const result = await loadVaultRecord();
        if (cancelled) return;

        if (!result.vault) {
          setRevision(0);
          setMode("setup");
          return;
        }

        assertVaultEnvelope(result.vault);
        setEnvelope(result.vault);
        setRevision(result.revision);
        setLastSavedAt(result.updatedAt);
        setMode("locked");
      } catch (error) {
        if (cancelled) return;
        setGlobalError(
          error instanceof Error
            ? error.message
            : "Seiful nu a putut fi încărcat.",
        );
        setMode("error");
      }
    }

    void loadVault();
    return () => {
      cancelled = true;
    };
  }, [demoMode]);

  const persistData = useCallback(
    async (nextData: VaultData) => {
      if (demoMode) {
        setVaultData(nextData);
        setSyncState("demo");
        return;
      }

      const masterKey = masterKeyRef.current;
      if (!envelope || !masterKey) {
        throw new Error("Seiful trebuie deblocat din nou.");
      }

      setSyncState("syncing");
      const nextEnvelope = await encryptUpdatedVault(
        envelope,
        masterKey,
        nextData,
      );
      let result: { revision: number; updatedAt: string };
      try {
        result = await saveVaultRecord(nextEnvelope, revision);
      } catch (error) {
        setSyncState("error");
        throw error instanceof VaultConflictError
          ? new Error(
              "Datele au fost schimbate pe alt dispozitiv. Blochează și redeschide aplicația înainte de a continua.",
            )
          : new Error(
              error instanceof Error
                ? error.message
                : "Modificarea nu a putut fi sincronizată.",
            );
      }

      setEnvelope(nextEnvelope);
      setRevision(result.revision);
      setLastSavedAt(result.updatedAt ?? new Date().toISOString());
      setVaultData(nextData);
      setSyncState("saved");
    },
    [demoMode, envelope, revision],
  );

  async function handleCreateVault(passphrase: string) {
    setGlobalError("");
    try {
      const initialData = emptyVaultData();
      const created = await createVault(initialData, passphrase);
      const result = await saveVaultRecord(created.envelope, 0);

      masterKeyRef.current = created.masterKey;
      setEnvelope(created.envelope);
      setRevision(result.revision);
      setLastSavedAt(result.updatedAt ?? new Date().toISOString());
      setVaultData(initialData);
      setRecoveryCode(created.recoveryCode);
      setSyncState("saved");
      setMode("unlocked");
    } catch (error) {
      setGlobalError(
        error instanceof Error ? error.message : "Seiful nu a putut fi creat.",
      );
      throw error;
    }
  }

  async function handleUnlock(secret: string, useRecoveryCode: boolean) {
    if (!envelope) return;
    setGlobalError("");
    try {
      const unlocked = useRecoveryCode
        ? await unlockVaultWithRecoveryCode(envelope, secret)
        : await unlockVaultWithPassphrase(envelope, secret);
      masterKeyRef.current = unlocked.masterKey;
      setVaultData(unlocked.data);
      setMode("unlocked");
      setSyncState("idle");
    } catch {
      const message = useRecoveryCode
        ? "Cheia de recuperare este incorectă."
        : "Parola de criptare este incorectă.";
      setGlobalError(message);
      throw new Error(message);
    }
  }

  async function handleResetVault() {
    setGlobalError("");
    try {
      await deleteVaultRecord();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Seiful nu a putut fi resetat.";
      setGlobalError(message);
      throw new Error(message);
    }

    masterKeyRef.current = null;
    setEnvelope(null);
    setRevision(0);
    setLastSavedAt(null);
    setVaultData(null);
    setSelectedId(null);
    setEditorObjective(null);
    setSyncState("idle");
    setMode("setup");
  }

  function lockVault() {
    masterKeyRef.current = null;
    setVaultData(null);
    setSelectedId(null);
    setEditorObjective(null);
    setGlobalError("");
    setMode(envelope ? "locked" : "setup");
  }

  async function saveObjective(objective: Objective) {
    if (!vaultData) return;
    const computed = computeObjective(objective);
    const normalized: Objective = {
      ...objective,
      data_tinta:
        objective.plata_recurenta && objective.tip_recurenta === "zile"
          ? computed.displayDate === "—"
            ? ""
            : computed.displayDate
          : objective.data_tinta,
      zile_ramase: computed.daysRemaining ?? 0,
      suma_luna: Math.round(computed.monthlyAmount * 100) / 100,
      created_at: objective.created_at || currentIsoDate(),
    };
    const exists = vaultData.objectives.some((item) => item.id === normalized.id);
    const objectives = exists
      ? vaultData.objectives.map((item) =>
          item.id === normalized.id ? normalized : item,
        )
      : [...vaultData.objectives, normalized];
    const categories = normalized.categorie
      ? Array.from(new Set([...vaultData.categories, normalized.categorie]))
      : vaultData.categories;

    await persistData({ ...vaultData, objectives, categories });
    setSelectedId(normalized.id);
    setEditorObjective(null);
  }

  async function deleteObjective(objective: Objective) {
    if (!vaultData) return;
    const accepted = window.confirm(
      `Ștergi definitiv „${objective.denumire}”?`,
    );
    if (!accepted) return;
    await persistData({
      ...vaultData,
      objectives: vaultData.objectives.filter((item) => item.id !== objective.id),
      contributions: vaultData.contributions.filter(
        (entry) => entry.objective_id !== objective.id,
      ),
    });
    setSelectedId(null);
    setEditorObjective(null);
  }

  async function importDesktopData(file: File) {
    if (!vaultData) return;
    let imported: Objective[];
    try {
      imported = parseDesktopObjectives(JSON.parse(await file.text()) as unknown);
    } catch (error) {
      throw new Error(
        error instanceof Error
          ? error.message
          : "Fișierul nu a putut fi citit.",
      );
    }
    if (imported.length === 0) {
      throw new Error("Fișierul nu conține niciun obiectiv.");
    }
    if (
      vaultData.objectives.length > 0 &&
      !window.confirm(
        `Importul va înlocui cele ${vaultData.objectives.length} înregistrări existente cu ${imported.length} înregistrări. Continui?`,
      )
    ) {
      return;
    }

    const categories = Array.from(
      new Set([
        ...vaultData.categories,
        ...imported.map((objective) => objective.categorie),
      ]),
    );
    await persistData({
      ...vaultData,
      objectives: imported,
      categories,
      contributions: [],
    });
    setSelectedId(null);
  }

  async function saveMonthlyContributions(
    selectedMonth: string,
    amounts: Record<string, number>,
  ) {
    if (!vaultData) return;
    const validObjectiveIds = new Set(
      vaultData.objectives.map((objective) => objective.id),
    );
    const touchedIds = new Set(Object.keys(amounts));
    const untouched = vaultData.contributions.filter(
      (entry) =>
        entry.luna !== selectedMonth || !touchedIds.has(entry.objective_id),
    );
    const updatedAt = new Date().toISOString();
    const replacements = Object.entries(amounts)
      .filter(
        ([objectiveId, amount]) =>
          validObjectiveIds.has(objectiveId) &&
          Number.isFinite(amount) &&
          amount > 0,
      )
      .map(([objectiveId, amount]) => ({
        objective_id: objectiveId,
        luna: selectedMonth,
        suma_pusa: Math.round(amount * 100) / 100,
        updated_at: updatedAt,
      }));
    await persistData({
      ...vaultData,
      contributions: [...untouched, ...replacements],
    });
  }

  if (mode === "loading") return <LoadingScreen />;

  if (mode === "error") {
    return (
      <SecurityScreen title="Nu am putut deschide aplicația" icon="!">
        <p className="security-copy">{globalError}</p>
        <button className="button button-primary" onClick={() => location.reload()}>
          Încearcă din nou
        </button>
      </SecurityScreen>
    );
  }

  if (mode === "setup") {
    return (
      <CreateVaultScreen
        displayName={displayName}
        error={globalError}
        onCreate={handleCreateVault}
      />
    );
  }

  if (mode === "locked") {
    return (
      <UnlockScreen
        displayName={displayName}
        error={globalError}
        onUnlock={handleUnlock}
        onReset={handleResetVault}
        onSignOut={onSignOut}
      />
    );
  }

  if (!vaultData) return <LoadingScreen />;

  const selected = vaultData.objectives.find((item) => item.id === selectedId);

  return (
    <VaultDashboard
      data={vaultData}
      displayName={displayName}
      demoMode={demoMode}
      syncState={syncState}
      lastSavedAt={lastSavedAt}
      selectedId={selectedId}
      onSelect={(id) => setSelectedId((current) => (current === id ? null : id))}
      onAdd={() => setEditorObjective("new")}
      onImport={importDesktopData}
      onSaveContributions={saveMonthlyContributions}
      onEdit={() => selected && setEditorObjective(selected)}
      onLock={lockVault}
      onSignOut={onSignOut}
    >
      {editorObjective && (
        <ObjectiveEditor
          objective={editorObjective === "new" ? null : editorObjective}
          categories={vaultData.categories}
          onClose={() => setEditorObjective(null)}
          onSave={saveObjective}
          onDelete={deleteObjective}
        />
      )}
      {recoveryCode && (
        <RecoveryCodeDialog
          recoveryCode={recoveryCode}
          onClose={() => setRecoveryCode(null)}
        />
      )}
    </VaultDashboard>
  );
}

function LoadingScreen() {
  return (
    <main className="security-page">
      <div className="loading-mark" aria-label="Se încarcă" />
      <p>Se pregătește seiful tău…</p>
    </main>
  );
}

function SecurityScreen({
  title,
  icon,
  children,
}: {
  title: string;
  icon: string;
  children: React.ReactNode;
}) {
  return (
    <main className="security-page">
      <section className="security-card">
        <div className="brand-mark" aria-hidden="true">
          {icon}
        </div>
        <p className="eyebrow">OBIECTIVE FINANCIARE</p>
        <h1>{title}</h1>
        {children}
      </section>
    </main>
  );
}

function CreateVaultScreen({
  displayName,
  error,
  onCreate,
}: {
  displayName: string;
  error: string;
  onCreate: (passphrase: string) => Promise<void>;
}) {
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [localError, setLocalError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLocalError("");
    if (passphrase.length < 12) {
      setLocalError("Parola trebuie să aibă cel puțin 12 caractere.");
      return;
    }
    if (passphrase !== confirmation) {
      setLocalError("Cele două parole nu coincid.");
      return;
    }
    setSubmitting(true);
    try {
      await onCreate(passphrase);
      setPassphrase("");
      setConfirmation("");
    } catch {
      // Mesajul este afișat în formular.
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SecurityScreen title="Creează seiful privat" icon="◈">
      <p className="security-copy">
        Bun venit, {displayName}. Parola de mai jos criptează datele direct pe
        dispozitivul tău și nu este trimisă serverului.
      </p>
      <form className="security-form" onSubmit={submit}>
        <label>
          Parolă de criptare
          <input
            type="password"
            autoComplete="new-password"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            placeholder="Minimum 12 caractere"
          />
        </label>
        <label>
          Confirmă parola
          <input
            type="password"
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder="Scrie parola din nou"
          />
        </label>
        {(localError || error) && (
          <p className="form-error" role="alert">
            {localError || error}
          </p>
        )}
        <button className="button button-primary button-wide" disabled={submitting}>
          {submitting ? "Se creează…" : "Creează seiful"}
        </button>
      </form>
      <p className="privacy-note">
        După creare vei primi o cheie de recuperare. Păstreaz-o într-un loc sigur.
      </p>
    </SecurityScreen>
  );
}

function UnlockScreen({
  displayName,
  error,
  onUnlock,
  onReset,
  onSignOut,
}: {
  displayName: string;
  error: string;
  onUnlock: (secret: string, recovery: boolean) => Promise<void>;
  onReset: () => Promise<void>;
  onSignOut: () => Promise<void> | void;
}) {
  const [secret, setSecret] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [resetConfirmed, setResetConfirmed] = useState(false);
  const [resetting, setResetting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!secret.trim()) return;
    setSubmitting(true);
    try {
      await onUnlock(secret, recovery);
      setSecret("");
    } catch {
      // Mesajul este afișat de ecran.
    } finally {
      setSubmitting(false);
    }
  }

  async function resetVault() {
    if (!resetConfirmed) return;
    setResetting(true);
    try {
      await onReset();
    } catch {
      // Mesajul este afișat de ecran.
    } finally {
      setResetting(false);
    }
  }

  return (
    <SecurityScreen title="Deblochează seiful" icon="◇">
      <p className="security-copy">
        Salut, {displayName}. Introdu {recovery ? "cheia de recuperare" : "parola de criptare"}.
      </p>
      <form className="security-form" onSubmit={submit}>
        <label>
          {recovery ? "Cheie de recuperare" : "Parolă de criptare"}
          <input
            type={recovery ? "text" : "password"}
            autoComplete={recovery ? "off" : "current-password"}
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            placeholder={recovery ? "OBV1.…" : "Parola ta"}
            autoFocus
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button button-primary button-wide" disabled={submitting}>
          {submitting ? "Se deblochează…" : "Deblochează"}
        </button>
      </form>
      <button
        className="text-button"
        type="button"
        onClick={() => {
          setRecovery((current) => !current);
          setSecret("");
        }}
      >
        {recovery ? "Folosește parola" : "Am cheia de recuperare"}
      </button>
      {!showReset ? (
        <button className="quiet-danger-link" type="button" onClick={() => setShowReset(true)}>
          Am uitat parola — încep de la zero
        </button>
      ) : (
        <div className="vault-reset-panel">
          <strong>Începi cu un seif nou și gol</strong>
          <p>Datele vechi sunt criptate și vor fi șterse definitiv. Această acțiune nu poate fi anulată.</p>
          <label className="confirmation-check">
            <input
              type="checkbox"
              checked={resetConfirmed}
              onChange={(event) => setResetConfirmed(event.target.checked)}
            />
            Confirm că vreau să șterg seiful vechi.
          </label>
          <div className="vault-reset-actions">
            <button className="button button-soft" type="button" onClick={() => setShowReset(false)}>
              Renunță
            </button>
            <button
              className="button button-danger"
              type="button"
              disabled={!resetConfirmed || resetting}
              onClick={() => void resetVault()}
            >
              {resetting ? "Se resetează…" : "Șterge și începe din nou"}
            </button>
          </div>
        </div>
      )}
      <button className="quiet-link" type="button" onClick={() => void onSignOut()}>
        Ieși din cont
      </button>
    </SecurityScreen>
  );
}

function VaultDashboard({
  data,
  displayName,
  demoMode,
  syncState,
  lastSavedAt,
  selectedId,
  onSelect,
  onAdd,
  onImport,
  onSaveContributions,
  onEdit,
  onLock,
  onSignOut,
  children,
}: {
  data: VaultData;
  displayName: string;
  demoMode: boolean;
  syncState: SyncState;
  lastSavedAt: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onImport: (file: File) => Promise<void>;
  onSaveContributions: (
    selectedMonth: string,
    amounts: Record<string, number>,
  ) => Promise<void>;
  onEdit: () => void;
  onLock: () => void;
  onSignOut: () => Promise<void> | void;
  children: React.ReactNode;
}) {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(() => monthKey());
  const [contributionDraft, setContributionDraft] = useState<
    Record<string, string>
  >({});
  const [trackingSaving, setTrackingSaving] = useState(false);
  const [trackingMessage, setTrackingMessage] = useState("");
  const [trackingError, setTrackingError] = useState("");
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const computed = useMemo(
    () => data.objectives.map((objective) => computeObjective(objective)),
    [data.objectives],
  );
  const availableMonths = useMemo(
    () => trackedMonthKeys(data.objectives),
    [data.objectives],
  );
  const trackingRows = useMemo(
    () =>
      data.objectives
        .map((objective) => ({
          objective,
          planned: objectivePlannedAmountForMonth(objective, selectedMonth),
          contributed: contributionForMonth(
            data.contributions,
            objective.id,
            selectedMonth,
          ),
        }))
        .filter((row) => row.planned > 0 || row.contributed > 0),
    [data.contributions, data.objectives, selectedMonth],
  );
  const trackingTotals = useMemo(
    () => monthlyTrackingTotals(data, selectedMonth),
    [data, selectedMonth],
  );
  const trackingSummary = useMemo(
    () => currentTrackingSummary(data),
    [data],
  );

  useEffect(() => {
    const nextDraft: Record<string, string> = {};
    for (const row of trackingRows) {
      nextDraft[row.objective.id] = row.contributed
        ? String(row.contributed).replace(".", ",")
        : "";
    }
    setContributionDraft(nextDraft);
  }, [selectedMonth, data.contributions, trackingRows]);

  useEffect(() => {
    function captureInstallPrompt(event: Event) {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    }
    window.addEventListener("beforeinstallprompt", captureInstallPrompt);
    return () =>
      window.removeEventListener("beforeinstallprompt", captureInstallPrompt);
  }, []);

  async function installApp() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    setInstallPrompt(null);
  }

  async function handleImportFile(file: File | undefined) {
    if (!file) return;
    setImporting(true);
    setImportError("");
    try {
      await onImport(file);
    } catch (error) {
      setImportError(
        error instanceof Error ? error.message : "Datele nu au putut fi importate.",
      );
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  function parseContributionValue(value: string): number | null {
    if (!value.trim()) return 0;
    const amount = Number(value.trim().replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(amount) && amount >= 0 ? amount : null;
  }

  async function saveTrackingMonth() {
    setTrackingError("");
    setTrackingMessage("");
    const amounts: Record<string, number> = {};
    for (const row of trackingRows) {
      const amount = parseContributionValue(
        contributionDraft[row.objective.id] ?? "",
      );
      if (amount === null) {
        setTrackingError(
          `Verifică suma introdusă pentru „${row.objective.denumire}”.`,
        );
        return;
      }
      amounts[row.objective.id] = amount;
    }

    setTrackingSaving(true);
    try {
      await onSaveContributions(selectedMonth, amounts);
      setTrackingMessage(`Sumele pentru ${formatMonthLabel(selectedMonth)} au fost salvate.`);
    } catch (error) {
      setTrackingError(
        error instanceof Error
          ? error.message
          : "Sumele lunii nu au putut fi salvate.",
      );
    } finally {
      setTrackingSaving(false);
    }
  }

  const syncLabel =
    syncState === "syncing"
      ? "Se sincronizează"
      : syncState === "error"
        ? "Eroare de sincronizare"
        : demoMode
          ? "Mod demonstrație"
          : "Date criptate și sincronizate";

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand-row">
            <div className="mini-brand" aria-hidden="true">
              ◈
            </div>
            <div>
              <p className="eyebrow">OBIECTIVE FINANCIARE</p>
              <h1>Banii tăi, în ordine.</h1>
            </div>
          </div>
          <div className="top-actions">
            {installPrompt && (
              <button className="button button-soft desktop-action" onClick={installApp}>
                Instalează
              </button>
            )}
            <button className="button button-soft" onClick={onLock}>
              Blochează
            </button>
            {!demoMode && (
              <button className="avatar" type="button" onClick={() => void onSignOut()} title={`Ieși din cont — ${displayName}`}>
                {displayName.trim().charAt(0).toUpperCase() || "U"}
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="dashboard">
        <section className="summary-grid" aria-label="Rezumat">
          <article className="summary-card summary-primary">
            <div>
              <p>Total de pus acum</p>
              <strong>{formatMoney(trackingSummary.dueNow)}</strong>
              <small>Planul lunii + eventualele restanțe</small>
            </div>
            <div className="summary-icon" aria-hidden="true">
              ↗
            </div>
          </article>
          <article className="summary-card">
            <div>
              <p>Restanță din lunile trecute</p>
              <strong>{formatMoney(trackingSummary.previousShortfall)}</strong>
            </div>
            <div className="summary-icon pale" aria-hidden="true">
              ↺
            </div>
          </article>
          <article className="summary-card">
            <div>
              <p>Ai pus luna aceasta</p>
              <strong>{formatMoney(trackingSummary.contributedThisMonth)}</strong>
            </div>
            <div className="summary-icon pale" aria-hidden="true">
              ✓
            </div>
          </article>
        </section>

        <section className="vault-status">
          <span className={`status-dot status-${syncState}`} />
          <span>{syncLabel}</span>
          {lastSavedAt && syncState !== "syncing" && (
            <span className="status-time">
              Ultima salvare {new Date(lastSavedAt).toLocaleString("ro-RO", { dateStyle: "short", timeStyle: "short" })}
            </span>
          )}
        </section>

        <section className="tracking-panel">
          <div className="tracking-heading">
            <div>
              <p className="eyebrow">ISTORICUL DEPUNERILOR</p>
              <h2>Evidența lunară</h2>
              <p className="tracking-copy">
                Completează cât ai pus efectiv. Orice diferență rămasă din
                lunile anterioare se adaugă automat la totalul de pus acum.
              </p>
            </div>
            <label className="month-picker">
              Luna verificată
              <select
                value={selectedMonth}
                onChange={(event) => {
                  setSelectedMonth(event.target.value);
                  setTrackingMessage("");
                  setTrackingError("");
                }}
              >
                {availableMonths.map((month) => {
                  const totals = monthlyTrackingTotals(data, month);
                  const suffix = totals.remaining > 0 ? " — de completat" : " — complet";
                  return (
                    <option key={month} value={month}>
                      {formatMonthLabel(month)}{suffix}
                    </option>
                  );
                })}
              </select>
            </label>
          </div>

          <div className="tracking-stats" aria-label="Rezumatul lunii selectate">
            <div>
              <span>Trebuia pus</span>
              <strong>{formatMoney(trackingTotals.planned)}</strong>
            </div>
            <div>
              <span>Ai înregistrat</span>
              <strong>{formatMoney(trackingTotals.contributed)}</strong>
            </div>
            <div className={trackingTotals.remaining > 0 ? "tracking-alert" : "tracking-ok"}>
              <span>Diferență</span>
              <strong>{formatMoney(trackingTotals.remaining)}</strong>
            </div>
          </div>

          {trackingRows.length === 0 ? (
            <div className="tracking-empty">
              Nu există sume planificate pentru luna selectată.
            </div>
          ) : (
            <div className="tracking-list">
              {trackingRows.map(({ objective, planned }) => {
                const draftValue = contributionDraft[objective.id] ?? "";
                const draftAmount = parseContributionValue(draftValue) ?? 0;
                const remaining = Math.max(planned - draftAmount, 0);
                const complete = planned > 0 && remaining <= 0;
                return (
                  <div className="tracking-row" key={objective.id}>
                    <div className="tracking-objective">
                      <span className="category-glyph" aria-hidden="true">
                        {categoryGlyph(objective.categorie)}
                      </span>
                      <div>
                        <strong>{objective.denumire}</strong>
                        <small>Trebuia: {formatMoney(planned)}</small>
                      </div>
                    </div>
                    <label className="tracking-input">
                      <span>Ai pus</span>
                      <div className="money-input">
                        <input
                          inputMode="decimal"
                          value={draftValue}
                          onChange={(event) =>
                            setContributionDraft((current) => ({
                              ...current,
                              [objective.id]: event.target.value,
                            }))
                          }
                          placeholder="0,00"
                          aria-label={`Suma pusă pentru ${objective.denumire}`}
                        />
                        <span>RON</span>
                      </div>
                    </label>
                    <button
                      className="button button-soft tracking-full-button"
                      type="button"
                      onClick={() =>
                        setContributionDraft((current) => ({
                          ...current,
                          [objective.id]: String(planned).replace(".", ","),
                        }))
                      }
                    >
                      Am pus integral
                    </button>
                    <div className={`tracking-status ${complete ? "is-complete" : "is-behind"}`}>
                      <span>{complete ? "Complet" : selectedMonth < monthKey() ? "Restant" : "Mai trebuie"}</span>
                      <strong>{formatMoney(remaining)}</strong>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {(trackingError || trackingMessage) && (
            <p
              className={trackingError ? "panel-error" : "tracking-success"}
              role={trackingError ? "alert" : "status"}
            >
              {trackingError || trackingMessage}
            </p>
          )}
          {trackingRows.length > 0 && (
            <div className="tracking-actions">
              <button
                className="button button-primary"
                type="button"
                disabled={trackingSaving}
                onClick={() => void saveTrackingMonth()}
              >
                {trackingSaving ? "Se salvează…" : "Salvează sumele lunii"}
              </button>
            </div>
          )}
        </section>

        <section className="objectives-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">PLANUL TĂU</p>
              <h2>Obiective și plăți</h2>
            </div>
            <div className="section-actions">
              <button
                className="button button-soft import-desktop"
                onClick={() => importInputRef.current?.click()}
                disabled={importing}
              >
                {importing ? "Se importă…" : "Importă date"}
              </button>
              <button className="button button-primary add-desktop" onClick={onAdd}>
                <span aria-hidden="true">＋</span> Adaugă
              </button>
            </div>
            <input
              ref={importInputRef}
              className="hidden-file-input"
              type="file"
              accept="application/json,.json"
              onChange={(event) => void handleImportFile(event.target.files?.[0])}
              tabIndex={-1}
            />
          </div>

          {importError && <p className="panel-error" role="alert">{importError}</p>}

          {computed.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon" aria-hidden="true">
                ◎
              </div>
              <h3>Primul pas începe aici</h3>
              <p>Adaugă un obiectiv sau o plată recurentă pentru a calcula rezerva lunară.</p>
              <button className="button button-primary" onClick={onAdd}>
                Adaugă primul obiectiv
              </button>
              <button
                className="text-button empty-import"
                onClick={() => importInputRef.current?.click()}
                disabled={importing}
              >
                Sau importă obiective_data.json din aplicația de calculator
              </button>
            </div>
          ) : (
            <>
              <div className="desktop-table-wrap">
                <table className="objectives-table">
                  <thead>
                    <tr>
                      <th>Denumire</th>
                      <th>Data țintă</th>
                      <th>Categorie</th>
                      <th>Zile rămase</th>
                      <th>Cât trebuie pus pe lună</th>
                    </tr>
                  </thead>
                  <tbody>
                    {computed.map((objective) => (
                      <tr
                        key={objective.id}
                        className={selectedId === objective.id ? "selected" : ""}
                        onClick={() => onSelect(objective.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onSelect(objective.id);
                          }
                        }}
                        tabIndex={0}
                      >
                        <td>
                          <div className="objective-name-cell">
                            <span className="category-glyph" aria-hidden="true">
                              {categoryGlyph(objective.categorie)}
                            </span>
                            <div>
                              <strong>{objective.denumire}</strong>
                              <small>{formatMoney(objective.valoare)}</small>
                            </div>
                          </div>
                        </td>
                        <td>{objective.displayDate}</td>
                        <td>
                          <span className="category-pill">{objective.categorie}</span>
                        </td>
                        <td>{objective.daysRemaining ?? "—"}</td>
                        <td className="monthly-cell">{formatMoney(objective.monthlyAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mobile-cards">
                {computed.map((objective) => (
                  <article
                    key={objective.id}
                    className={`objective-card ${selectedId === objective.id ? "selected" : ""}`}
                    onClick={() => onSelect(objective.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelect(objective.id);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="mobile-card-head">
                      <span className="category-glyph" aria-hidden="true">
                        {categoryGlyph(objective.categorie)}
                      </span>
                      <div>
                        <h3>{objective.denumire}</h3>
                        <span className="category-pill">{objective.categorie}</span>
                      </div>
                      <strong>{formatMoney(objective.valoare)}</strong>
                    </div>
                    <div className="mobile-card-meta">
                      <div>
                        <span>Următoarea dată</span>
                        <strong>{objective.displayDate}</strong>
                      </div>
                      <div>
                        <span>Zile rămase</span>
                        <strong>{objective.daysRemaining ?? "—"}</strong>
                      </div>
                      <div className="mobile-monthly">
                        <span>De pus pe lună</span>
                        <strong>{formatMoney(objective.monthlyAmount)}</strong>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
      </div>

      <button className="mobile-add" onClick={onAdd} aria-label="Adaugă obiectiv">
        ＋
      </button>

      {selectedId && (
        <div className="selection-bar">
          <div>
            <span>1 element selectat</span>
            <strong>{data.objectives.find((item) => item.id === selectedId)?.denumire}</strong>
          </div>
          <button className="button button-primary" onClick={onEdit}>
            Editează
          </button>
        </div>
      )}
      {children}
    </main>
  );
}

function categoryGlyph(category: string): string {
  const normalized = category.toLocaleLowerCase("ro-RO");
  if (normalized.includes("auto")) return "A";
  if (normalized.includes("telefon")) return "T";
  if (normalized.includes("abon")) return "R";
  if (normalized.includes("cas")) return "C";
  if (normalized.includes("vac")) return "V";
  return category.trim().charAt(0).toUpperCase() || "G";
}

function ObjectiveEditor({
  objective,
  categories,
  onClose,
  onSave,
  onDelete,
}: {
  objective: Objective | null;
  categories: string[];
  onClose: () => void;
  onSave: (objective: Objective) => Promise<void>;
  onDelete: (objective: Objective) => Promise<void>;
}) {
  const [name, setName] = useState(objective?.denumire ?? "");
  const [value, setValue] = useState(
    objective ? String(objective.valoare).replace(".", ",") : "",
  );
  const [category, setCategory] = useState(objective?.categorie ?? "General");
  const [targetDate, setTargetDate] = useState(
    objective ? romanianDateToIso(objective.data_tinta) : "",
  );
  const [recurring, setRecurring] = useState(
    objective?.plata_recurenta ?? false,
  );
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>(
    objective?.tip_recurenta === "lunar" ? "lunar" : "zile",
  );
  const [intervalDays, setIntervalDays] = useState(
    String(objective?.interval_zile ?? 28),
  );
  const [startDate, setStartDate] = useState(
    objective
      ? romanianDateToIso(objective.data_start_recurenta) ||
          objective.created_at?.slice(0, 10) ||
          currentIsoDate()
      : currentIsoDate(),
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const draft = useMemo(() => {
    const amount = parseMoneyInput(value) ?? 0;
    const interval = Number(intervalDays);
    const start = isoToRomanianDate(startDate);
    const next = recurring && recurrenceType === "zile"
      ? nextRecurringDate(start, Number.isInteger(interval) ? interval : null)
      : null;
    const item: Objective = {
      id: objective?.id ?? "preview",
      denumire: name,
      valoare: amount,
      categorie: category || "General",
      data_tinta: recurring
        ? recurrenceType === "zile" && next
          ? [
              next.getDate().toString().padStart(2, "0"),
              (next.getMonth() + 1).toString().padStart(2, "0"),
              next.getFullYear(),
            ].join(".")
          : ""
        : isoToRomanianDate(targetDate),
      plata_recurenta: recurring,
      tip_recurenta: recurring ? recurrenceType : "",
      interval_zile:
        recurring && recurrenceType === "zile" && Number.isInteger(interval)
          ? interval
          : null,
      data_start_recurenta:
        recurring ? start : "",
      created_at: objective?.created_at ?? currentIsoDate(),
    };
    return computeObjective(item);
  }, [category, intervalDays, name, objective?.id, recurrenceType, recurring, startDate, targetDate, value]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const amount = parseMoneyInput(value);
    if (!name.trim()) return setError("Completează denumirea.");
    if (!amount) return setError("Introdu o valoare mai mare decât zero.");
    if (!category.trim()) return setError("Completează categoria.");
    if (!recurring && !targetDate) return setError("Selectează data țintă.");
    if (recurring) {
      if (!startDate) return setError("Selectează data de început.");
    }
    if (recurring && recurrenceType === "zile") {
      const interval = Number(intervalDays);
      if (!Number.isInteger(interval) || interval <= 0) {
        return setError("Numărul de zile trebuie să fie un număr întreg pozitiv.");
      }
    }

    const item: Objective = {
      ...draft,
      id: objective?.id ?? createObjectiveId(),
      denumire: name.trim(),
      valoare: amount,
      categorie: category.trim(),
      zile_ramase: draft.daysRemaining ?? 0,
      suma_luna: Math.round(draft.monthlyAmount * 100) / 100,
      created_at: objective?.created_at ?? currentIsoDate(),
    };
    delete (item as Partial<typeof draft>).displayDate;
    delete (item as Partial<typeof draft>).daysRemaining;
    delete (item as Partial<typeof draft>).monthlyAmount;

    setSaving(true);
    try {
      await onSave(item);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Modificarea nu a putut fi salvată.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="editor-modal" role="dialog" aria-modal="true" aria-labelledby="editor-title">
        <div className="modal-head">
          <div>
            <p className="eyebrow">{objective ? "MODIFICARE" : "OBIECTIV NOU"}</p>
            <h2 id="editor-title">{objective ? "Editează obiectivul" : "Adaugă un obiectiv"}</h2>
          </div>
          <button className="close-button" type="button" onClick={onClose} aria-label="Închide">
            ×
          </button>
        </div>

        <form className="editor-form" onSubmit={submit}>
          <div className="field-grid two-columns">
            <label>
              Denumire
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex: Cartelă PrePay" autoFocus />
            </label>
            <label>
              Valoare
              <div className="money-input">
                <input inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} placeholder="0,00" />
                <span>RON</span>
              </div>
            </label>
          </div>

          <label>
            Categorie
            <input list="objective-categories" value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Alege sau scrie o categorie" />
            <datalist id="objective-categories">
              {categories.map((item) => <option key={item} value={item} />)}
            </datalist>
          </label>

          {!recurring && (
            <label>
              Data țintă
              <input
                type="date"
                value={targetDate}
                onChange={(event) => setTargetDate(event.target.value)}
                onInput={(event) => setTargetDate(event.currentTarget.value)}
              />
            </label>
          )}

          <label className="toggle-row">
            <span>
              <strong>Plată recurentă</strong>
              <small>Rămâne permanent în planul lunar.</small>
            </span>
            <input type="checkbox" checked={recurring} onChange={(event) => setRecurring(event.target.checked)} />
            <span className="toggle-control" aria-hidden="true" />
          </label>

          {recurring && (
            <div className="recurrence-box">
              <label>
                Se repetă
                <select value={recurrenceType} onChange={(event) => setRecurrenceType(event.target.value as RecurrenceType)}>
                  <option value="zile">La un anumit număr de zile</option>
                  <option value="lunar">Lunar</option>
                </select>
              </label>
              {recurrenceType === "zile" && (
                <div className="field-grid two-columns">
                  <label>
                    Număr de zile
                    <input type="number" min="1" step="1" inputMode="numeric" value={intervalDays} onChange={(event) => setIntervalDays(event.target.value)} />
                  </label>
                  <label>
                    Data de început
                    <input
                      type="date"
                      value={startDate}
                      onChange={(event) => setStartDate(event.target.value)}
                      onInput={(event) => setStartDate(event.currentTarget.value)}
                    />
                  </label>
                </div>
              )}
              {recurrenceType === "lunar" && (
                <label>
                  Data de început
                  <input
                    type="date"
                    value={startDate}
                    onChange={(event) => setStartDate(event.target.value)}
                    onInput={(event) => setStartDate(event.currentTarget.value)}
                  />
                </label>
              )}
              <p className="field-help">
                {recurrenceType === "zile"
                  ? "Următoarea plată se calculează automat pornind de la data de început."
                  : "Valoarea integrală este rezervată lunar, începând cu luna datei selectate."}
              </p>
            </div>
          )}

          <div className="calculation-preview">
            <div>
              <span>{recurring && recurrenceType === "zile" ? "Următoarea plată" : "Zile rămase"}</span>
              <strong>{recurring && recurrenceType === "zile" ? draft.displayDate : draft.daysRemaining ?? "—"}</strong>
            </div>
            <div>
              <span>Cât trebuie pus pe lună</span>
              <strong>{formatMoney(draft.monthlyAmount)}</strong>
            </div>
          </div>

          {error && <p className="form-error" role="alert">{error}</p>}

          <div className="modal-actions">
            {objective && (
              <button
                className="button button-danger"
                type="button"
                disabled={saving}
                onClick={async () => {
                  setSaving(true);
                  try {
                    await onDelete(objective);
                  } catch (deleteError) {
                    setError(deleteError instanceof Error ? deleteError.message : "Obiectivul nu a putut fi șters.");
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                Șterge
              </button>
            )}
            <span className="modal-spacer" />
            <button className="button button-soft" type="button" onClick={onClose} disabled={saving}>
              Anulează
            </button>
            <button className="button button-primary" disabled={saving}>
              {saving ? "Se salvează…" : objective ? "Salvează modificările" : "Salvează"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function RecoveryCodeDialog({
  recoveryCode,
  onClose,
}: {
  recoveryCode: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  async function copyCode() {
    await navigator.clipboard.writeText(recoveryCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  function downloadCode() {
    const text = [
      "Cheie de recuperare — Obiective financiare",
      "",
      recoveryCode,
      "",
      "Păstrează această cheie într-un loc sigur. Nu o trimite nimănui.",
    ].join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "cheie-recuperare-obiective.txt";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="modal-backdrop">
      <section className="recovery-modal" role="dialog" aria-modal="true" aria-labelledby="recovery-title">
        <div className="recovery-symbol" aria-hidden="true">◆</div>
        <p className="eyebrow">UN SINGUR PAS IMPORTANT</p>
        <h2 id="recovery-title">Salvează cheia de recuperare</h2>
        <p>
          Aceasta este singura cale de acces dacă uiți parola. Noi nu o putem
          recupera și nu o păstrăm separat.
        </p>
        <code className="recovery-code">{recoveryCode}</code>
        <div className="recovery-actions">
          <button className="button button-soft" onClick={copyCode}>{copied ? "Copiată" : "Copiază"}</button>
          <button className="button button-soft" onClick={downloadCode}>Descarcă</button>
        </div>
        <label className="confirmation-check">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          <span>Am salvat cheia într-un loc sigur.</span>
        </label>
        <button className="button button-primary button-wide" disabled={!confirmed} onClick={onClose}>
          Continuă în aplicație
        </button>
      </section>
    </div>
  );
}
