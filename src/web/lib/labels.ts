// Display labels for ticket fields (shared with the Worker's approval preview, see src/shared/labels.ts).
export { TICKET_CATEGORY_LABEL, TICKET_PRIORITY_LABEL, TICKET_STATUS_LABEL } from "../../shared/labels.ts";

/** The label for a value, or the value itself in plain words when it has none. */
export function labelOf(labels: Record<string, string>, value: string): string {
  return labels[value] ?? value.replace(/_/g, " ");
}
