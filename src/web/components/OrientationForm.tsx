// Structured orientation booking: a session table with seats remaining, a region filter, and for
// managers and HR an attendee selector from /api/team (the same directory slice the chat router sees).
// It shows a form only to someone who could book: a person in onboarding without a booking books for
// themself; a manager or HR admin books for the people they support who have none. The server still
// decides every proposal (ActionService.propose); this only avoids offering a form that cannot succeed.
import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router";
import type { OrientationBooking, PendingActionView, Session } from "../../shared/api-types.ts";
import { ScheduleOrientationSessionInput } from "../../shared/tool-schemas.ts";
import { api, ApiClientError } from "../lib/api.ts";
import { formatDateTime } from "../lib/format.ts";
import { useMe } from "../lib/session.tsx";
import { useAsync } from "../lib/use-async.ts";
import { ErrorBanner } from "./ErrorBanner.tsx";
import { SubmitError } from "./SubmitError.tsx";

type Props = {
  initialSessionId?: string;
  initialEmployeeId?: string;
  supersedes?: string;
  onProposed: (view: PendingActionView) => void;
};

type RegionChoice = "mine" | "US" | "UK" | "IN" | "GLOBAL" | "all";

const REGION_LABEL: Record<Exclude<RegionChoice, "mine">, string> = { US: "US", UK: "UK", IN: "IN", GLOBAL: "Global", all: "All regions" };

export function OrientationForm(props: Props) {
  const me = useMe();
  if (me.role === "employee" && !me.inOnboarding) {
    return (
      <div className="card" data-testid="orientation-ineligible">
        <p style={{ marginTop: 0 }}>Orientation sessions are for people in onboarding, and you don't have an onboarding plan.</p>
        <p className="request-links" style={{ marginBottom: 0 }}>
          <Link to="/policies">Browse policies</Link>
          <Link to="/chat">Ask in chat</Link>
        </p>
      </div>
    );
  }
  return <BookingForm {...props} />;
}

/** "You're booked into ..." for the viewer's own booking. */
export function OwnBooking({ booking }: { booking: OrientationBooking }) {
  return (
    <>
      You're booked into {booking.title} ({booking.sessionId}) on {formatDateTime(booking.startsAt)}, {booking.location}.
    </>
  );
}

