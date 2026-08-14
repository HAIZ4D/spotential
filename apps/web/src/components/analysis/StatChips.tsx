/**
 * The four figures worth seeing without scrolling or opening a tab.
 *
 * Each carries its own state colour on a left rule rather than a tinted body:
 * four filled colour blocks would compete with the score ring, which is the
 * one thing that should pull the eye first.
 */

export interface Chip {
  label: string;
  value: string;
  note?: string | undefined;
  tone?: "navy" | "green" | "amber" | "red" | undefined;
}

export function StatChips({ chips }: { chips: Chip[] }) {
  return (
    <div className="chips">
      {chips.map((chip, index) => (
        <div
          key={chip.label}
          className={`chip ${chip.tone ?? ""}`}
          // Staggered so the row assembles rather than appearing at once.
          style={{ animationDelay: `${index * 55}ms` }}
        >
          <div className="chip-label">{chip.label}</div>
          <div className="chip-value">{chip.value}</div>
          {chip.note && <div className="chip-note">{chip.note}</div>}
        </div>
      ))}
    </div>
  );
}
