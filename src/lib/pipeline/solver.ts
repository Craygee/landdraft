import { LIQUID_SOLVER_VERSION, solveSteadyLiquid } from "./liquidSolver.ts";
import type {
  PipeSpecification,
  PipelineComponent,
  PipelineFluid,
  PipelineRoute,
  PipelineScenario,
  PipelineSolverRun,
  SolverFinding,
} from "./types.ts";
import { pipelineInputHash } from "./model.ts";

export interface SolverDescriptor {
  id: string;
  name: string;
  version: string;
  phaseModel: "single-phase-liquid" | "single-phase-gas" | "multiphase";
  timeModel: "steady" | "extended-period" | "transient";
  validationStatus: "preliminary-unvalidated" | "benchmark-validated" | "engineering-reviewed";
  supportedComponentKinds: PipelineComponent["kind"][];
}

export interface SolverContext {
  route: PipelineRoute;
  scenario: PipelineScenario;
  fluid: PipelineFluid;
  pipe: PipeSpecification;
  components: PipelineComponent[];
}

export interface SolverCapabilityReport {
  supported: boolean;
  findings: SolverFinding[];
}

export interface PipelineSolver {
  descriptor: SolverDescriptor;
  supports(context: SolverContext): SolverCapabilityReport;
  solve(context: SolverContext, signal?: AbortSignal): PipelineSolverRun;
}

const preliminaryLiquidSolver: PipelineSolver = {
  descriptor: {
    id: "liquid-steady-v1",
    name: "Native steady incompressible liquid screening",
    version: LIQUID_SOLVER_VERSION,
    phaseModel: "single-phase-liquid",
    timeModel: "steady",
    validationStatus: "preliminary-unvalidated",
    supportedComponentKinds: [
      "source",
      "destination",
      "block-valve",
      "centrifugal-pump",
      "flow-meter",
      "booster-station",
    ],
  },
  supports(context) {
    const findings: SolverFinding[] = [];
    if (context.fluid.family !== "liquid")
      findings.push({
        id: "capability-fluid-family",
        severity: "blocker",
        code: "ADVANCED_ANALYSIS_REQUIRED",
        title: "Advanced multiphase analysis required",
        detail: `The native liquid screening solver does not support ${context.fluid.name}.`,
      });
    const unsupported = context.components.filter(
      (component) => !this.descriptor.supportedComponentKinds.includes(component.kind),
    );
    if (unsupported.length)
      findings.push({
        id: "capability-components",
        severity: "blocker",
        code: "COMPONENT_MODEL_REQUIRED",
        title: "A validated component model is required",
        detail: `${unsupported.map((component) => component.name).join(", ")} cannot yet be included in the preliminary liquid solver.`,
      });
    return { supported: findings.length === 0, findings };
  },
  solve(context, signal) {
    if (signal?.aborted) throw new DOMException("Pipeline solve cancelled", "AbortError");
    return solveSteadyLiquid(context);
  },
};

const solverRegistry = new Map<string, PipelineSolver>([
  [preliminaryLiquidSolver.descriptor.id, preliminaryLiquidSolver],
]);

export function availablePipelineSolvers(): SolverDescriptor[] {
  return Array.from(solverRegistry.values(), (solver) => solver.descriptor);
}

export function solvePipeline(context: SolverContext, signal?: AbortSignal): PipelineSolverRun {
  const solver = solverRegistry.get(context.scenario.solverId);
  if (!solver) return unsupportedRun(context, "The selected solver is not installed or enabled.");
  const capability = solver.supports(context);
  if (!capability.supported)
    return {
      ...unsupportedRun(context, capability.findings[0]?.detail ?? "The model is unsupported."),
      solverId: solver.descriptor.id,
      solverVersion: solver.descriptor.version,
      findings: capability.findings,
    };
  return solver.solve(context, signal);
}

function unsupportedRun(context: SolverContext, detail: string): PipelineSolverRun {
  const now = Date.now();
  return {
    id: `run-${now}`,
    scenarioId: context.scenario.id,
    routeId: context.route.id,
    solverId: context.scenario.solverId,
    solverVersion: "unavailable",
    readiness: "preliminary-unvalidated",
    status: "unsupported",
    inputHash: pipelineInputHash(
      context.route,
      context.scenario,
      context.fluid,
      context.pipe,
      context.components,
    ),
    geometryRevision: context.route.geometryRevision,
    startedAt: now,
    completedAt: now,
    profile: [],
    findings: [
      {
        id: "advanced-analysis-required",
        severity: "blocker",
        code: "ADVANCED_ANALYSIS_REQUIRED",
        title: "Advanced multiphase analysis required",
        detail,
      },
    ],
  };
}
