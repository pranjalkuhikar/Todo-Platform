import Shell from "@/components/Shell";
import AdminConsole from "@/components/AdminConsole";
import { requireUser } from "@/lib/page-auth";

export const dynamic = "force-dynamic";

export default async function Admin() {
  const { user } = await requireUser("/admin", { admin: true });
  return (
    <Shell user={user} active="admin">
      <AdminConsole me={user} />
    </Shell>
  );
}
