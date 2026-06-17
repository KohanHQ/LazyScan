const DEFAULT_TIMEZONE = "Asia/Jakarta";

export class TimeUtil {
  static now(): Date {
    return new Date();
  }

  static nowISO(): string {
    return new Date().toISOString();
  }

  static timestamp(): number {
    return Date.now();
  }

  static formatLocal(date: Date, timezone: string = DEFAULT_TIMEZONE): string {
    return date.toLocaleString("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  }

  static formatDisplay(date: Date, timezone: string = DEFAULT_TIMEZONE): string {
    return date.toLocaleString("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  }

  static formatDB(date: Date): string {
    return date.toISOString();
  }

  static parseISO(isoString: string): Date {
    return new Date(isoString);
  }

  static addTime(date: Date, amount: number, unit: TimeUnit): Date {
    const result = new Date(date);
    
    switch (unit) {
      case "seconds":
        result.setSeconds(result.getSeconds() + amount);
        break;
      case "minutes":
        result.setMinutes(result.getMinutes() + amount);
        break;
      case "hours":
        result.setHours(result.getHours() + amount);
        break;
      case "days":
        result.setDate(result.getDate() + amount);
        break;
      case "weeks":
        result.setDate(result.getDate() + (amount * 7));
        break;
      case "months":
        result.setMonth(result.getMonth() + amount);
        break;
      case "years":
        result.setFullYear(result.getFullYear() + amount);
        break;
    }
    
    return result;
  }

  static subtractTime(date: Date, amount: number, unit: TimeUnit): Date {
    return TimeUtil.addTime(date, -amount, unit);
  }

  static isPast(date: Date): boolean {
    return date.getTime() < Date.now();
  }

  static isFuture(date: Date): boolean {
    return date.getTime() > Date.now();
  }

  static diff(date1: Date, date2: Date, unit: TimeUnit): number {
    const diffMs = Math.abs(date1.getTime() - date2.getTime());
    
    switch (unit) {
      case "seconds":
        return Math.floor(diffMs / 1000);
      case "minutes":
        return Math.floor(diffMs / (1000 * 60));
      case "hours":
        return Math.floor(diffMs / (1000 * 60 * 60));
      case "days":
        return Math.floor(diffMs / (1000 * 60 * 60 * 24));
      case "weeks":
        return Math.floor(diffMs / (1000 * 60 * 60 * 24 * 7));
      case "months":
        return Math.floor(diffMs / (1000 * 60 * 60 * 24 * 30));
      case "years":
        return Math.floor(diffMs / (1000 * 60 * 60 * 24 * 365));
      default:
        return diffMs;
    }
  }

  static relative(date: Date): string {
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();
    const isPast = diffMs < 0;
    const absDiffMs = Math.abs(diffMs);

    const seconds = Math.floor(absDiffMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const weeks = Math.floor(days / 7);
    const months = Math.floor(days / 30);
    const years = Math.floor(days / 365);

    let timeStr = "";
    
    if (years > 0) {
      timeStr = `${years} year${years > 1 ? "s" : ""}`;
    } else if (months > 0) {
      timeStr = `${months} month${months > 1 ? "s" : ""}`;
    } else if (weeks > 0) {
      timeStr = `${weeks} week${weeks > 1 ? "s" : ""}`;
    } else if (days > 0) {
      timeStr = `${days} day${days > 1 ? "s" : ""}`;
    } else if (hours > 0) {
      timeStr = `${hours} hour${hours > 1 ? "s" : ""}`;
    } else if (minutes > 0) {
      timeStr = `${minutes} minute${minutes > 1 ? "s" : ""}`;
    } else {
      return "just now";
    }

    return isPast ? `${timeStr} ago` : `in ${timeStr}`;
  }

  static startOfDay(date: Date, timezone: string = DEFAULT_TIMEZONE): Date {
    const dateStr = date.toLocaleDateString("en-CA", { timeZone: timezone });
    return new Date(`${dateStr}T00:00:00.000Z`);
  }

  static endOfDay(date: Date, timezone: string = DEFAULT_TIMEZONE): Date {
    const dateStr = date.toLocaleDateString("en-CA", { timeZone: timezone });
    return new Date(`${dateStr}T23:59:59.999Z`);
  }

  static isSameDay(date1: Date, date2: Date, timezone: string = DEFAULT_TIMEZONE): boolean {
    const d1Str = date1.toLocaleDateString("en-CA", { timeZone: timezone });
    const d2Str = date2.toLocaleDateString("en-CA", { timeZone: timezone });
    return d1Str === d2Str;
  }
}

export type TimeUnit = "seconds" | "minutes" | "hours" | "days" | "weeks" | "months" | "years";

export const time = {
  now: TimeUtil.now,
  nowISO: TimeUtil.nowISO,
  timestamp: TimeUtil.timestamp,
  format: TimeUtil.formatLocal,
  formatDisplay: TimeUtil.formatDisplay,
  formatDB: TimeUtil.formatDB,
  parse: TimeUtil.parseISO,
  add: TimeUtil.addTime,
  subtract: TimeUtil.subtractTime,
  isPast: TimeUtil.isPast,
  isFuture: TimeUtil.isFuture,
  diff: TimeUtil.diff,
  relative: TimeUtil.relative,
  startOfDay: TimeUtil.startOfDay,
  endOfDay: TimeUtil.endOfDay,
  isSameDay: TimeUtil.isSameDay,
};

export const TIME_CONSTANTS = {
  SECOND: 1000,
  MINUTE: 60 * 1000,
  HOUR: 60 * 60 * 1000,
  DAY: 24 * 60 * 60 * 1000,
  WEEK: 7 * 24 * 60 * 60 * 1000,
} as const;