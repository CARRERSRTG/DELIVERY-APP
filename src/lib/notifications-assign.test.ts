import { describe, it, expect } from "vitest";
import { ASSIGNED_KIND, assignmentNotification } from "./notifications";
import type { Profile } from "./types";

const users: Profile[] = [
  { id: "d1", full_name: "Maximo Garza", role: "driver" },
  { id: "d2", full_name: "Otro Chofer", role: "driver" },
  { id: "l1", full_name: "Maximo Garza", role: "logistics" },  // same name, wrong role
];

const base = { order_no: 1120, order_code: "FQ120", delivery_id: "o1", users, actorId: "l9" };

describe("assignmentNotification", () => {
  it("tells the driver the stop is theirs", () => {
    const n = assignmentNotification({ ...base, driverName: "Maximo Garza" });
    expect(n?.user_id).toBe("d1");
    expect(n?.kind).toBe(ASSIGNED_KIND);
    expect(n?.message).toContain("#FQ120");
  });

  it("includes the date when there is one", () => {
    const n = assignmentNotification({ ...base, driverName: "Maximo Garza", delivery_date: "2026-08-15" });
    expect(n?.message).toContain("2026-08-15");
  });

  it("says nothing when a stop is UNassigned", () => {
    // Taking work away is not news the driver needs pushed at them, and a
    // null name would otherwise match nobody and throw.
    expect(assignmentNotification({ ...base, driverName: null })).toBeNull();
    expect(assignmentNotification({ ...base, driverName: "" })).toBeNull();
  });

  it("says nothing for a lane that isn't a real driver", () => {
    // Routes Manager allows temporary lanes ("Truck 2") with no user behind
    // them; there is nobody to notify.
    expect(assignmentNotification({ ...base, driverName: "Truck 2" })).toBeNull();
  });

  it("does not match a non-driver who happens to share the name", () => {
    const only = users.filter((u) => u.role !== "driver");
    expect(assignmentNotification({ ...base, users: only, driverName: "Maximo Garza" })).toBeNull();
  });

  it("does not ping a driver for their own action", () => {
    // A driver claiming an unowned order at pickup assigns it to themselves.
    expect(assignmentNotification({ ...base, driverName: "Maximo Garza", actorId: "d1" })).toBeNull();
  });

  it("falls back to the order number when there is no code", () => {
    const n = assignmentNotification({ ...base, order_code: null, driverName: "Maximo Garza" });
    expect(n?.message).toContain("#1120");
  });
});
