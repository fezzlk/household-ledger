# Development guidance

- Preserve user data and existing changes. Keep private runtime settings and financial records out of Git.
- Run `npm test` and `npm run build` after changes to accounting, storage, authentication, or deployment.
- Keep local SQLite and production Firestore behavior consistent. Do not start a Firestore emulator.
- Never interpret missing card data as zero or confuse reimbursement with income or card repayment.
- Deploy only through the single managed Cloud Build trigger and `cloudbuild.yaml`.
- Keep Cloud Run in one region, minimum instances zero, CPU throttling enabled, CPU boost and session affinity disabled, timeout at most 300 seconds.
- Keep credentials in Secret Manager or local ignored storage; never embed values in source, logs, or deployment arguments.
- Keep generated reports in `output/`. Pin shared guidance revisions in `.agent-kit.lock`.
