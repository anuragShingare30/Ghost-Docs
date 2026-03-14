command to run server for fileverse locally
```
fileverse-api --apiKey="udN5wWcb2ELAZ7fRMdOgVcx-YgfX8cTN"
```

## API Endpoints

Base URL: `{SERVER_URL}` (e.g. `http://localhost:8001`)

All authenticated endpoints require `apiKey` as a **query parameter**.

### Health Check

```
GET /ping
```

No auth required. Returns `{"reply": "pong"}`.

### List Documents

```
GET /api/ddocs?apiKey={API_KEY}&limit=10&skip=0
```

Response:
```json
{
  "ddocs": [ ... ],
  "total": 100,
  "hasNext": true
}
```

### Get Document

```
GET /api/ddocs/{ddocId}?apiKey={API_KEY}
```

Response:
```json
{
  "ddocId": "abc123",
  "title": "My Document",
  "content": "...",
  "syncStatus": "pending | synced | failed",
  "link": "https://...",
  "localVersion": 2,
  "onchainVersion": 2,
  "isDeleted": 0,
  "createdAt": "...",
  "updatedAt": "..."
}
```

### Create Document (JSON)

```
POST /api/ddocs?apiKey={API_KEY}
Content-Type: application/json

{
  "title": "Document Title",
  "content": "Document content here..."
}
```

Response (201):
```json
{
  "message": "...",
  "data": {
    "ddocId": "abc123",
    "title": "...",
    "syncStatus": "pending",
    ...
  }
}
```

Extract `ddocId` from `response.data.ddocId`.

### Create Document (File Upload)

```
POST /api/ddocs?apiKey={API_KEY}
Content-Type: multipart/form-data

Field: "file" = <your file>
```

Title is derived from filename. Max file size: 10MB.

### Update Document (JSON)

```
PUT /api/ddocs/{ddocId}?apiKey={API_KEY}
Content-Type: application/json

{
  "title": "New Title",
  "content": "Updated content..."
}
```

Both fields are optional — send only what you want to change.

### Update Document (File Upload)

```
PUT /api/ddocs/{ddocId}?apiKey={API_KEY}
Content-Type: multipart/form-data

Field: "file" = <your updated file>
```

### Delete Document

```
DELETE /api/ddocs/{ddocId}?apiKey={API_KEY}
```

### Search Documents

```
GET /api/search?apiKey={API_KEY}&q={query}&limit=10&skip=0
```

Response:
```json
{
  "nodes": [ ... ],
  "total": 5,
  "hasNext": false
}
```

Note: search returns `nodes`, not `ddocs`.

### OpenAPI Spec

```
GET {SERVER_URL}/openapi.json
```

Machine-readable OpenAPI 3.1 specification.

---

## Quick Reference

### API Endpoints

| Method | Path                              | Description              |
|--------|-----------------------------------|--------------------------|
| GET    | /ping                             | Health check (no auth)   |
| GET    | /api/ddocs                        | List documents           |
| GET    | /api/ddocs/{ddocId}               | Get document             |
| POST   | /api/ddocs                        | Create document          |
| PUT    | /api/ddocs/{ddocId}               | Update document          |
| DELETE | /api/ddocs/{ddocId}               | Delete document          |
| GET    | /api/search?q={query}             | Search documents         |

### ddctl Commands

| Command                        | Description                        |
|--------------------------------|------------------------------------|
| ddctl list                     | List documents                     |
| ddctl get {ddocId}             | Get document metadata              |
| ddctl view {ddocId}            | Preview document content           |
| ddctl create {filepath}        | Create document from file          |
| ddctl update {ddocId}          | Update document (editor or file)   |
| ddctl download {ddocId}        | Download document to file          |
| ddctl delete {ddocId} [...]    | Delete one or more documents       |

---

## Sync Status

After creating or updating a document, it syncs to the blockchain asynchronously:

| Status    | Meaning                                    |
|-----------|--------------------------------------------|
| `pending` | Saved locally, blockchain sync in progress |
| `synced`  | Published on blockchain, `link` available  |
| `failed`  | Sync failed — use events retry to fix      |

Typical sync time: 5-30 seconds.

---

## Error Codes

| Code | Meaning                                          |
|------|--------------------------------------------------|
| 400  | Validation error (missing/invalid body or params)|
| 401  | Invalid or missing API key                       |
| 404  | Resource not found                               |
| 429  | Rate limited — respect Retry-After header        |
| 500  | Internal server error                            |