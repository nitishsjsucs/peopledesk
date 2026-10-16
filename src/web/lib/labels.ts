// Display labels for ticket fields, shared by the ticket form, the ticket table (on /tickets and in chat)
// and the status filter, so a value reads the same everywhere.
import type { TicketCategory, TicketPriority, TicketStatus } from "../../shared/domain.ts";

export const TICKET_CATEGORY_LABEL: Record<TicketCategory, string> = {
  it: "IT",
  payroll: "Payroll",
  benefits: "Benefits",
  facilities: "Facilities",
  hr_general: "HR (general)",
  access_request: "Access request",
};

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed",
};

export const TICKET_PRIORITY_LABEL: Record<TicketPriority, string> = { low: "Low", normal: "Normal", high: "High" };

/** The label for a value, or the value itself in plain words when it has none. */
export function labelOf(labels: Record<string, string>, value: string): string {
  return labels[value] ?? value.replace(/_/g, " ");
}
