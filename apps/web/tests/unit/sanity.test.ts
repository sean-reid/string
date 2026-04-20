import { expect, test } from "vitest";

test("sanity: vitest environment is wired up", () => {
  expect(typeof document).toBe("object");
  expect(typeof window).toBe("object");
  expect(1 + 1).toBe(2);
});
