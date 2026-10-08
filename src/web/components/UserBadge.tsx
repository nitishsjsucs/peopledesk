import type { Me } from "../../shared/api-types.ts";

const ROLE_LABEL: Record<Me["role"], string> = { employee: "Employee", manager: "Manager", hr_admin: "HR admin" };

export function UserBadge({ me }: { me: Me }) {
  return (
    <div className="user-badge" aria-label={`Signed in as ${me.fullName}, ${ROLE_LABEL[me.role]}`} title={me.fullName}>
      <span className="user-badge-name">{me.fullName}</span>
      <span className="role-badge">{ROLE_LABEL[me.role]}</span>
    </div>
  );
}
