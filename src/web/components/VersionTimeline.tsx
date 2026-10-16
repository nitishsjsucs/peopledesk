import { Fragment } from "react";
import { Link } from "react-router";
import type { VersionSummary } from "../../shared/api-types.ts";
import { relativeDays } from "../lib/dates.ts";
import { formatDate } from "../lib/format.ts";
import { EffectiveDateBadge } from "./EffectiveDateBadge.tsx";

type Props = {
  docId: string;
  versions: VersionSummary[];
  selected: number;
  /** The business date: when known, a Today item sits between scheduled and earlier versions. */
  asOf?: string | null;
};

/**
 * Newest first: scheduled, current, then superseded versions, each with its effective range. With the
 * business date, "Today: Oct 1, 2026" marks where now falls, and a scheduled version says how soon.
 */
export function VersionTimeline({ docId, versions, selected, asOf = null }: Props) {
  const ordered = [...versions].reverse();
  const todayAt = asOf ? ordered.findIndex((v) => v.status !== "scheduled") : -1;
  const today = (
    <li key="today" className="timeline-today" data-status="today">
      <strong>Today: {formatDate(asOf ?? "")}</strong>
    </li>
  );
  return (
    <ol className="timeline" aria-label="Version history">
      {ordered.map((v, i) => (
        <Fragment key={v.version}>
          {asOf && i === todayAt ? today : null}
          <li className={v.version === selected ? "selected" : undefined} data-status={v.status}>
            <div>
              {v.version === selected ? (
                <strong>Version {v.version}</strong>
              ) : (
                <Link to={`/policies/${docId}/v/${v.version}`}>Version {v.version}</Link>
              )}
            </div>
            <EffectiveDateBadge effectiveFrom={v.effectiveFrom} effectiveTo={v.effectiveTo} status={v.status} />
            {asOf && v.status === "scheduled" ? <div className="timeline-when">{relativeDays(v.effectiveFrom, asOf)}</div> : null}
            <div className="summary">{v.changeSummary}</div>
          </li>
        </Fragment>
      ))}
      {asOf && todayAt === -1 ? today : null}
    </ol>
  );
}
