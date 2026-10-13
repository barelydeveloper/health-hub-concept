export {
  BF_FLOOR,
  CAPPED_ASSUMPTIONS,
  DISCLAIMER,
  FORECAST_VERSION,
  KCAL_PER_LB,
  LEAN_GAIN_CAP_LB_PER_WEEK,
  MAX_FAT_LOSS_FRACTION_OF_BW,
  MAX_FAT_LOSS_LB_PER_WEEK,
  MODE_MULTIPLIER,
  backtest,
  detectPlateau,
  linearModel,
  projectCapped,
  projectLinear,
} from "./project";

export type {
  BacktestResult,
  CappedInput,
  CappedResult,
  CappedWeek,
  ForecastMode,
  LinearModel,
  LinearProjection,
  PlateauResult,
  SeriesPoint,
} from "./project";

export { GOAL_DISCLAIMER, projectGoal } from "./goals";
export type { GoalProjection, GoalSpec } from "./goals";
