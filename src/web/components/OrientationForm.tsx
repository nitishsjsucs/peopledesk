// Structured orientation booking: a session table with seats remaining, a region filter, and for
// managers and HR an attendee selector from /api/team (the same directory slice the chat router sees).
// It shows a form only to someone who could book: a person in onboarding without a booking books for
// themself; a manager or HR admin books for the people they support who have none. The server still
// decides every proposal (ActionService.propose); this only avoids offering a form that cannot succeed.
import { useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link } from "react-router";
import type { Me, OrientationBooking, PendingActionView, Session, Team } from "../../shared/api-types.ts";
import { ScheduleOrientationSessionInput } from "../../shared/tool-schemas.ts";
import { api, ApiClientError } from "../lib/api.ts";
import { formatDateTime } from "../lib/format.ts";
import { useMe } from "../lib/session.tsx";
import { useAsync } from "../lib/use-async.ts";
import { ErrorBanner } from "./ErrorBanner.tsx";
import { SubmitError } from "./SubmitError.tsx";

type Props = {
  /** The page's subtitle, shown only above a form (never above "you're booked" or why you cannot book). */
  intro?: ReactNode;
  /** The session of the request this form starts from, or of ?session=; never kept if it is full now. */
  initialSessionId?: string;
  /**
   * The attendee of the request this form starts from (the viewer's own id for a request without an
   * employeeId), or of ?employee=. Kept only while that person can still be booked for; otherwise the
   * form says why and asks for a choice instead of picking someone else.
   */
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

/** Why a person named by the link or the request being edited is not among the attendees. */
function unavailableAttendee(id: string, me: Me, ownBooking: OrientationBooking | null, members: Team["members"]): string {
  if (id === me.employeeId) return ownBooking ? "You already have an orientation session." : "You are not in onboarding, so you cannot book a session for yourself.";
  const m = members.find((x) => x.employeeId === id);
  if (!m) return `${id} is not one of the people you can book for.`;
  if (m.booked) return `${m.fullName} (${id}) already has an orientation session.`;
  if (!m.inOnboarding) return `${m.fullName} (${id}) is not in onboarding.`;
  return `${m.fullName} (${id}) cannot be booked here.`;
}

/** "You're booked into ..." for the viewer's own booking. */
export function OwnBooking({ booking }: { booking: OrientationBooking }) {
  return (
    <>
      You're booked into {booking.title} ({booking.sessionId}) on {formatDateTime(booking.startsAt)}, {booking.location}.
    </>
  );
}

function BookingForm({ intro, initialSessionId, initialEmployeeId, supersedes, onProposed }: Props) {
  const me = useMe();
  const sessions = useAsync(() => api.sessions(), []);
  const team = useAsync(() => (me.role === "employee" ? Promise.resolve({ members: [] }) : api.team()), [me.role]);
  const own = useAsync(() => (me.inOnboarding ? api.orientationBooking() : Promise.resolve({ booking: null })), [me.inOnboarding]);
  const [sessionId, setSessionId] = useState(initialSessionId ?? "");
  /** The attendee picked in the select; null until the person picks one. */
  const [picked, setPicked] = useState<string | null>(null);
  const [region, setRegion] = useState<RegionChoice | null>(null);
  const [choose, setChoose] = useState(false);
  const [chooseAttendee, setChooseAttendee] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const tableRef = useRef<HTMLTableElement>(null);
  const attendeeRef = useRef<HTMLSelectElement>(null);

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
  // The attendee shown is always the one proposed for, and is never swapped for someone else: a person
  // named by the link or by the request being edited who can no longer be booked for (booked since, for
  // example) leaves the select on "Choose an attendee" with the reason beside it. Without a name, the
  // viewer (when listed) or the only person listed is chosen; otherwise the person chooses.
  const listed = (id: string) => attendees.some((a) => a.employeeId === id);
  const first = (attendees[0] as { employeeId: string }).employeeId;
  const initialListed = initialEmployeeId !== undefined && listed(initialEmployeeId);
  const fallback = initialEmployeeId !== undefined ? (initialListed ? initialEmployeeId : "") : first === me.employeeId || attendees.length === 1 ? first : "";
  const attendee = me.role === "employee" ? me.employeeId : (picked ?? fallback);
  const attendeeNote =
    me.role !== "employee" && picked === null && initialEmployeeId !== undefined && !initialListed
      ? unavailableAttendee(initialEmployeeId, me, booking, team.data.members)
      : null;
  const forSelf = attendee === me.employeeId;
  const regionChoice: RegionChoice = region ?? (forSelf && !initialSessionId ? "mine" : "all");
  const matches = (s: Session) =>
    regionChoice === "all" ? true : regionChoice === "mine" ? s.region === me.region || s.region === "GLOBAL" : s.region === regionChoice;
  const shown = sessions.data.sessions.filter((s) => s.id === sessionId || matches(s));
  // A chosen session that is full now, or no longer listed (it started, or was removed), is not a
  // choice: it is never checked or proposed, and the form says to choose another.
  const chosen = sessions.data.sessions.find((s) => s.id === sessionId);
  const chosenOpen = chosen !== undefined && chosen.seatsRemaining > 0;
  const sessionNote = sessionId && !chosenOpen ? `${sessionId} ${chosen ? "is full now" : "is no longer open for booking"}. Choose another session.` : null;
  const sessionProblem = choose ? (sessionNote ?? "Choose a session.") : sessionNote;
  const attendeeProblem = chooseAttendee ? `${attendeeNote ? `${attendeeNote} ` : ""}Choose an attendee.` : attendeeNote;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const noAttendee = attendee === "";
    const parsed = ScheduleOrientationSessionInput.safeParse({
      sessionId: chosenOpen ? sessionId : "",
      ...(attendee !== me.employeeId ? { employeeId: attendee } : {}),
    });
    if (noAttendee || !parsed.success) {
      setChooseAttendee(noAttendee);
      setChoose(!chosenOpen);
      if (noAttendee) attendeeRef.current?.focus();
      else tableRef.current?.querySelector<HTMLInputElement>('input[type="radio"]:not(:disabled)')?.focus();
      return;
    }
    setChoose(false);
    setChooseAttendee(false);
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
      {intro}
      {bookedLine}
      <form className="card" onSubmit={submit} aria-label="Book an orientation session" noValidate>
        {me.role !== "employee" ? (
          <div className="field">
            <label htmlFor="attendee">Attendee</label>
            <select
              id="attendee"
              ref={attendeeRef}
              value={attendee}
              onChange={(e) => {
                setPicked(e.target.value);
                if (e.target.value) setChooseAttendee(false);
              }}
              aria-invalid={chooseAttendee || undefined}
              aria-describedby={attendeeProblem ? "attendee-error" : undefined}
            >
              {attendee === "" ? <option value="">Choose an attendee</option> : null}
              {attendees.map((a) => (
                <option key={a.employeeId} value={a.employeeId}>
                  {a.fullName} ({a.employeeId})
                </option>
              ))}
            </select>
            {attendeeProblem ? (
              <p className="field-error" id="attendee-error" key={chooseAttendee ? "alert" : "note"} role={chooseAttendee ? "alert" : undefined}>
                {attendeeProblem}
              </p>
            ) : null}
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
        <fieldset className="session-fieldset" aria-describedby={sessionProblem ? "session-error" : undefined}>
          <legend>Session</legend>
          {sessionProblem ? (
            <p className="field-error" id="session-error" key={choose ? "alert" : "note"} role={choose ? "alert" : undefined}>
              {sessionProblem}
            </p>
          ) : null}
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
                          checked={chosenOpen && sessionId === s.id}
                          disabled={s.seatsRemaining === 0}
                          onChange={() => {
                            setSessionId(s.id);
                            setChoose(false);
                          }}
                          // Several sessions share a title, so the name also gives the id, place and start.
                          aria-labelledby={`session-${s.id}-title session-${s.id}-meta session-${s.id}-starts`}
                        />
                      </td>
                      <td>
                        <label htmlFor={`session-${s.id}`} className="session-label">
                          <span id={`session-${s.id}-title`}>{s.title}</span>
                          <span className="message-meta" id={`session-${s.id}-meta`}>
                            {s.id} · {s.location}
                          </span>
                        </label>
                      </td>
                      <td id={`session-${s.id}-starts`}>{formatDateTime(s.startsAt)}</td>
                      <td>{s.seatsRemaining === 0 ? "Full" : `${s.seatsRemaining} of ${s.capacity}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </fieldset>
        {submitError ? <SubmitError error={submitError} /> : null}
        <button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>
          {supersedes ? "Update request" : "Review request"}
        </button>
      </form>
    </>
  );
}
