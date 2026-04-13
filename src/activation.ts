import fs from "node:fs/promises";
import type { AdapterConfig } from "./config.js";

type EmployeeActivationRecord = {
  agentId?: string;
  activatedAt?: string;
  name?: string;
  department?: string;
  email?: string;
};

type EmployeeActivationStore = {
  version?: unknown;
  employees?: unknown;
};

function parseActivationStore(raw: string): Record<string, EmployeeActivationRecord> {
  const parsed = JSON.parse(raw) as EmployeeActivationStore;
  if (!parsed || typeof parsed !== "object" || !parsed.employees || typeof parsed.employees !== "object") {
    return {};
  }
  return parsed.employees as Record<string, EmployeeActivationRecord>;
}

export async function isEmployeeActivated(params: {
  config: AdapterConfig;
  employeeId: string;
  agentId: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!params.config.REQUIRE_EMPLOYEE_ACTIVATION) {
    return { ok: true };
  }
  let raw: string;
  try {
    raw = await fs.readFile(params.config.PLATFORMCLAW_EMPLOYEE_ACTIVATION_PATH, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: false, reason: "employee activation store not found" };
    }
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  let employees: Record<string, EmployeeActivationRecord>;
  try {
    employees = parseActivationStore(raw);
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  const record = employees[params.employeeId];
  if (!record) {
    return { ok: false, reason: "employee not activated" };
  }
  if (typeof record.agentId === "string" && record.agentId.trim() && record.agentId !== params.agentId) {
    return { ok: false, reason: "employee activated for different agentId" };
  }
  return { ok: true };
}
