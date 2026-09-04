export type RecurrenceType = "zile" | "lunar";

export type Objective = {
  id: string;
  denumire: string;
  valoare: number;
  categorie: string;
  data_tinta: string;
  plata_recurenta: boolean;
  tip_recurenta: RecurrenceType | "";
  interval_zile: number | null;
  data_start_recurenta: string;
  created_at?: string;
  zile_ramase?: number;
  suma_luna?: number;
};

export type MonthlyContribution = {
  objective_id: string;
  luna: string;
  suma_pusa: number;
  updated_at: string;
};

export type VaultData = {
  schemaVersion: 2;
  objectives: Objective[];
  categories: string[];
  contributions: MonthlyContribution[];
};

export type ComputedObjective = Objective & {
  displayDate: string;
  daysRemaining: number | null;
  monthlyAmount: number;
};

export const DEFAULT_CATEGORIES = [
  "General",
  "Auto",
  "Vacanță",
  "Casă",
  "Electronice",
];

export function emptyVaultData(): VaultData {
  return {
    schemaVersion: 2,
    objectives: [],
    categories: [...DEFAULT_CATEGORIES],
    contributions: [],
  };
}

export function demoVaultData(): VaultData {
  return {
    schemaVersion: 2,
    categories: [...DEFAULT_CATEGORIES, "Abonamente", "Telefon"],
    contributions: [],
    objectives: [
      {
        id: "demo-prepay",
        denumire: "Cartelă Orange PrePay",
        valoare: 47,
        categorie: "Telefon",
        data_tinta: "08.09.2026",
        plata_recurenta: true,
        tip_recurenta: "zile",
        interval_zile: 28,
        data_start_recurenta: "11.08.2026",
        created_at: "2026-08-11",
      },
      {
        id: "demo-netflix",
        denumire: "Netflix",
        valoare: 59.99,
        categorie: "Abonamente",
        data_tinta: "",
        plata_recurenta: true,
        tip_recurenta: "lunar",
        interval_zile: null,
        data_start_recurenta: "01.08.2026",
        created_at: "2026-08-01",
      },
    ],
  };
}

export function parseRomanianDate(value: string): Date | null {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value.trim());
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const parsed = new Date(year, month - 1, day);

  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }

  return parsed;
}

export function romanianDateToIso(value: string): string {
  const parsed = parseRomanianDate(value);
  if (!parsed) return "";
  return [
    parsed.getFullYear().toString().padStart(4, "0"),
    (parsed.getMonth() + 1).toString().padStart(2, "0"),
    parsed.getDate().toString().padStart(2, "0"),
  ].join("-");
}

