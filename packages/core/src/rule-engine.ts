import { detectorSchema, type ActivitySnapshot, type ConstitutionRule, type MessageSample, type RuleEvaluation } from "./types.js";
import { evaluateDetector } from "./detectors.js";

function parseDetector(rule: ConstitutionRule) {
  let value: unknown;
  try {
    value = JSON.parse(rule.detector_json);
  } catch {
    throw new Error(`Rule ${rule.rule_id} has invalid detector JSON`);
  }
  return detectorSchema.parse(value);
}

export function evaluateRule(
  rule: ConstitutionRule,
  message: MessageSample,
  activity: ActivitySnapshot = { authorMessages: [] },
): RuleEvaluation {
  if (!rule.active || rule.mode === "contextual") {
    return {
      outcome: "allow",
      ruleId: rule.rule_id,
      ruleVersion: rule.version,
      action: rule.action,
      detector: null,
    };
  }

  const detector = parseDetector(rule);
  const detectorResult = evaluateDetector(detector, message, activity);
  if (detectorResult.outcome === "clear") {
    return {
      outcome: "allow",
      ruleId: rule.rule_id,
      ruleVersion: rule.version,
      action: rule.action,
      detector: detectorResult,
    };
  }

  const outcome =
    detector.on_match === "review" || rule.mode === "hybrid"
      ? "review"
      : "violation";
  return {
    outcome,
    ruleId: rule.rule_id,
    ruleVersion: rule.version,
    action: rule.action,
    detector: detectorResult,
  };
}

export function evaluateRules(
  rules: ReadonlyArray<ConstitutionRule>,
  message: MessageSample,
  activity: ActivitySnapshot = { authorMessages: [] },
): RuleEvaluation[] {
  return rules.map((rule) => evaluateRule(rule, message, activity));
}

