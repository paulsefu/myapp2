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
  zile_ramase?: number;
  suma_luna?: number;
};

export type VaultData = {
  schemaVersion: 1;
  objectives: Objective[];
  categories: string[];
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
    schemaVersion: 1,
    objectives: [],
    categories: [...DEFAULT_CATEGORIES],
  };
}

export function demoVaultData(): VaultData {
  return {
    schemaVersion: 1,
    categories: [...DEFAULT_CATEGORIES, "Abonamente", "Telefon"],
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
        data_start_recurenta: "",
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
    ? candidate.objectives.filter(
        (item): item is Objective =>
          Boolean(item) &&
          typeof item === "object" &&
          typeof (item as Objective).denumire === "string",
      )
    : [];

  return {
    schemaVersion: 1,
    objectives,
    categories: Array.from(
      new Set([...DEFAULT_CATEGORIES, ...categories]),
    ),
  };
}
