import { redirect } from "next/navigation";

// Users moved to the hub (D-056) — one screen reachable from either module
// instead of living inside deliveries specifically. This route stays, rather
// than disappearing outright, so an old bookmark or nav habit still lands
// somewhere real.
export default function UsersRedirect() {
  redirect("/home/users");
}
