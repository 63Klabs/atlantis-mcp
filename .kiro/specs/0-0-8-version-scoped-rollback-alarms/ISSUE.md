# The PROD rollback alarm watches the whole function, not the version being shifted

Spun off from [0-0-7-api-gateway-live-alias PLAN.md](../0-0-7-api-gateway-live-alias/PLAN.md) (Decision 5). Observed in the beta rollback drill on 2026-10-28 ([VERIFICATION.md](../0-0-7-api-gateway-live-alias/VERIFICATION.md), "Rollback drill (beta)").

## Summary

Now that API Gateway invokes the Read function's `live` alias, CodeDeploy's gradual shift protects API callers and `ReadLambdaErrorsAlarm` is what stops a bad version. The drill proved the stop-and-rollback path works. It did not prove the alarm detects a real bad version: the alarm was forced with `set-alarm-state`. The alarm's definition has three properties that may make it a weak or noisy rollback signal for a shift.

## How it works today

[`template.yml`](../../../application-infrastructure/template.yml), `ReadLambdaErrorsAlarm` (about L2115), created only when `CreateAlarms` is true (PROD stages):

| Property | Value |
|----------|-------|
| Metric | `AWS/Lambda` `Errors`, statistic `Sum` |
| Dimension | `FunctionName` only |
| Condition | `GreaterThanThreshold` 1, `Period` 900, `EvaluationPeriods` 1 |
| Missing data | `notBreaching` |
| Action | Publish to `ReadLambdaErrorAlarmNotification` (SNS) |

The Read function's CodeDeploy deployment group lists this alarm, with automatic rollback on `DEPLOYMENT_STOP_ON_ALARM`.

## Concerns

1. **Not version-scoped.** The `FunctionName` dimension aggregates every version and alias, including `$LATEST`. During a shift, errors from the previous version, from `$LATEST`, or from non-API callers count toward the same alarm, so a healthy candidate can be rolled back, and a failing candidate is diluted by healthy traffic from the old version.
2. **Weak sensitivity at low shift percentages.** The first step sends 10% of traffic to the candidate. With a threshold of more than 1 error in a 15 minute period, a candidate failing on a small number of requests may not trip the alarm before the shift moves on.
3. **Detection lag.** The alarm evaluates a 900 second period. A burst of errors early in a 3 minute step can take a while to show as `ALARM`; the drill measured CodeDeploy's reaction after the alarm changed state (3.5 seconds), not the alarm's reaction to errors.
4. **Not exercised with real errors.** No rollback from real errors has been observed on any stage. Last observed `Errors` state change on beta and prod was 2026-03-16.

## Deployed state

- Alarm: `OK`, actions enabled, on beta and prod; none on test.
- `AWS/Lambda` `Invocations` is published with the `Resource` dimension `<function-name>:live` and with `ExecutedVersion` (the drill saw `ExecutedVersion=48` and `=47`). Whether `Errors` carries the same dimensions was not checked.

## Expected behavior

During a PROD shift, an alarm that reflects the health of the version receiving shifted traffic stops and rolls back a failing candidate quickly, and does not roll back a healthy one because of unrelated errors.

## Options to evaluate

1. **Alias-scoped alarm:** an `Errors` alarm with `Resource` set to `<function-name>:live` (excludes `$LATEST` and non-alias callers). Check that the dimension is published for `Errors`.
2. **Version-scoped alarm:** `ExecutedVersion` changes every deploy, so a static alarm cannot name it. Evaluate metric math or a CodeDeploy hook instead.
3. **Error rate instead of count:** `Errors` over `Invocations`, so the signal scales with traffic. Note the low traffic on `beta` and `prod`.
4. **Pre or post-traffic CodeDeploy hook:** a validation Lambda that smoke-tests the candidate version before and during traffic shifting (larger design).
5. **Shorter period and evaluation settings** for the existing alarm.

Each new alarm costs a small monthly amount per alarm and adds notifications; decide per stage.

## How to verify a fix

Repeat the beta drill with a deliberately failing candidate (not only a forced alarm state), using synthetic traffic during the shift. The expected result is a rollback within a few minutes of the shift starting, with the stack ending `UPDATE_ROLLBACK_COMPLETE`. The restore procedure is in [`docs/admin-ops/deployment/README.md`](../../../docs/admin-ops/deployment/README.md) ("Recovering after a rolled-back deploy").

## Out of scope

Dashboard widgets based on the alias (the dashboard uses `FunctionName` today).