function BookingForm({ initialSessionId, initialEmployeeId, supersedes, onProposed }: Props) {
  const me = useMe();
  const sessions = useAsync(() => api.sessions(), []);
  const team = useAsync(() => (me.role === "employee" ? Promise.resolve({ members: [] }) : api.team()), [me.role]);
  const own = useAsync(() => (me.inOnboarding ? api.orientationBooking() : Promise.resolve({ booking: null })), [me.inOnboarding]);
  const [sessionId, setSessionId] = useState(initialSessionId ?? "");
  const [employeeId, setEmployeeId] = useState(initialEmployeeId ?? "");
  const [region, setRegion] = useState<RegionChoice | null>(null);
  const [choose, setChoose] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const tableRef = useRef<HTMLTableElement>(null);

  const failed = [own, team, sessions].filter((x) => x.error);
  if (failed.length > 0) {
    return (
      <>
        {own.error ? <ErrorBanner error={own.error} onRetry={own.reload} /> : null}
        {team.error ? <ErrorBanner error={team.error} onRetry={team.reload} /> : null}
        {sessions.error ? <ErrorBanner error={sessions.error} onRetry={sessions.reload} /> : null}
      </>
    );
  }
  if (!own.data || !team.data || !sessions.data) {
    return (
      <p className="thinking" role="status">
        Loading sessions...
      </p>
    );
  }

  const booking = own.data.booking;
  const bookedLine = booking ? (
    <div className="banner banner-info" data-testid="own-booking">
      <span>
        <OwnBooking booking={booking} />
      </span>
      <Link className="btn" to="/onboarding">
        View onboarding
      </Link>
    </div>
  ) : null;
  if (me.role === "employee" && booking) return bookedLine;

  const supported = team.data.members.filter((m) => m.inOnboarding);
  const attendees = [
    ...(me.inOnboarding && !booking ? [{ employeeId: me.employeeId, fullName: `${me.fullName} (you)` }] : []),
    ...supported.filter((m) => !m.booked && m.employeeId !== me.employeeId),
  ];
  if (attendees.length === 0) {
    return (
      <>
        {bookedLine}
        <div className="card" data-testid="orientation-no-attendee">
          <p style={{ marginTop: 0 }}>
            {supported.length > 0 ? "Everyone you support in onboarding already has a session." : "No one you support is in onboarding."}
          </p>
          <Link to="/onboarding">See onboarding</Link>
        </div>
      </>
    );
  }
  // The attendee is always one of the listed options. A manager or HR admin who is not in onboarding
  // is not an option, so the default is the first listed attendee: exactly what the select shows.
  const attendee = attendees.some((a) => a.employeeId === employeeId) ? employeeId : (attendees[0] as { employeeId: string }).employeeId;
  const forSelf = attendee === me.employeeId;
  const regionChoice: RegionChoice = region ?? (forSelf && !initialSessionId ? "mine" : "all");
  const matches = (s: Session) =>
    regionChoice === "all" ? true : regionChoice === "mine" ? s.region === me.region || s.region === "GLOBAL" : s.region === regionChoice;
  const shown = sessions.data.sessions.filter((s) => s.id === sessionId || matches(s));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const parsed = ScheduleOrientationSessionInput.safeParse({
      sessionId,
      ...(attendee !== me.employeeId ? { employeeId: attendee } : {}),
    });
    if (!parsed.success) {
      setChoose(true);
      tableRef.current?.querySelector<HTMLInputElement>('input[type="radio"]:not(:disabled)')?.focus();
      return;
    }
    setChoose(false);
    setSubmitError(null);
    setBusy(true);
    try {
      onProposed(await api.propose("schedule_orientation_session", parsed.data, supersedes));
    } catch (err) {
      setSubmitError(err);
      // Seats and start times may have changed since the list loaded.
      const reason = err instanceof ApiClientError ? (err.details as { reason?: string } | undefined)?.reason : undefined;
      if (reason === "session_full" || reason === "session_in_past" || reason === "not_found") sessions.reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {bookedLine}
      <form className="card" onSubmit={submit} aria-label="Book an orientation session" noValidate>
        {me.role !== "employee" ? (
          <div className="field">
            <label htmlFor="attendee">Attendee</label>
            <select id="attendee" value={attendee} onChange={(e) => setEmployeeId(e.target.value)}>
              {attendees.map((a) => (
                <option key={a.employeeId} value={a.employeeId}>
                  {a.fullName} ({a.employeeId})
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="field" style={{ maxWidth: 280 }}>
          <label htmlFor="session-region">Region</label>
          <select id="session-region" value={regionChoice} onChange={(e) => setRegion(e.target.value as RegionChoice)}>
            <option value="mine">Your region ({me.region}) and Global</option>
            {(["US", "UK", "IN", "GLOBAL", "all"] as const).map((r) => (
              <option key={r} value={r}>
                {REGION_LABEL[r]}
              </option>
            ))}
          </select>
        </div>
        <fieldset className="session-fieldset" aria-describedby={choose ? "session-error" : undefined}>
          <legend>Session</legend>
          {shown.length === 0 ? (
            <div className="banner" data-testid="no-sessions-in-region">
              <span>No sessions in this region.</span>
              <button type="button" className="btn" onClick={() => setRegion("all")}>
                Show all regions
              </button>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table session-table" ref={tableRef}>
                <thead>
                  <tr>
                    <th scope="col">
                      <span className="visually-hidden">Choose</span>
                    </th>
                    <th scope="col">Session</th>
                    <th scope="col">Starts</th>
                    <th scope="col">Seats left</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((s) => (
                    <tr key={s.id} className={s.seatsRemaining === 0 ? "session-full" : undefined}>
                      <td>
                        <input
                          type="radio"
                          id={`session-${s.id}`}
                          name="session"
                          value={s.id}
                          checked={sessionId === s.id}
                          disabled={s.seatsRemaining === 0}
                          onChange={() => {
                            setSessionId(s.id);
                            setChoose(false);
                          }}
                          aria-label={`${s.title}, ${s.id}`}
                        />
                      </td>
                      <td>
                        <label htmlFor={`session-${s.id}`} className="session-label">
                          {s.title}
                          <span className="message-meta">
                            {s.id} · {s.location}
                          </span>
                        </label>
                      </td>
                      <td>{formatDateTime(s.startsAt)}</td>
                      <td>{s.seatsRemaining === 0 ? "Full" : `${s.seatsRemaining} of ${s.capacity}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {choose ? (
            <p className="field-error" id="session-error" role="alert">
              Choose a session.
            </p>
          ) : null}
        </fieldset>
        {submitError ? <SubmitError error={submitError} /> : null}
        <button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>
          {supersedes ? "Update request" : "Review request"}
        </button>
      </form>
    </>
  );
}
