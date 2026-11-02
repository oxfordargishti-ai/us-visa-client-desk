import type { ApplicationStatus, Priority, Recurrence, TaskCategory, TaskStatus } from "./constants";

export interface Prefs {
  user_id: string;
  timezone: string;
  theme: "light" | "dark" | "system";
  default_task_reminders: number[];
  default_interview_reminders: number[];
  notif_push: boolean;
  notif_email_fallback: boolean;
  notification_email: string | null;
  sound_enabled: boolean;
  ai_task_parsing: boolean;
  ai_share_client_names: boolean;
  ai_email_analysis: boolean;
  ai_planner_suggestions: boolean;
  document_retention_days: number | null;
  language: "en" | "hy" | "ru";
  client_reminders_enabled: boolean;
  client_reminder_offsets: number[];
  business_phone: string | null;
}

export interface Task {
  id: string;
  user_id: string;
  client_id: string | null;
  case_id: string | null;
  title: string;
  description: string | null;
  category: TaskCategory;
  priority: Priority;
  status: TaskStatus;
  due_at: string | null;
  duration_minutes: number;
  recurrence: Recurrence | null;
  recurrence_until: string | null;
  series_id: string | null;
  reminder_offsets: number[];
  source: "manual" | "ai" | "gmail" | "note";
  source_ref: string | null;
  ai_original_text: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  // joined
  client_name?: string | null;
  client_phone?: string | null;
  client_whatsapp?: string | null;
}

export interface Reminder {
  id: string;
  task_id: string;
  remind_at: string;
  offset_minutes: number | null;
  kind: "scheduled" | "custom" | "snooze";
  status: "pending" | "processing" | "sent" | "failed" | "canceled";
  attempt_count: number;
  last_error: string | null;
  sent_at: string | null;
}

export interface ClientRow {
  id: string;
  client_code: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  preferred_language: string | null;
  notify_email: boolean;
  notify_sms: boolean;
  source: string | null;
  created_at: string;
  updated_at: string;
}

export interface CaseRow {
  id: string;
  client_id: string;
  visa_category: string;
  application_status: ApplicationStatus;
  embassy: string | null;
  ds160_confirmation: string | null;
  payment_status: "Unpaid" | "Partial" | "Paid" | "Refunded";
  interview_prep_status: "Not Started" | "In Progress" | "Ready";
  opened_at: string;
  closed_at: string | null;
}

export interface InterviewRow {
  id: string;
  client_id: string;
  case_id: string | null;
  task_id: string | null;
  visa_category: string | null;
  embassy: string | null;
  interview_at: string;
  prep_status: "Not Started" | "In Progress" | "Ready";
  docs_status: "Missing" | "Partial" | "Complete";
  outcome: string;
  prep_checklist: { id: string; label: string; done: boolean }[];
  notes: string | null;
  client_name?: string;
  client_phone?: string | null;
  client_whatsapp?: string | null;
}

export interface NoteRow {
  id: string;
  client_id: string | null;
  body: string;
  kind: "note" | "call" | "whatsapp" | "email" | "meeting";
  pinned: boolean;
  created_at: string;
  updated_at: string;
  client_name?: string | null;
}

export interface DocumentRow {
  id: string;
  client_id: string;
  case_id: string | null;
  category: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  notes: string | null;
  source: "upload" | "gmail";
  uploaded_at: string;
  client_name?: string;
}

export interface CalendarEventRow {
  id: string;
  task_id: string;
  client_id: string | null;
  title: string;
  category: TaskCategory;
  starts_at: string;
  ends_at: string;
  location: string | null;
  task_status: TaskStatus;
  priority: Priority;
  client_name: string | null;
  is_interview: boolean;
}

export interface NotificationRow {
  id: string;
  channel: "push" | "email" | "inapp";
  status: string;
  title: string;
  body: string;
  url: string | null;
  priority: string | null;
  error: string | null;
  sent_at: string | null;
  read_at: string | null;
  created_at: string;
}