export function isoToRomanianDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return "";
  return `${match[3]}.${match[2]}.${match[1]}`;
}

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfMonth(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

function monthDistance(later: Date, earlier: Date): number {
  return (
    (later.getFullYear() - earlier.getFullYear()) * 12 +
    later.getMonth() -
    earlier.getMonth()
  );
}

export function currentIsoDate(referenceDate = new Date()): string {
  return [
    referenceDate.getFullYear().toString().padStart(4, "0"),
    (referenceDate.getMonth() + 1).toString().padStart(2, "0"),
    referenceDate.getDate().toString().padStart(2, "0"),
  ].join("-");
}

export function monthKey(referenceDate = new Date()): string {
  return [
    referenceDate.getFullYear().toString().padStart(4, "0"),
    (referenceDate.getMonth() + 1).toString().padStart(2, "0"),
  ].join("-");
}

export function parseMonthKey(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return new Date(year, month - 1, 1);
}

export function formatMonthLabel(value: string): string {
  const parsed = parseMonthKey(value);
  if (!parsed) return value;
  const label = new Intl.DateTimeFormat("ro-RO", {
    month: "long",
    year: "numeric",
  }).format(parsed);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function objectiveTrackingStart(
  objective: Objective,
  referenceDate = new Date(),
): Date {
  const recurringStart = parseRomanianDate(objective.data_start_recurenta);
  const createdAt = objective.created_at
    ? parseIsoDate(objective.created_at)
    : null;
  return startOfMonth(recurringStart ?? createdAt ?? referenceDate);
}

export function trackedMonthKeys(
  objectives: Objective[],
  referenceDate = new Date(),
): string[] {
  const currentMonth = startOfMonth(referenceDate);
  const validStarts = objectives
    .map((objective) => objectiveTrackingStart(objective, referenceDate))
    .filter((date) => date <= currentMonth);
  const earliest = validStarts.length
    ? new Date(Math.min(...validStarts.map((date) => date.getTime())))
    : currentMonth;
  const months: string[] = [];
  const cursor = new Date(currentMonth);
  while (cursor >= earliest && months.length < 240) {
    months.push(monthKey(cursor));
    cursor.setMonth(cursor.getMonth() - 1);
  }
  return months;
}

export function objectivePlannedAmountForMonth(
  objective: Objective,
  selectedMonth: string,
  referenceDate = new Date(),
): number {
  const month = parseMonthKey(selectedMonth);
  if (!month) return 0;
  const start = objectiveTrackingStart(objective, referenceDate);
  if (month < start) return 0;

  const savedMonthlyAmount = Number(objective.suma_luna);
  const monthlyAmount =
    Number.isFinite(savedMonthlyAmount) && savedMonthlyAmount > 0
      ? savedMonthlyAmount
      : computeObjective(objective, start).monthlyAmount;

  if (objective.plata_recurenta) {
    return Math.round(monthlyAmount * 100) / 100;
  }

  const target = parseRomanianDate(objective.data_tinta);
  if (!target || month > startOfMonth(target)) return 0;

  const installmentIndex = monthDistance(month, start);
  const alreadyPlanned = Math.max(installmentIndex, 0) * monthlyAmount;
  const remaining = Math.max(Number(objective.valoare) - alreadyPlanned, 0);
  return Math.round(Math.min(monthlyAmount, remaining) * 100) / 100;
}

export function contributionForMonth(
  contributions: MonthlyContribution[],
  objectiveId: string,
  selectedMonth: string,
): number {
  return contributions
    .filter(
      (entry) =>
        entry.objective_id === objectiveId && entry.luna === selectedMonth,
    )
    .reduce((sum, entry) => sum + (Number(entry.suma_pusa) || 0), 0);
}

export function monthlyTrackingTotals(
  data: VaultData,
  selectedMonth: string,
  referenceDate = new Date(),
): { planned: number; contributed: number; remaining: number } {
  const planned = data.objectives.reduce(
    (sum, objective) =>
      sum + objectivePlannedAmountForMonth(objective, selectedMonth, referenceDate),
    0,
  );
  const contributed = data.contributions
    .filter((entry) => entry.luna === selectedMonth)
    .reduce((sum, entry) => sum + (Number(entry.suma_pusa) || 0), 0);
  return {
    planned: Math.round(planned * 100) / 100,
    contributed: Math.round(contributed * 100) / 100,
    remaining: Math.round(Math.max(planned - contributed, 0) * 100) / 100,
  };
}

export function currentTrackingSummary(
  data: VaultData,
  referenceDate = new Date(),
): {
  currentPlan: number;
  contributedThisMonth: number;
  previousShortfall: number;
  dueNow: number;
} {
  const currentMonth = monthKey(referenceDate);
  const months = trackedMonthKeys(data.objectives, referenceDate);
  let previousPlanned = 0;
  let previousContributed = 0;

  for (const month of months) {
    if (month >= currentMonth) continue;
    const totals = monthlyTrackingTotals(data, month, referenceDate);
    previousPlanned += totals.planned;
    previousContributed += totals.contributed;
  }

  const current = monthlyTrackingTotals(data, currentMonth, referenceDate);
  const previousShortfall = Math.max(previousPlanned - previousContributed, 0);
  const dueNow = Math.max(
    current.planned + previousShortfall - current.contributed,
    0,
  );
  return {
    currentPlan: Math.round(current.planned * 100) / 100,
    contributedThisMonth: Math.round(current.contributed * 100) / 100,
    previousShortfall: Math.round(previousShortfall * 100) / 100,
    dueNow: Math.round(dueNow * 100) / 100,
  };
}

function dayDifference(later: Date, earlier: Date): number {
  const laterUtc = Date.UTC(
    later.getFullYear(),
    later.getMonth(),
    later.getDate(),
  );
  const earlierUtc = Date.UTC(
    earlier.getFullYear(),
    earlier.getMonth(),
    earlier.getDate(),
  );
  return Math.round((laterUtc - earlierUtc) / 86_400_000);
}

export function addDays(value: Date, days: number): Date {
  const result = new Date(value);
  result.setDate(result.getDate() + days);
  return result;
}

export function formatRomanianDate(value: Date): string {
  return [
    value.getDate().toString().padStart(2, "0"),
    (value.getMonth() + 1).toString().padStart(2, "0"),
    value.getFullYear(),
  ].join(".");
}

export function nextRecurringDate(
  startDate: string,
  intervalDays: number | null,
  referenceDate = new Date(),
): Date | null {
  const start = parseRomanianDate(startDate);
  const interval = Number(intervalDays);
  if (!start || !Number.isInteger(interval) || interval <= 0) return null;

  const reference = startOfDay(referenceDate);
  let next = addDays(start, interval);

  if (next < reference) {
    const elapsed = dayDifference(reference, next);
    const cycles = Math.ceil(elapsed / interval);
    next = addDays(next, cycles * interval);
  }

  return next;
}

export function recurringMonthlyAmount(
  value: number,
  recurrenceType: RecurrenceType | "",
  intervalDays: number | null,
): number {
  if (recurrenceType === "lunar") return value;
  if (recurrenceType === "zile" && intervalDays && intervalDays > 0) {
    return (value * 365) / intervalDays / 12;
  }
  return 0;
}

export function targetMonthlyAmount(
  value: number,
  targetDate: string,
  referenceDate = new Date(),
): number {
  const target = parseRomanianDate(targetDate);
  if (!target) return 0;

  const today = startOfDay(referenceDate);
  if (target <= today) return value;

  let months =
    (target.getFullYear() - today.getFullYear()) * 12 +
    target.getMonth() -
    today.getMonth();
  if (target.getDate() > today.getDate()) months += 1;

  return value / Math.max(months, 1);
}

export function computeObjective(
  objective: Objective,
  referenceDate = new Date(),
): ComputedObjective {
  const value = Number(objective.valoare) || 0;

  if (objective.plata_recurenta) {
    if (objective.tip_recurenta === "zile") {
      const next = nextRecurringDate(
        objective.data_start_recurenta,
        objective.interval_zile,
        referenceDate,
      );
      return {
        ...objective,
        displayDate: next ? formatRomanianDate(next) : "—",
        daysRemaining: next
          ? Math.max(dayDifference(next, startOfDay(referenceDate)), 0)
          : null,
        monthlyAmount: recurringMonthlyAmount(
          value,
          objective.tip_recurenta,
          objective.interval_zile,
        ),
      };
    }

    return {
      ...objective,
      displayDate: "Recurentă lunar",
      daysRemaining: null,
      monthlyAmount: value,
    };
  }

  const target = parseRomanianDate(objective.data_tinta);
  return {
    ...objective,
    displayDate: objective.data_tinta || "—",
    daysRemaining: target
      ? Math.max(dayDifference(target, startOfDay(referenceDate)), 0)
      : null,
    monthlyAmount: targetMonthlyAmount(
      value,
      objective.data_tinta,
      referenceDate,
    ),
  };
}

export function totalMonthlyAmount(
  objectives: Objective[],
  referenceDate = new Date(),
): number {
  const total = objectives.reduce(
    (total, objective) =>
      total +
      Math.round(
        computeObjective(objective, referenceDate).monthlyAmount * 100,
      ) /
        100,
    0,
  );
  return Math.round(total * 100) / 100;
}

export function formatMoney(value: number): string {
  return new Intl.NumberFormat("ro-RO", {
    style: "currency",
    currency: "RON",
    minimumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

export function parseMoneyInput(value: string): number | null {
  const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function normalizeVaultData(value: unknown): VaultData {
  if (!value || typeof value !== "object") return emptyVaultData();
  const candidate = value as Partial<VaultData>;
  const categories = Array.isArray(candidate.categories)
    ? candidate.categories
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
  const objectives = Array.isArray(candidate.objectives)
    ? candidate.objectives
        .filter(
          (item): item is Objective =>
            Boolean(item) &&
            typeof item === "object" &&
            typeof (item as Objective).denumire === "string",
        )
        .map((objective) => {
          const fallbackCreatedAt = objective.data_start_recurenta
            ? romanianDateToIso(objective.data_start_recurenta)
            : currentIsoDate();
          const normalized = {
            ...objective,
            created_at: objective.created_at || fallbackCreatedAt || currentIsoDate(),
          };
          const savedMonthlyAmount = Number(normalized.suma_luna);
          return {
            ...normalized,
            suma_luna:
              Number.isFinite(savedMonthlyAmount) && savedMonthlyAmount > 0
                ? savedMonthlyAmount
                : Math.round(computeObjective(normalized).monthlyAmount * 100) / 100,
          };
        })
    : [];
  const objectiveIds = new Set(objectives.map((objective) => objective.id));
  const contributions = Array.isArray(candidate.contributions)
    ? candidate.contributions.filter(
        (entry): entry is MonthlyContribution =>
          Boolean(entry) &&
          typeof entry === "object" &&
          typeof (entry as MonthlyContribution).objective_id === "string" &&
          objectiveIds.has((entry as MonthlyContribution).objective_id) &&
          typeof (entry as MonthlyContribution).luna === "string" &&
          Boolean(parseMonthKey((entry as MonthlyContribution).luna)) &&
          Number.isFinite(Number((entry as MonthlyContribution).suma_pusa)) &&
          Number((entry as MonthlyContribution).suma_pusa) >= 0,
      )
    : [];

  return {
    schemaVersion: 2,
    objectives,
    contributions,
    categories: Array.from(
      new Set([...DEFAULT_CATEGORIES, ...categories]),
    ),
  };
}
