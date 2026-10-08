# F2 Category hierarchy migration

Adds tenant-scoped category hierarchy fields without deleting category or product rows.

Runtime rules:

- `parentId` may point only to a category in the authenticated company.
- category self-parent/cycles are rejected by the service.
- inactive parent categories cannot receive new children.
- a category with active children or active products cannot be deactivated.
- category slug uniqueness moves from global scope to `companyId + slug` so separate tenants can use the same catalog taxonomy.
- display-name duplication is rejected within the same parent level by business validation.

Apply the matching SQLite/PostgreSQL migration before deploying application code that writes `parentId`, `sortOrder`, or `isActive`.
