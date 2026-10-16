// Display labels for ticket fields. The Worker uses them in the approval preview (the card people
// approve, in chat, on the form's review step and in MCP results), and the web app on the ticket form,
// the ticket table and the status filter, so a value reads the same everywhere.
import type { TicketCategory, TicketPriority, TicketStatus } from "./domain.ts";

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
