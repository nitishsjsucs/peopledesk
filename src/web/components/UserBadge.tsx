import type { Me } from "../../shared/api-types.ts";
import type { AuthMode } from "../../shared/domain.ts";

const ROLE_LABEL: Record<Me["role"], string> = { employee: "Employee", manager: "Manager", hr_admin: "HR admin" };

type Props = { me: Me; authMode: AuthMode | null; next: string };

/** Who is signed in, and the way out: switch persona locally, sign out of Cloudflare Access in production. */
export function UserBadge({ me, authMode, next }: Props) {
  return (
    <div className="user-badge">
      <span className="user-badge-who" aria-label={`Signed in as ${me.fullName}, ${ROLE_LABEL[me.role]}`} title={me.fullName}>
        <span className="user-badge-name">{me.fullName}</span>
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
