import type { PopupWorkflowPhase } from "./workflow-phase";

const PHASES: Array<{ label: string; value: PopupWorkflowPhase }> = [
  { label: "Plan", value: "plan" },
  { label: "Run", value: "run" },
  { label: "Results", value: "results" },
];

export function WorkflowPhaseRail({ phase }: { phase: PopupWorkflowPhase }) {
  const currentIndex = PHASES.findIndex((item) => item.value === phase);
  return (
    <ol className="workflow-phase-rail" aria-label="Archive workflow">
      {PHASES.map((item, index) => (
        <li
          key={item.value}
          className={
            index === currentIndex
              ? "workflow-phase-current"
              : index < currentIndex
                ? "workflow-phase-complete"
                : "workflow-phase-pending"
          }
          aria-current={index === currentIndex ? "step" : undefined}
        >
          <span aria-hidden="true">{index < currentIndex ? "✓" : index + 1}</span>
          {item.label}
        </li>
      ))}
    </ol>
  );
}
