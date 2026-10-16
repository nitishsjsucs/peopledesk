// The business date (asOf) the Worker resolves effective dates, due dates and "upcoming" against.
// AppShell already asks /api/health on every signed-in load; this context passes its asOf down, so a
// page can say "overdue" or "in 21 days" with the server's date, never the browser's clock.
import { createContext, useContext } from "react";

export type BusinessDate = {
  /** YYYY-MM-DD, or null while unknown (not loaded yet, or /api/health failed). */
  asOf: string | null;
  /** True once /api/health has answered or failed; a page can then stop waiting for asOf. */
  settled: boolean;
};

export const BusinessDateContext = createContext<BusinessDate | null>(null);

/** Outside a provider (a page rendered on its own, as in most tests) the date is unknown and settled. */
export function useBusinessDate(): BusinessDate {
  return useContext(BusinessDateContext) ?? { asOf: null, settled: true };
}
