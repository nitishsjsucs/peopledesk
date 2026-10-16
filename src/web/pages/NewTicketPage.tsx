import { RequestSteps } from "../components/RequestSteps.tsx";
import { TicketForm } from "../components/TicketForm.tsx";
import type { TicketValues } from "../components/TicketForm.tsx";

/** /requests/ticket: the form, then the review card. ?review=, ?edit= and ?from= address the steps. */
export function NewTicketPage() {
  return (
    <RequestSteps
      tool="create_support_ticket"
      titles={{ new: "New support ticket", edit: "Edit ticket request", review: "Review ticket request" }}
      subtitle="Nothing is created until you approve the request on the next step."
      renderForm={({ initialArgs, supersedes, onProposed }) => (
        <TicketForm initial={initialArgs as Partial<TicketValues> | undefined} supersedes={supersedes} onProposed={onProposed} />
      )}
    />
  );
}
