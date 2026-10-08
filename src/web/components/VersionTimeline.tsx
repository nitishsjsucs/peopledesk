import { Link } from "react-router";
import type { VersionSummary } from "../../shared/api-types.ts";
import { EffectiveDateBadge } from "./EffectiveDateBadge.tsx";

type Props = { docId: string; versions: VersionSummary[]; selected: number };

/** Newest first: scheduled, current, then superseded versions, each with its effective range. */
export function VersionTimeline({ docId, versions, selected }: Props) {
  return (
    <ol className="timeline" aria-label="Version history">
      {[...versions].reverse().map((v) => (
        <li key={v.version} className={v.version === selected ? "selected" : undefined} data-status={v.status}>
          <div>
            {v.version === selected ? (
              <strong>Version {v.version}</strong>
            ) : (
              <Link to={`/policies/${docId}/v/${v.version}`}>Version {v.version}</Link>
            )}
          </div>
          <EffectiveDateBadge effectiveFrom={v.effectiveFrom} effectiveTo={v.effectiveTo} status={v.status} />
          <div className="summary">{v.changeSummary}</div>
        </li>
      ))}
    </ol>
  );
}
