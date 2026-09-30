# Technicians API (Phase 4)

Owner and Manager only. Technician records are created with the user (`POST /users`, role TECHNICIAN);
these endpoints set up their skills, areas, hours and time off. Lists are paginated (`page`, `pageSize`).

| Method | Path | What |
| --- | --- | --- |
| GET | `/technicians?q=` | List with skills, areas and working hours |
| GET | `/technicians/:id` | One technician |
| PUT | `/technicians/:id/skills` | `{ categoryIds: [] }` replaces the skill list |
| PUT | `/technicians/:id/areas` | `{ areas: ["Kondapur"] }` replaces the list; spelling is normalised like address areas |
| PUT | `/technicians/:id/working-hours` | `{ days: [7 x { dayOfWeek 0-6, startTime, endTime, isOff }] }` (0 = Sunday, `HH:mm` in Asia/Kolkata) |
| GET | `/technicians/:id/time-off?includePast=` | Upcoming time off by default |
| POST | `/technicians/:id/time-off` | `{ startAt, endAt, reason: SICK\|LEAVE\|OTHER, note? }` ISO timestamps **with offset**, e.g. `2026-10-05T09:00:00+05:30` |
| DELETE | `/technicians/:id/time-off/:timeOffId` | Remove (204) |

Errors: 400 validation, 404 unknown technician, 409 `TIME_OFF_OVERLAP` for overlapping time off.
Every change writes an `AuditLog` row (`TECHNICIAN_SKILLS_SET`, `TECHNICIAN_AREAS_SET`, `TECHNICIAN_HOURS_SET`, `TIME_OFF_ADDED`, `TIME_OFF_REMOVED`).

Known gap (Phase 6+): adding time off does not yet touch existing bookings in that window. When
bookings exist, they should be flagged `needsReassignment`.
