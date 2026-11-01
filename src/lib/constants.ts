// Single source of truth for every enumeration. The SQL CHECK constraints mirror these lists
// (tests/db.test.ts inserts every value to make sure they never drift apart).

export const TASK_CATEGORIES = [
  "Visa Interview",
  "Interview Preparation",
  "DS-160 Application",
  "Client Phone Call",
  "Document Collection",
  "Embassy Appointment",
  "Payment Follow-Up",
  "Administrative Work",
  "Urgent Task",
  "Personal Reminder",
] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];

export const PRIORITIES = ["Low", "Normal", "High", "Urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const TASK_STATUSES = ["pending", "completed", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const RECURRENCES = ["daily", "weekdays", "weekly", "monthly"] as const;
export type Recurrence = (typeof RECURRENCES)[number];

export const APPLICATION_STATUSES = [
  "New Client",
  "Documents Pending",
  "DS-160 In Progress",
  "DS-160 Completed",
  "Appointment Pending",
  "Interview Scheduled",
  "Interview Preparation",
  "Interview Completed",
  "Administrative Processing",
  "Visa Issued",
  "Visa Refused",
  "Case Closed",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const PAYMENT_STATUSES = ["Unpaid", "Partial", "Paid", "Refunded"] as const;
export const PREP_STATUSES = ["Not Started", "In Progress", "Ready"] as const;
export const DOCS_STATUSES = ["Missing", "Partial", "Complete"] as const;
export const INTERVIEW_OUTCOMES = ["Pending", "Approved", "Refused", "Administrative Processing", "Rescheduled", "Cancelled"] as const;

export const DOCUMENT_CATEGORIES = [
  "Passport",
  "National ID",
  "DS-160 Confirmation",
  "Appointment Confirmation",
  "Employment Documents",
  "Financial Documents",
  "Travel History",
  "Supporting Documents",
  "Client Correspondence",
  "Other",
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const NOTE_KINDS = ["note", "call", "whatsapp", "email", "meeting"] as const;
export const TASK_SOURCES = ["manual", "ai", "gmail", "note"] as const;

export const VISA_CATEGORIES = [
  "B1/B2 Visitor",
  "F-1 Student",
  "J-1 Exchange",
  "H-1B Work",
  "K-1 Fiancé(e)",
  "Immigrant Visa",
  "Transit / Other",
] as const;

export const REMINDER_PRESETS: { minutes: number; label: string }[] = [
  { minutes: 0, label: "At task time" },
  { minutes: 15, label: "15 minutes before" },
  { minutes: 30, label: "30 minutes before" },
  { minutes: 60, label: "1 hour before" },
  { minutes: 300, label: "5 hours before" },
  { minutes: 1440, label: "1 day before" },
  { minutes: 2880, label: "2 days before" },
  { minutes: 10080, label: "1 week before" },
];

/** Category → accent colour used by chips and the calendar (kept readable on light AND dark surfaces). */
export const CATEGORY_COLORS: Record<TaskCategory, string> = {
  "Visa Interview": "#C9A86A",
  "Interview Preparation": "#8B7CF6",
  "DS-160 Application": "#3B82C4",
  "Client Phone Call": "#16856A",
  "Document Collection": "#D59B36",
  "Embassy Appointment": "#2BA3B8",
  "Payment Follow-Up": "#D9728A",
  "Administrative Work": "#7B8AA5",
  "Urgent Task": "#CC4757",
  "Personal Reminder": "#9C7A58",
};

export const DEFAULT_PREP_CHECKLIST = [
  "Review DS-160 answers with the client",
  "Explain the purpose-of-travel questions",
  "Confirm ties to home country documents",
  "Practice mock interview in the client's language",
  "Confirm what to bring on interview day",
  "Remind about embassy security rules",
];

export const DEFAULT_DOCUMENT_CHECKLIST: { label: string; category: DocumentCategory; required: boolean }[] = [
  { label: "Passport (photo page)", category: "Passport", required: true },
  { label: "National ID", category: "National ID", required: false },
  { label: "DS-160 confirmation page", category: "DS-160 Confirmation", required: true },
  { label: "Appointment confirmation", category: "Appointment Confirmation", required: true },
  { label: "Employment letter / proof of employment", category: "Employment Documents", required: false },
  { label: "Bank statements / financial proof", category: "Financial Documents", required: false },
  { label: "Previous travel history", category: "Travel History", required: false },
  { label: "Supporting documents", category: "Supporting Documents", required: false },
];
