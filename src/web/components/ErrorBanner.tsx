import { ApiClientError } from "../lib/api.ts";

export function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

type Props = { error: unknown; onRetry?: () => void };

export function ErrorBanner({ error, onRetry }: Props) {
  return (
    <div className="banner banner-error" role="alert">
      <span>{errorMessage(error)}</span>
      {onRetry ? (
        <button type="button" className="btn btn-danger" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}
