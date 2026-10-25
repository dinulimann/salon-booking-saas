import { expect, it } from "vitest";
import { normalizePhone } from "@/lib/phone";

it("normalises the ways people write Indonesian mobile numbers", () => {
  for (const s of ["0812-3456-7890", "+62 812 3456 7890", "6281234567890", "812 3456 7890"]) {
    expect(normalizePhone(s)).toBe("6281234567890");
  }
  expect(normalizePhone("021 555 1234")).toBeNull(); // landline
  expect(normalizePhone("12345")).toBeNull();
});
