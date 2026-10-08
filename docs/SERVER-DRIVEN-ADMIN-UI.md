# Server-Driven Admin UI

UI-P6 memperluas runtime manifest dari top-level Admin navigation ke nested domain workspace.

## Resolution order

1. Canonical workspace/view tetap didefinisikan di source.
2. Runtime module catalog + feature flag menentukan module yang aktif.
3. Token role/permission hanya mengurangi visibility UI.
4. `UiSchemaDefinition` surface `admin` dapat memberi `domainViews` override untuk `hidden`, `order`, `label`, `title`, dan `description`.
5. Override yang tidak menunjuk canonical workspace/key diabaikan.

Contoh schema:

```json
{
  "domainViews": [
    { "workspace": "finance", "key": "banking", "order": 1, "label": "Rekonsiliasi" },
    { "workspace": "people", "key": "compliance", "hidden": true }
  ]
}
```

UiSchema tidak membuat route/action baru dan tidak menjadi authorization boundary. Semua API, tenant scope, permission guard, dan business validation tetap authoritative di backend.
