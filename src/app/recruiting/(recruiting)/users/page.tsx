import { redirect } from "next/navigation";

// User management unified into deliveries' own /users (D-053) — one screen
// where an admin sets both the deliveries role and recruiting access,
// instead of two separate pages that both write to the same shared
// `profiles` row. This route stays, rather than disappearing outright, so an
// old bookmark or a stale link in someone's history still lands somewhere.
export default function RecruitingUsersPage() {
  redirect("/users");
}
