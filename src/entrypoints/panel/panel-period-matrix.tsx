import React from "react";
import type { FiledReturnsDownloadScope } from "../../connectors/gst/filed-returns-contracts";
import type { FiledReturnsReturnType } from "../../connectors/gst/filed-returns-return-types";
import type { PeriodMatrixRunnable } from "./panel-period-matrix-model";
import {
  periodMatrixRows,
  resolvePeriodMatrixSelection,
  wholeYearSelection,
  type PeriodMatrixSelection,
} from "./panel-period-matrix-model";

/**
 * The period grid: return types down, the year's eligible months across.
 *
 * Selecting by painting a grid is the whole point -- picking twelve targets from a dropdown
 * one at a time is the surface this replaces. Every cell is still a real button, so the grid
 * is reachable by keyboard without a pointer: click sets a single period, shift-click extends
 * the range, and a row label takes that return's whole year.
 */

/**
 * How much of a month name fits above a column.
 *
 * Thirteen columns inside the 320px panel floor leave about 20px each, which is one letter.
 * A part-finished year has far fewer, and there three letters fit and read better. The full
 * name is on `title` and in every cell's accessible name either way.
 */
function monthHeading(period: string, columnCount: number): string {
  return period.slice(0, columnCount > 6 ? 1 : 3);
}

export function PanelPeriodMatrix({
  artifactType,
  firstControlRef,
  asOf,
  busy,
  disabled,
  financialYear,
  financialYearOptions,
  onFinancialYearChange,
  onStart,
}: {
  artifactType: FiledReturnsDownloadScope["artifactType"];
  /** Where focus lands when this view opens, so opening it does not drop focus to the body. */
  firstControlRef?: React.Ref<HTMLButtonElement>;
  asOf: Date;
  busy: string | null;
  disabled: boolean;
  financialYear: string;
  financialYearOptions: readonly string[];
  onFinancialYearChange: (financialYear: string) => void;
  /** A single cell starts an ordinary scope run; several start a selected-targets run. */
  onStart: (resolution: PeriodMatrixRunnable) => void;
}) {
  const [selection, setSelection] = React.useState<PeriodMatrixSelection | null>(null);
  const [painting, setPainting] = React.useState(false);
  const rows = periodMatrixRows(financialYear, asOf);
  const resolution = resolvePeriodMatrixSelection(selection, financialYear, artifactType, asOf);

  // A year change invalidates the months a selection names, and silently keeping it would let
  // the button describe a run over months the new year may not offer.
  const clearSelection = React.useCallback(() => setSelection(null), []);

  const extendTo = React.useCallback(
    (returnType: FiledReturnsReturnType, period: string) => {
      setSelection((current) => {
        if (!current || current.returnType !== returnType) {
          return { returnType, from: period, to: period };
        }
        const periods = rows.find((row) => row.returnType === returnType)?.cells ?? [];
        const anchor = periods.findIndex((cell) => cell.period === current.from);
        const next = periods.findIndex((cell) => cell.period === period);
        if (anchor < 0 || next < 0) return current;
        return next < anchor
          ? { returnType, from: period, to: current.from }
          : { returnType, from: current.from, to: period };
      });
    },
    [rows],
  );

  const isSelected = (returnType: FiledReturnsReturnType, period: string): boolean => {
    if (!selection || selection.returnType !== returnType) return false;
    const cells = rows.find((row) => row.returnType === returnType)?.cells ?? [];
    const from = cells.findIndex((cell) => cell.period === selection.from);
    const to = cells.findIndex((cell) => cell.period === selection.to);
    const here = cells.findIndex((cell) => cell.period === period);
    return here >= from && here <= to;
  };

  return (
    <div className="panel-matrix" onPointerUp={() => setPainting(false)}>
      <h2>Choose periods</h2>
      <p className="muted panel-matrix-hint">
        Click a month, drag or shift-click for a range, or use a return name to take its whole year.
      </p>

      <div className="panel-matrix-grid" role="group" aria-label="Filed return periods">
        <table>
          <thead>
            <tr>
              <th scope="col" aria-label="Return" />
              {(rows[0]?.cells ?? []).map((cell) => (
                <th key={cell.period} scope="col" abbr={cell.period} title={cell.period}>
                  {monthHeading(cell.period, rows[0]?.cells.length ?? 0)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.returnType}>
                <th scope="row">
                  <button
                    type="button"
                    ref={index === 0 ? firstControlRef : undefined}
                    className="panel-matrix-row-label"
                    // The visible label is the return's short name; what the button does --
                    // take that return's whole year -- rides on the accessible name, so the
                    // column stays narrow enough to leave the cells their width.
                    aria-label={`Select every eligible period of ${row.returnType} for ${financialYear}`}
                    title={`Every eligible ${row.returnType} period`}
                    disabled={disabled || busy !== null}
                    onClick={() =>
                      setSelection(wholeYearSelection(row.returnType, financialYear, asOf))
                    }
                  >
                    {row.returnType.replace("GSTR-", "")}
                  </button>
                </th>
                {row.cells.map((cell) => (
                  <td key={cell.period}>
                    <button
                      type="button"
                      className="panel-matrix-cell"
                      aria-pressed={isSelected(row.returnType, cell.period)}
                      aria-label={`${row.returnType} ${cell.period} ${financialYear}`}
                      disabled={disabled || busy !== null || !cell.selectable}
                      onPointerDown={(event) => {
                        setPainting(true);
                        if (event.shiftKey) extendTo(row.returnType, cell.period);
                        else
                          setSelection({
                            returnType: row.returnType,
                            from: cell.period,
                            to: cell.period,
                          });
                      }}
                      onPointerEnter={() => {
                        if (painting) extendTo(row.returnType, cell.period);
                      }}
                      onClick={(event) => {
                        if (event.shiftKey) extendTo(row.returnType, cell.period);
                      }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {financialYearOptions.length > 1 ? (
        <label className="panel-matrix-year">
          <span>Financial year</span>
          <select
            value={financialYear}
            disabled={busy !== null}
            onChange={(event) => {
              clearSelection();
              onFinancialYearChange(event.target.value);
            }}
          >
            {financialYearOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <p className="muted panel-matrix-status" role="status">
        {resolution.runnable
          ? `${resolution.periodCount} ${resolution.periodCount === 1 ? "period" : "periods"} selected`
          : resolution.reason}
      </p>

      <div className="panel-guide-actions">
        <button
          type="button"
          className="primary-action"
          disabled={!resolution.runnable || disabled || busy !== null}
          onClick={() => {
            if (resolution.runnable) onStart(resolution);
          }}
        >
          {busy !== null
            ? "Starting..."
            : resolution.runnable && resolution.periodCount > 1
              ? `Download ${resolution.periodCount} periods as one ZIP`
              : "Download"}
        </button>
      </div>
    </div>
  );
}
