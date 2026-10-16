import { ApiClientError } from "../lib/api.ts";

export const SESSION_ENDED = "Your session has ended. Reload the page to sign in again.";

const isUnauthenticated = (error: unknown) => error instanceof ApiClientError && error.status === 401;

export function errorMessage(error: unknown): string {
  if (isUnauthenticated(error)) return SESSION_ENDED;
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

type Props = { error: unknown; onRetry?: () => void };

/** An error and what to do next: Try again, or Reload when the session has ended (trying again cannot help). */
export function ErrorBanner({ error, onRetry }: Props) {
  return (
    <div className="banner banner-error" role="alert">
      <span>{errorMessage(error)}</span>
      {isUnauthenticated(error) ? (
        <button type="button" className="btn btn-danger" onClick={() => window.location.reload()}>
          Reload
        </button>
      ) : onRetry ? (
        <button type="button" className="btn btn-danger" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}
