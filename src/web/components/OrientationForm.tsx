// Structured orientation booking: a session table with seats remaining, and for managers and HR an
// attendee selector from /api/team (the same directory slice the chat router sees).
import { useState } from "react";
import type { FormEvent } from "react";
import type { PendingActionView } from "../../shared/api-types.ts";
import { ScheduleOrientationSessionInput } from "../../shared/tool-schemas.ts";
import { api } from "../lib/api.ts";
import { formatDateTime } from "../lib/format.ts";
import { useMe } from "../lib/session.tsx";
import { useAsync } from "../lib/use-async.ts";
import { errorMessage } from "./ErrorBanner.tsx";

type Props = {
  initialSessionId?: string;
  initialEmployeeId?: string;
  supersedes?: string;
  onProposed: (view: PendingActionView) => void;
};

export function OrientationForm({ initialSessionId, initialEmployeeId, supersedes, onProposed }: Props) {
  const me = useMe();
  const sessions = useAsync(() => api.sessions(), []);
  const team = useAsync(() => (me.role === "employee" ? Promise.resolve({ members: [] }) : api.team()), [me.role]);
  const [sessionId, setSessionId] = useState(initialSessionId ?? "");
  const [employeeId, setEmployeeId] = useState(initialEmployeeId ?? me.employeeId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const attendees = [
    ...(me.inOnboarding ? [{ employeeId: me.employeeId, fullName: `${me.fullName} (you)` }] : []),
    ...(team.data?.members ?? []).filter((m) => m.inOnboarding && !m.booked),
  ];

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = ScheduleOrientationSessionInput.safeParse({
      sessionId,
      ...(employeeId && employeeId !== me.employeeId ? { employeeId } : {}),
    });
    if (!parsed.success) {
      setError("Choose a session.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      onProposed(await api.propose("schedule_orientation_session", parsed.data, supersedes));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit} aria-label="Book an orientation session">
      {me.role !== "employee" ? (
        <div className="field">
          <label htmlFor="attendee">Attendee</label>
          <select id="attendee" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            {attendees.length === 0 ? <option value={me.employeeId}>No one in onboarding needs a booking</option> : null}
            {attendees.map((a) => (
              <option key={a.employeeId} value={a.employeeId}>
                {a.fullName} ({a.employeeId})
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <fieldset style={{ border: 0, padding: 0, margin: "0 0 12px" }}>
        <legend style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>Session</legend>
        <div className="table-wrap">
          <table className="table">
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
              {(sessions.data?.sessions ?? []).map((s) => (
                <tr key={s.id}>
                  <td>
                    <input
                      type="radio"
                      name="session"
                      value={s.id}
                      checked={sessionId === s.id}
                      disabled={s.seatsRemaining === 0}
                      onChange={() => setSessionId(s.id)}
                      aria-label={`${s.title}, ${s.id}`}
                      style={{ width: "auto" }}
                    />
                  </td>
                  <td>
                    {s.title}
                    <div className="message-meta">
                      {s.id} · {s.location}
                    </div>
                  </td>
                  <td>{formatDateTime(s.startsAt)}</td>
                  <td>{s.seatsRemaining === 0 ? "Full" : `${s.seatsRemaining} of ${s.capacity}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </fieldset>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {supersedes ? "Update request" : "Review request"}
      </button>
    </form>
  );
}
