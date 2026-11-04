import type { StudyReportCapability } from "./types";

export interface StudyReportEntitlementContext {
  moduleEnabled?: boolean;
  organizationCapabilities?: Partial<Record<StudyReportCapability, boolean>>;
  userCapabilities?: Partial<Record<StudyReportCapability, boolean>>;
  roleCapabilities?: Partial<Record<StudyReportCapability, boolean>>;
}

/**
 * Future tier hook. The foundation is available by default and does not change existing billing,
 * plans, roles or core map access. Any explicit false decision disables the requested capability.
 */
export function hasStudyReportCapability(
  capability: StudyReportCapability,
  context: StudyReportEntitlementContext = {},
): boolean {
  if (context.moduleEnabled === false) return false;
  const decisions = [
    context.organizationCapabilities?.[capability],
    context.roleCapabilities?.[capability],
    context.userCapabilities?.[capability],
  ].filter((value): value is boolean => value !== undefined);
  return !decisions.includes(false);
}
