import ReactECharts from "echarts-for-react";
import type { BandPoint } from "../lib/api";

const AXIS = { axisLabel: { color: "#737373", fontSize: 11 }, axisLine: { lineStyle: { color: "#262626" } } };

export default function FanChart({ band, after }: { band: BandPoint[]; after?: BandPoint[] }) {
  const option: any = {
    backgroundColor: "transparent",
    grid: { left: 52, right: 44, top: 32, bottom: 28 },
    legend: { top: 0, itemWidth: 14, itemHeight: 2, textStyle: { color: "#737373", fontSize: 11 },
      data: ["Plan", "Expected", "After action", "Rain (mm)"] },
    tooltip: {
      trigger: "axis",
      backgroundColor: "#0a0a0a", borderColor: "#404040", borderWidth: 1,
      textStyle: { color: "#e5e5e5", fontSize: 12 },
      formatter: (p: any) => {
        const b = band[p[0].dataIndex];
        const a = after?.[p[0].dataIndex];
        return `${b.date}<br/>Plan ${b.planned.toFixed(0)} t<br/>Expected ${b.q50.toFixed(0)} t`
          + `<br/>Range ${b.q10.toFixed(0)}–${b.q90.toFixed(0)} t<br/>Rain ${b.rain_mm.toFixed(0)} mm`
          + (a ? `<br/><b style="color:#22c55e">After action ${a.q50.toFixed(0)} t</b>` : "");
      },
    },
    xAxis: { type: "category", data: band.map((b) => b.date.slice(5)), ...AXIS },
    yAxis: [
      { type: "value", name: "t/day", nameTextStyle: { color: "#737373", fontSize: 11 }, ...AXIS,
        splitLine: { lineStyle: { color: "#1c1c1c" } }, min: (v: { min: number }) => Math.floor(v.min * 0.85) },
      { type: "value", inverse: true, max: (v: { max: number }) => Math.max(80, v.max * 2.2),
        ...AXIS, splitLine: { show: false } },
    ],
    series: [
      { name: "_base", type: "line", stack: "band", data: band.map((b) => b.q10), symbol: "none", lineStyle: { opacity: 0 } },
      { name: "_band", type: "line", stack: "band", data: band.map((b) => b.q90 - b.q10), symbol: "none",
        lineStyle: { opacity: 0 }, areaStyle: { color: "rgba(245,158,11,0.12)" } },
      { name: "Rain (mm)", type: "bar", yAxisIndex: 1, data: band.map((b) => b.rain_mm),
        itemStyle: { color: "rgba(56,189,248,0.35)" }, barWidth: "36%" },
      { name: "Plan", type: "line", data: band.map((b) => b.planned), symbol: "none",
        lineStyle: { type: "dashed", color: "#525252", width: 1 } },
      { name: "Expected", type: "line", data: band.map((b) => b.q50), symbol: "none",
        lineStyle: { color: "#f59e0b", width: 2 }, itemStyle: { color: "#f59e0b" } },
      ...(after ? [{ name: "After action", type: "line", data: after.map((b) => b.q50),
        symbol: "none", lineStyle: { color: "#22c55e", width: 2 }, itemStyle: { color: "#22c55e" } }] : []),
    ],
  };
  return <ReactECharts option={option} notMerge style={{ height: 320 }} />;
}
