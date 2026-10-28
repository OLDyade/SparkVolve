# Paired validation interruption and explicit cancellation

The public `validate` command previously installed no SIGINT/SIGTERM handler, and `validateStudy` did not forward a signal to `validateFrozenArm`. A driver interrupt could therefore terminate the CLI without releasing the active observer lease or stopping admission coherently.

The lifecycle now distinguishes two explicit operations:

```text
validate --root STUDY ...
  SIGINT / SIGTERM → abort current observer → release lease → retain original attempt
                    → do not start later arms or publish a completed comparison

cancel-validation --root STUDY
  verify frozen registration → close admission → cancel registered children
  → preserve cleanup evidence → validation-cancellation.json
```

`validateFrozenArm` retains its existing recoverable observation semantics. The lifecycle owner waits for the observer to exit before issuing `cancel-validation`. Already initialized children use the same identity-checked `cancelExperiment` path as parent optimizer studies. Partial initialization is explicitly `unstarted`; no child experiment database is invented. A missing prepared ledger, changed registration, symbolic link or damaged completed receipt fails. Repeating cancellation resumes cleanup and verifies the same receipts; it never resumes task execution.

The registration intent can authorize cleanup before `registration.json` is published. A completely unregistered directory cannot produce a successful cancellation receipt. The parent cancellation SQLite file permanently closes new validation admission, including when cleanup itself was interrupted.

Verification includes protocol regression tests and a real public-CLI/container test, `tests/container/validation-cancellation.test.ts`: a task is confirmed running, SIGINT is handled, its original container identity remains, explicit cancellation removes it, repeated cancellation is identical, rerunning validation is rejected and the second arm remains unstarted. The fixture supplies deterministic LLM events to the real DSH runtime; it makes no external model requests. First successful run evidence is `.evolution/validation-cancellation-native-8vu9fB/acceptance.json`, using frozen image `sha256:ed2c995b6233c41995925b9407d6ab01312f052015cae60a22a4b8871e09715f` for task runtime and the current host CLI for lifecycle control. This verifies interruption/cancellation, not model quality.
