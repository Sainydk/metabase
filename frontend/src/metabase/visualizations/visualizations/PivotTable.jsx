import React, { Component } from "react";
import { t } from "ttag";
import cx from "classnames";
import _ from "underscore";
import { getIn } from "icepick";
import { Grid, List, ScrollSync } from "react-virtualized";

import Ellipsified from "metabase/components/Ellipsified";
import { isDimension } from "metabase/lib/schema_metadata";
import { multiLevelPivot } from "metabase/lib/data_grid";
import { formatColumn, formatValue } from "metabase/lib/formatting";
import { columnSettings } from "metabase/visualizations/lib/settings/column";

import type { VisualizationProps } from "metabase-types/types/Visualization";

// These aren't used yet, but we want to add them to the codebase now to get translations
// eslint-disable-next-line
const _moreStrings = [
  columnName => t`Totals for ${columnName}`,
  t`Grand totals`,
  t`Row totals`,
];

const partitions = [
  {
    name: "rows",
    columnFilter: isDimension,
    title: t`Fields to use for the table rows`,
  },
  {
    name: "columns",
    columnFilter: isDimension,
    title: t`Fields to use for the table columns`,
  },
  {
    name: "values",
    columnFilter: col => !isDimension(col),
    title: t`Fields to use for the table values`,
  },
];

export default class PivotTable extends Component {
  props: VisualizationProps;
  static uiName = t`Pivot Table`;
  static identifier = "pivot";
  static iconName = "pivot_table";

  static isSensible({ cols }) {
    return (
      cols.every(isColumnValid) &&
      cols.filter(col => col.source === "breakout").length < 5
    );
  }

  static checkRenderable([{ data }]) {
    if (!data.cols.every(isColumnValid)) {
      throw new Error(
        t`Pivot tables can only be used with aggregated queries.`,
      );
    }
  }

  static seriesAreCompatible(initialSeries, newSeries) {
    return false;
  }

  static settings = {
    ...columnSettings({ hidden: true }),
    "pivot_table.column_split": {
      section: null,
      widget: "fieldsPartition",
      persistDefault: true,
      getProps: ([{ data }], settings) => ({
        partitions,
        columns: data == null ? [] : data.cols,
      }),
      getValue: ([{ data }], settings = {}) => {
        const storedValue = settings["pivot_table.column_split"];
        let setting;
        if (storedValue == null) {
          const [dimensions, values] = _.partition(
            data.cols.filter(col => !isPivotGroupColumn(col)),
            isDimension,
          );
          const [first, second, ...rest] = _.sortBy(dimensions, col =>
            getIn(col, ["fingerprint", "global", "distinct-count"]),
          );
          let rows, columns;
          if (dimensions.length < 2) {
            columns = [];
            rows = [first];
          } else if (dimensions.length <= 3) {
            columns = [first];
            rows = [second, ...rest];
          } else {
            columns = [first, second];
            rows = rest;
          }
          setting = _.mapObject({ rows, columns, values }, cols =>
            cols.map(col => col.field_ref),
          );
        } else {
          setting = updateValueWithCurrentColumns(storedValue, data.cols);
        }
        return setting;
      },
    },
  };

