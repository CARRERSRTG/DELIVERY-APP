import { describe, it, expect } from "vitest";
import { missingFields, missingKeys, isIntraStore, isPickupOrTransfer } from "@/lib/required";

// A fully-valid regular delivery.
const complete = {
  order_type: "Delivery",
  store: "McAllen",
  pickup_name: "RDZ McAllen Warehouse",
  pickup_address: "2400 N 23rd St, McAllen TX",
  delivery_name: "Rio Tile Co.",
  delivery_address: "123 Main St, McAllen TX",
  contact: "Ana",
  delivery_phone: "9561234567",
  delivery_date: "2026-07-20",
  delivery_windows: "0900-1100",
  est_pallets: 4,
  invoice_num: "INV-1",
};
const keys = (d: object) => missingFields(d).map((m) => m.key).sort();

describe("order type helpers", () => {
  it("detects intra-store transfers", () => {
    expect(isIntraStore("Intra-Tienda")).toBe(true);
    expect(isIntraStore("intra tienda")).toBe(true);
    expect(isIntraStore("Delivery")).toBe(false);
  });

  it("detects pickups and transfers", () => {
    expect(isPickupOrTransfer("Pickup")).toBe(true);
    expect(isPickupOrTransfer("Will Call")).toBe(true);
    expect(isPickupOrTransfer("Transfer")).toBe(true);
    expect(isPickupOrTransfer("PU")).toBe(true);
    expect(isPickupOrTransfer("Delivery")).toBe(false);
  });
});

describe("missingFields — always-required", () => {
  it("passes a complete delivery", () => {
    expect(missingFields(complete)).toEqual([]);
  });

  it("flags every required field when the order is empty", () => {
    expect(keys({})).toEqual([
      "contact", "delivery_address", "delivery_date", "delivery_name", "delivery_phone",
      "delivery_windows", "est_pallets", "order_type", "pickup_address", "pickup_name", "store",
    ]);
  });

  it("flags a missing pickup name or address", () => {
    expect(keys({ ...complete, pickup_name: "" })).toContain("pickup_name");
    expect(keys({ ...complete, pickup_address: "" })).toContain("pickup_address");
  });

  it("flags a missing dropoff name or address", () => {
    expect(keys({ ...complete, delivery_name: null })).toContain("delivery_name");
    expect(keys({ ...complete, delivery_address: null })).toContain("delivery_address");
  });

  it("flags a missing contact name", () => {
    expect(keys({ ...complete, contact: "  " })).toContain("contact");
  });

  it("flags a missing or too-short phone", () => {
    expect(keys({ ...complete, delivery_phone: null })).toContain("delivery_phone");
    expect(keys({ ...complete, delivery_phone: "555" })).toContain("delivery_phone");
  });

  it("accepts a formatted phone number", () => {
    expect(missingFields({ ...complete, delivery_phone: "(956) 555-0142" })).toEqual([]);
  });

  it("flags a missing order type", () => {
    expect(keys({ ...complete, order_type: "" })).toContain("order_type");
    expect(keys({ ...complete, order_type: null })).toContain("order_type");
    expect(keys({ ...complete, order_type: "   " })).toContain("order_type");
  });

  it("flags a missing store", () => {
    expect(keys({ ...complete, store: null })).toContain("store");
  });

  it("flags a missing delivery date or window", () => {
    expect(keys({ ...complete, delivery_date: null })).toContain("delivery_date");
    expect(keys({ ...complete, delivery_windows: "  " })).toContain("delivery_windows");
  });

  it("flags missing, zero or negative pallets", () => {
    expect(keys({ ...complete, est_pallets: null })).toContain("est_pallets");
    expect(keys({ ...complete, est_pallets: 0 })).toContain("est_pallets");
    expect(keys({ ...complete, est_pallets: -2 })).toContain("est_pallets");
  });
});

describe("missingFields — document reference by order type", () => {
  it("requires the customer invoice on a regular delivery", () => {
    expect(keys({ ...complete, invoice_num: "" })).toContain("invoice_num");
  });

  it("accepts ANY ONE of the three for Intra-Tienda", () => {
    const base = { ...complete, order_type: "Intra-Tienda", invoice_num: "", so_num: "", po2: "" };
    expect(keys(base)).toContain("doc_ref");
    expect(missingFields({ ...base, po2: "PO-1" })).toEqual([]);
    expect(missingFields({ ...base, so_num: "SO-1" })).toEqual([]);
    expect(missingFields({ ...base, invoice_num: "INV-1" })).toEqual([]);
  });

  it("requires no paperwork for Pickup", () => {
    expect(missingFields({ ...complete, order_type: "Pickup", invoice_num: "" })).toEqual([]);
  });

  it("requires no paperwork for Transfer", () => {
    expect(missingFields({ ...complete, order_type: "Transfer", invoice_num: "" })).toEqual([]);
  });

  it("requires no paperwork for Will Call", () => {
    expect(missingFields({ ...complete, order_type: "Will Call", invoice_num: "" })).toEqual([]);
  });

  it("still enforces the always-required fields on a Pickup", () => {
    expect(keys({ order_type: "Pickup" })).toEqual([
      "contact", "delivery_address", "delivery_date", "delivery_name", "delivery_phone",
      "delivery_windows", "est_pallets", "pickup_address", "pickup_name", "store",
    ]);
  });
});

describe("missingKeys", () => {
  it("lights up all three reference fields when doc_ref is missing", () => {
    const k = missingKeys({ ...complete, order_type: "Intra-Tienda", invoice_num: "", so_num: "", po2: "" });
    expect(k.has("po2")).toBe(true);
    expect(k.has("so_num")).toBe(true);
    expect(k.has("invoice_num")).toBe(true);
  });

  it("is empty for a complete order", () => {
    expect(missingKeys(complete).size).toBe(0);
  });
});
