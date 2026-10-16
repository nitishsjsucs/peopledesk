// A row of counts that are also the way in: buttons that filter the list below them (aria-pressed),
// or links to a filtered page. Each count is a number of people (or tickets), never a share of a
// whole, so tiles that overlap never read as parts of one total. The accessible name reads as a
// sentence ("19 people with overdue tasks") and contains the visible number and label, built in one
// place so it does not depend on how a browser joins the tile's inline and block parts.
import type { Ref } from "react";
import { Link } from "react-router";

export type TileIcon = "people" | "calendar" | "blocked" | "clock" | "check";

export type Tile = {
  key: string;
  count: number;
  /** Visible label, lowercase first ("with overdue tasks"); the first letter is shown in capitals. */
  label: string;
  icon: TileIcon;
  /** The counted noun for screen readers, after the number: ["person", "people"] by default. */
  noun?: readonly [string, string];
  /** Read after the label only, for example ", show them" on a link. */
  hint?: string;
  href?: string;
};

const PATHS: Record<TileIcon, string> = {
  people: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6 M16 4.5a3.5 3.5 0 0 1 0 6.5 M18 14.5c2.2.6 3.5 2.6 3.5 5.5",
  calendar: "M4 6h16v14H4Z M4 10h16 M8 3v4 M16 3v4 M10 13.5l4 4 M14 13.5l-4 4",
  blocked: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M5.6 5.6l12.8 12.8",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M12 7v5l3.5 2",
  check: "M4.5 12.5l5 5 10-11",
};

/** A small outline icon in the style of EmptyState's illustration; decorative (the label carries it). */
export function TileIconSvg({ icon }: { icon: TileIcon }) {
  return (
    <svg className="stat-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={PATHS[icon]} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** "19 people with overdue tasks": the number, the noun and the label, then any hint. */
export function tileName(tile: Tile): string {
  const [one, many] = tile.noun ?? ["person", "people"];
  return `${tile.count} ${tile.count === 1 ? one : many} ${tile.label}${tile.hint ?? ""}`;
}

function TileBody({ tile }: { tile: Tile }) {
  return (
    <>
      <span className="stat-top">
        <TileIconSvg icon={tile.icon} />
        <span className="stat-value">{tile.count}</span>
      </span>
      <span className="stat-label">{tile.label}</span>
    </>
  );
}

type FilterProps = {
  mode: "filter";
  /** The group's name, for example "Show". */
  label: string;
  tiles: Tile[];
  selected: string;
  onSelect: (key: string) => void;
  /** Refs to tile buttons by key, for moving focus to one. */
  buttonRefs?: Partial<Record<string, Ref<HTMLButtonElement>>>;
};

type LinkProps = { mode: "link"; label: string; tiles: Tile[] };

export function StatTiles(props: FilterProps | LinkProps) {
  const cols = `stat-tiles stat-tiles-${props.tiles.length}`;
  if (props.mode === "link") {
    return (
      <ul className={`${cols} stat-tiles-links`} aria-label={props.label}>
        {props.tiles.map((t) => (
          <li key={t.key}>
            <Link className="stat-tile" to={t.href ?? "#"} aria-label={tileName(t)} data-testid={`tile-${t.key}`}>
              <TileBody tile={t} />
            </Link>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className={cols} role="group" aria-label={props.label}>
      {props.tiles.map((t) => (
        <button
          key={t.key}
          type="button"
          className="stat-tile"
          aria-pressed={props.selected === t.key}
          aria-label={tileName(t)}
          onClick={() => props.onSelect(t.key)}
          ref={props.buttonRefs?.[t.key]}
          data-testid={`tile-${t.key}`}
        >
          <TileBody tile={t} />
        </button>
      ))}
    </div>
  );
}
