# Employee Portal Productization — UI-P5

## Scope

UI-P5 memisahkan Employee Portal dari satu halaman panjang menjadi application shell dan self-service workspace yang dapat di-deep-link:

- `/` — Home
- `/attendance` — Attendance
- `/leave` — Leave & izin
- `/overtime` — Overtime
- `/payslips` — Payslips
- `/history` — Attendance history
- `/profile` — Employee profile/context

## Invariants

UI-P5 tidak mengubah business authority.

- employee identity tetap berasal dari `/employee/me`;
- employee token refresh tetap memakai `employeeAuthFetch` dan event refresh/expired existing;
- attendance event tetap membawa company/branch/employee context, operation ID, GPS, optional selfie, geofence, dan server validation;
- leave/overtime tetap melalui approval flow backend existing;
- payslip visibility tetap berasal dari published payroll data backend;
- route visibility bukan authorization boundary.

## Browser/UAT contract

Productization mempertahankan literal/runtime contract existing:

- `TOKO360 HR`
- `Portal Karyawan`
- `Employee Portal authenticated self-service`
- employee authenticated runtime tetap menggunakan token/session existing.

Human Stage-20 UAT tetap manual dan tidak boleh dipenuhi automated simulation.
