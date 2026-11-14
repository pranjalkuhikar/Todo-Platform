import Shell from "@/components/Shell";
import AccountForms from "@/components/AccountForms";
import { requireUser } from "@/lib/page-auth";

export const dynamic = "force-dynamic";

export default async function Account() {
  const { user, access } = await requireUser("/account");
  return (
    <Shell user={user} active="account">
      <h1>Your account</h1>
      <div className="two">
        <section className="card">
          <h3>Profile</h3>
          <dl className="kv"><dt>Name</dt><dd>{user.name}</dd><dt>Email</dt><dd>{user.email}</dd><dt>Role</dt><dd>{user.role}</dd>
            <dt>Apps</dt><dd>{access.list.length ? access.list.map((a) => `${a.icon} ${a.name} (${a.app_role})`).join(", ") : "none yet"}</dd></dl>
        </section>
        <AccountForms />
      </div>
    </Shell>
  );
}
