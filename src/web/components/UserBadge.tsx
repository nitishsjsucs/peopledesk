import type { Me } from "../../shared/api-types.ts";
import type { AuthMode } from "../../shared/domain.ts";

const ROLE_LABEL: Record<Me["role"], string> = { employee: "Employee", manager: "Manager", hr_admin: "HR admin" };

type Props = { me: Me; authMode: AuthMode | null; next: string };

/** Who is signed in, and the way out: switch persona locally, sign out of Cloudflare Access in production. */
export function UserBadge({ me, authMode, next }: Props) {
  return (
    <div className="user-badge">
      {/* Plain text, not an aria-label (which a generic span cannot carry): on a phone the name is only
          visually hidden, so a screen reader still reads "Signed in as <name>, <role>". */}
      <span className="user-badge-who" title={me.fullName}>
        <span className="visually-hidden">Signed in as </span>
        <span className="user-badge-name">{me.fullName}</span>
        <span className="visually-hidden">, </span>
        <span className="role-badge">{ROLE_LABEL[me.role]}</span>
      </span>
      {authMode === "dev" ? (
        <a className="user-badge-action" href={`/dev/login?next=${encodeURIComponent(next)}`}>
          Switch persona
        </a>
      ) : authMode === "access" ? (
        <a className="user-badge-action" href="/cdn-cgi/access/logout">
          Sign out
        </a>
      ) : null}
    </div>
  );
}
