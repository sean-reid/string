import { describe, expect, test } from "vitest";
import {
  COLOR_BUDGET_FLOOR,
  deriveColorBudgets,
} from "@/solver/physics";

describe("deriveColorBudgets", () => {
  test("returns an empty array for mono palettes", () => {
    const budgets = deriveColorBudgets(["#111111"], 4000);
    expect(budgets.length).toBe(0);
  });

  test("sum of budgets matches the line budget exactly", () => {
    const palette = ["#111111", "#cc2020", "#2030cc", "#ddcc30"];
    const budgets = deriveColorBudgets(
      palette,
      5000,
      new Float32Array([0.1, 0.45, 0.35, 0.10]),
    );
    const sum = Array.from(budgets).reduce((a, b) => a + b, 0);
    expect(sum).toBe(5000);
  });

  test("shares drive allocation proportional to image dominance", () => {
    // Red share is 2x blue share, so red budget should clearly exceed
    // blue budget — image-aware allocation, not even split.
    const palette = ["#111111", "#cc2020", "#2030cc"];
    const budgets = deriveColorBudgets(
      palette,
      3000,
      new Float32Array([0.1, 0.6, 0.3]),
    );
    expect(budgets[1]).toBeGreaterThan((budgets[2] ?? 0) * 1.5);
  });

  test("applies a per-color floor so no color starves", () => {
    // Red claims 99% of explanatory share. Blue and green should
    // still get at least the floor fraction of the line budget.
    const palette = ["#111111", "#cc2020", "#2030cc", "#30cc30"];
    const lineBudget = 4000;
    const budgets = deriveColorBudgets(
      palette,
      lineBudget,
      new Float32Array([0.005, 0.99, 0.003, 0.002]),
    );
    const floor = Math.floor(lineBudget * COLOR_BUDGET_FLOOR * 0.8);
    expect(budgets[0]).toBeGreaterThanOrEqual(floor);
    expect(budgets[2]).toBeGreaterThanOrEqual(floor);
    expect(budgets[3]).toBeGreaterThanOrEqual(floor);
  });

  test("falls back to a 40 / 60 split when shares are missing", () => {
    const palette = ["#111111", "#cc2020", "#2030cc"];
    const budgets = deriveColorBudgets(palette, 3000);
    // Slot 0 gets roughly 40 % of the budget under the legacy path.
    expect(budgets[0]).toBeGreaterThan(1000);
    expect(budgets[0]).toBeLessThan(1400);
    const sum = Array.from(budgets).reduce((a, b) => a + b, 0);
    expect(sum).toBe(3000);
  });

  test("falls back when share array length mismatches palette", () => {
    const palette = ["#111111", "#cc2020", "#2030cc"];
    // Wrong length — should silently fall back to the legacy split.
    const budgets = deriveColorBudgets(palette, 2000, new Float32Array([0.5, 0.5]));
    const sum = Array.from(budgets).reduce((a, b) => a + b, 0);
    expect(sum).toBe(2000);
    expect(budgets[0]).toBeGreaterThan(700);
  });
});
