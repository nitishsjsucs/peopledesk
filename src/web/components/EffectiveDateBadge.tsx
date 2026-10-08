import type { VersionStatus } from "../../shared/domain.ts";
import { formatDate } from "../lib/format.ts";

type Props = {
  effectiveFrom: string;
  effectiveTo: string | null;
  status?: VersionStatus;
};

const STATUS_LABEL: Record<VersionStatus, string> = {
  current: "Current",
  superseded: "Superseded",
  scheduled: "Scheduled",
};

/** Shows the half-open effective range [from, to) of a policy version, and its status at asOf. */
export function EffectiveDateBadge({ effectiveFrom, effectiveTo, status }: Props) {
  const range = effectiveTo
    ? `effective ${formatDate(effectiveFrom)} until ${formatDate(effectiveTo)}`
    : `effective ${formatDate(effectiveFrom)}`;
  return (
    <span className={`badge badge-${status ?? "neutral"}`} data-testid="effective-date-badge">
      {status ? <strong className="badge-status">{STATUS_LABEL[status]}</strong> : null}
      <time dateTime={effectiveFrom}>{range}</time>
    </span>
  );
}
