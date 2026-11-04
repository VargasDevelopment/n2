export const NODES_PLANNING_SHAPE_SQL = `
  (planning_kind IS NULL AND planning_start_date IS NULL AND planning_end_date IS NULL) OR
  (kind IN ('task', 'group') AND planning_kind IS NOT NULL AND (
    (planning_kind = 'milestone' AND planning_start_date IS NOT NULL AND planning_end_date IS NULL) OR
    (planning_kind = 'window' AND planning_start_date IS NOT NULL AND planning_end_date IS NOT NULL AND planning_start_date <= planning_end_date)
  ))
`;
