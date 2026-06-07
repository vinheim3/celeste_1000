import { readFileSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";
import type { GoalCheckpoints } from "./types";

// GOAL_CHECKPOINTS is loaded from goals.yaml at server startup.
// Edit goals.yaml to update chapter requirements — no TypeScript changes needed.
export const GOAL_CHECKPOINTS: GoalCheckpoints = yaml.load(
  readFileSync(join(process.cwd(), "src/lib/goals.yaml"), "utf-8"),
) as GoalCheckpoints;

export const GOAL_DISPLAY: Record<string, string> = {
  "7a": "7a",
  "7b": "7b",
  "7c": "7c",
  "9a": "8a",
  "9b": "8b",
  "9c": "8c",
  "10a": "Empty Space",
  "10b": "Farewell",
};

export const GOAL_KEYS: Record<string, string[]> = {
  "7a": ["The Summit A - 2500 M Key"],
  "10a": [
    "Farewell - Power Source Key 1",
    "Farewell - Power Source Key 2",
    "Farewell - Power Source Key 3",
    "Farewell - Power Source Key 4",
    "Farewell - Power Source Key 5",
  ],
  "10b": [
    "Farewell - Power Source Key 1",
    "Farewell - Power Source Key 2",
    "Farewell - Power Source Key 3",
    "Farewell - Power Source Key 4",
    "Farewell - Power Source Key 5",
  ],
};