  render() {
    const { settings, data, width, height } = this.props;
    if (!data.cols.some(isPivotGroupColumn)) {
      return null;
    }
    const { primary, totals, rightTotals, bottomTotals } = splitPivotData(data);
    const {
      rows: rowIndexes,
      columns: columnIndexes,
      values: valueIndexes,
    } = _.mapObject(settings["pivot_table.column_split"], columns => {
      console.log({ columns, primary });
      return columns
        .map(field_ref =>
          primary.cols.findIndex(col => _.isEqual(col.field_ref, field_ref)),
        )
        .filter(index => index !== -1);
    });
    console.log({ rowIndexes, columnIndexes, valueIndexes, primary });

    let pivoted;
    try {
      pivoted = multiLevelPivot(
        primary,
        { totals, bottomTotals, rightTotals },
        columnIndexes,
        rowIndexes,
        valueIndexes,
      );
    } catch (e) {
      console.warn(e);
    }
    console.log(pivoted);
    const { topIndex, leftIndex, getRowSection, subtotalValues } = pivoted;
    const cellWidth = 80;
    const cellHeight = 25;
    const topHeaderHeight =
      topIndex.length === 0 ? cellHeight : topIndex[0].length * cellHeight + 8; // the extravertical padding
    const leftHeaderWidth =
      leftIndex.length === 0 ? 0 : leftIndex[0].length * cellWidth;

    function columnWidth({ index }) {
      if (topIndex.length === 0 || index === topIndex.length) {
        return cellWidth;
      }
      const indexItem = topIndex[index];
      return indexItem[indexItem.length - 1].length * cellWidth;
    }

    function rowHeight({ index }) {
      if (leftIndex.length === 0 || index === leftIndex.length) {
        return cellWidth;
      }
      const indexItem = leftIndex[index];
      return indexItem[indexItem.length - 1].length * cellHeight;
    }

    return (
      <div className="overflow-scroll">
        <ScrollSync>
          {({ onScroll, scrollLeft, scrollTop }) => (
            <div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `${leftHeaderWidth}px auto`,
                }}
              >
                {/* top left corner - displays left header columns */}
                <div className="flex align-end border-right border-bottom border-medium">
                  {rowIndexes.map(index => (
                    <div
                      style={{ height: cellHeight, width: cellWidth }}
                      className="px1"
                    >
                      <Ellipsified>
                        {formatColumn(primary.cols[index])}
                      </Ellipsified>
                    </div>
                  ))}
                </div>
                {/* top header */}
                <Grid
                  className="border-bottom border-medium scroll-hide-all text-medium"
                  width={width - leftHeaderWidth}
                  height={topHeaderHeight}
                  rowCount={1}
                  rowHeight={topHeaderHeight}
                  columnCount={topIndex.length + 1}
                  columnWidth={columnWidth}
                  cellRenderer={({ key, style, columnIndex }) => {
                    if (columnIndex === topIndex.length) {
                      return (
                        <div key={key} style={style}>
                          {t`Row totals`}
                        </div>
                      );
                    }
                    const rows = topIndex[columnIndex];
                    return (
                      <div
                        key={key}
                        style={style}
                        className="flex-column px1 pt1"
                      >
                        {rows.map((row, index) => (
                          <div className="flex" style={{ height: cellHeight }}>
                            {row.map(({ value, span }) => (
                              <div
                                style={{ width: cellWidth * span }}
                                className={cx({
                                  "border-bottom": index < rows.length - 1,
                                })}
                              >
                                <Ellipsified>
                                  {formatValue(value, {
                                    column: primary.cols[columnIndexes[index]],
                                  })}
                                </Ellipsified>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    );
                  }}
                  onScroll={({ scrollLeft }) => onScroll({ scrollLeft })}
                  scrollLeft={scrollLeft}
                />
                {/* left header */}
                <List
                  width={leftHeaderWidth}
                  height={height - topHeaderHeight}
                  className="scroll-hide-all text-dark border-right border-medium"
                  rowCount={leftIndex.length + 1}
                  rowHeight={rowHeight}
                  rowRenderer={({ key, style, index }) => {
                    if (index === leftIndex.length) {
                      return (
                        <div key={key} style={style}>
                          {t`Grand totals`}
                        </div>
                      );
                    }
                    return (
                      <div key={key} style={style} className="flex">
                        {leftIndex[index].map((col, index) => (
                          <div className="flex flex-column">
                            {col.map(({ value, span = 1 }) => (
                              <div
                                style={{
                                  height: cellHeight * span,
                                  width: cellWidth,
                                }}
                                className="p1"
                              >
                                <Ellipsified>
                                  {formatValue(value, {
                                    column: primary.cols[rowIndexes[index]],
                                  })}
                                </Ellipsified>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    );
                  }}
                  scrollTop={scrollTop}
                  onScroll={({ scrollTop }) => onScroll({ scrollTop })}
                />
                {/* pivot table body */}
                <Grid
                  width={width - leftHeaderWidth}
                  height={height - topHeaderHeight}
                  className="text-dark"
                  rowCount={leftIndex.length + 1}
                  rowHeight={rowHeight}
                  columnCount={topIndex.length + 1}
                  columnWidth={columnWidth}
                  cellRenderer={({ key, style, rowIndex, columnIndex }) => {
                    if (
                      rowIndex === leftIndex.length ||
                      columnIndex === topIndex.length
                    ) {
                      if (
                        rowIndex === leftIndex.length &&
                        columnIndex === topIndex.length
                      ) {
                        return (
                          <div key={key} style={style}>
                            {subtotalValues.totals["[]"]}
                          </div>
                        );
                      }
                      if (rowIndex === leftIndex.length) {
                        return (
                          <div key={key} style={style}>
                            {
                              subtotalValues.bottomTotals[
                                JSON.stringify([
                                  topIndex[columnIndex][0][0].value,
                                ])
                              ]
                            }
                          </div>
                        );
                      }
                      if (columnIndex === topIndex.length) {
                        return (
                          <div key={key} style={style}>
                            {
                              subtotalValues.rightTotals[
                                JSON.stringify([
                                  leftIndex[rowIndex][0][0].value,
                                ])
                              ]
                            }
                          </div>
                        );
                      }

                      return null;
                    }
                    const rows = getRowSection(
                      topIndex[columnIndex][0][0].value,
                      leftIndex[rowIndex][0][0].value,
                    );
                    return (
                      <div key={key} style={style} className="flex flex-column">
                        {rows.map(row => (
                          <div className="flex">
                            {row.map(value => (
                              <div
                                style={{ width: cellWidth, height: cellHeight }}
                                className="p1"
                              >
                                {value}
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    );
                  }}
                  onScroll={({ scrollLeft, scrollTop }) =>
                    onScroll({ scrollLeft, scrollTop })
                  }
                  scrollTop={scrollTop}
                  scrollLeft={scrollLeft}
                />
              </div>
            </div>
          )}
        </ScrollSync>
      </div>
    );
  }
}

function updateValueWithCurrentColumns(storedValue, columns) {
  const currentQueryFieldRefs = columns.map(c => JSON.stringify(c.field_ref));
  const currentSettingFieldRefs = Object.values(storedValue).flatMap(
    fieldRefs => fieldRefs.map(field_ref => JSON.stringify(field_ref)),
  );
  const toAdd = _.difference(currentQueryFieldRefs, currentSettingFieldRefs);
  const toRemove = _.difference(currentSettingFieldRefs, currentQueryFieldRefs);

  // remove toRemove
  const value = _.mapObject(storedValue, fieldRefs =>
    fieldRefs.filter(
      field_ref => !toRemove.includes(JSON.stringify(field_ref)),
    ),
  );
  // add toAdd to first partitions where it matches the filter
  for (const fieldRef of toAdd) {
    for (const { filter, name } of partitions) {
      const column = columns.find(
        c => JSON.stringify(c.field_ref) === fieldRef,
      );
      if (filter == null || filter(column)) {
        value[name] = [...value[name], column.field_ref];
        break;
      }
    }
  }
  return value;
}

function isPivotGroupColumn(col) {
  return col.name === "pivot-grouping";
}

function isColumnValid(col) {
  return (
    col.source === "aggregation" ||
    col.source === "breakout" ||
    isPivotGroupColumn(col)
  );
}

function splitPivotData(data) {
  const groupIndex = data.cols.findIndex(isPivotGroupColumn);
  const remainingColumns = data.cols.filter(col => !isPivotGroupColumn(col));
  console.log({ data, groupIndex, remainingColumns });
  const {
    '[["fk->" ["field-id" 13] ["field-id" 4]] ["fk->" ["field-id" 11] ["field-id" 26]]]': primary,
    '[["fk->" ["field-id" 11] ["field-id" 26]]]': rightTotals,
    '[["fk->" ["field-id" 13] ["field-id" 4]]]': bottomTotals,
    "[]": totals,
    ...rest
  } = _.chain(data.rows)
    .groupBy(row => row[groupIndex])
    .mapObject(rows => ({
      cols: remainingColumns,
      rows: rows.map(row =>
        row.slice(0, groupIndex).concat(row.slice(groupIndex + 1)),
      ),
    }))
    .value();

  console.log({ primary, rest });

  return { primary, bottomTotals, rightTotals, totals };
}
