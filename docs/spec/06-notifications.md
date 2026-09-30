<!-- BusinessHub spec part: Notifications and pg-boss jobs -->

## 11. Notifications and Background Jobs (pg-boss)

Events: booking confirmed, technician assigned, reminder (e.g. 24h and 2h before), technician en route, service completed, review request after completion.

- Store in-app notifications in the `Notification` table and send emails through jobs.
- The booking API only enqueues jobs, then returns immediately.
- Scheduled reminder jobs are cancelled or re-scheduled when a booking is cancelled or rescheduled.
- Failed jobs retry with backoff. Failures are logged.
- The worker runs as a separate npm script (`npm run worker`) in the same backend codebase.
- Customers without email get in-app notifications only. There is no SMS or WhatsApp sending in v1 (future work), so the manager sees a "call customer" flag instead.
