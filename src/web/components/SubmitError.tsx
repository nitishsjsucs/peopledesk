import { Link } from "react-router";
import { ApiClientError } from "../lib/api.ts";
import { errorMessage } from "./ErrorBanner.tsx";

/**
 * A refused proposal, with the next step when there is one: too many requests are pending, or the
 * request being edited was decided meanwhile, so the person reviews their requests.
 */
export function SubmitError({ error }: { error: unknown }) {
  const reason = error instanceof ApiClientError ? ((error.details as { reason?: string } | undefined)?.reason ?? error.code) : undefined;
  return (
    <p className="field-error" role="alert">
      {errorMessage(error)}
      {reason === "rate_limited" || reason === "conflict" ? (
        <>
          {" "}
          <Link to="/actions">Review your requests</Link>
        </>
      ) : null}
    </p>
  );
}
