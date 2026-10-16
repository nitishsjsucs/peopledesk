// A person's onboarding tasks as one 10px stacked bar of exactly three segments that add up to the
// total: done, overdue (not done and past due) and not due yet (the rest). Blocked is not a segment,
// because a blocked task can be overdue or not yet due; callers print it in the text line. Every value
// is in that text line, which is also the bar's accessible name, so the bar needs no tooltip.

export type TaskCounts = {
  total: number;
  done: number;
  /** null while the business date is unknown: the bar then shows done and not done only. */
  overdue: number | null;
};

export type TaskSegment = { key: "done" | "overdue" | "rest"; count: number };

/** The non-empty segments, in order; their counts add up to the total. */
export function taskSegments({ total, done, overdue }: TaskCounts): TaskSegment[] {
  const d = Math.max(0, Math.min(done, total));
  const o = overdue === null ? 0 : Math.max(0, Math.min(overdue, total - d));
  const segments: TaskSegment[] = [
    { key: "done", count: d },
    { key: "overdue", count: o },
    { key: "rest", count: total - d - o },
  ];
  return segments.filter((s) => s.count > 0);
}

type Props = {
  counts: TaskCounts;
  /** The visible text line under the bar, and the bar's accessible name. */
  text: string;
  testId?: string;
};

export function TaskBar({ counts, text, testId }: Props) {
  const segments = taskSegments(counts);
  return (
    <div className="task-bar-block" data-testid={testId}>
      <div className="task-bar" role="img" aria-label={text}>
        {segments.length === 0 ? (
          <span className="task-seg task-seg-rest" style={{ flexGrow: 1 }} />
        ) : (
          segments.map((s) => <span key={s.key} className={`task-seg task-seg-${s.key}`} data-segment={s.key} data-count={s.count} style={{ flexGrow: s.count }} />)
        )}
      </div>
      {/* The bar's name already says this; the visible copy is not read twice. */}
      <p className="task-line" aria-hidden="true">
        {text}
      </p>
    </div>
  );
}

/** The key for task bars, shown once per list. Without a business date there is no overdue segment. */
export function TaskBarLegend({ overdue = true }: { overdue?: boolean }) {
  const items: Array<[TaskSegment["key"], string]> = overdue
    ? [
        ["done", "Done"],
        ["overdue", "Overdue"],
        ["rest", "Not due yet"],
      ]
    : [
        ["done", "Done"],
        ["rest", "Not done"],
      ];
  return (
    <ul className="chart-legend" aria-label="Task bar key">
      {items.map(([key, label]) => (
        <li key={key}>
          <span className={`legend-swatch task-seg-${key}`} aria-hidden="true" />
          {label}
        </li>
      ))}
    </ul>
  );
}
