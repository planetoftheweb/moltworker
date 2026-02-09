---
name: vibeit-api
description: Query and write to the VibeIt API -- search resources, apps, collections, add new resources, and suggest discoveries. Use when asked about vibe coding resources, tools, apps on VibeIt, when you need to look up what's new or trending, or when you discover a resource worth adding. Requires VIBEIT_API_KEY env var.
---

# VibeIt API

Query and contribute to the VibeIt platform (vibeit.work) for vibe coding resources, community apps, collections, and platform statistics.

## Prerequisites

- `VIBEIT_API_KEY` environment variable set (starts with `vib_`)

## Authentication

All requests must include the API key header:

```bash
curl -H "X-API-Key: $VIBEIT_API_KEY" https://vibeit.work/api/v1/...
```

## Endpoints

Base URL: `https://vibeit.work/api/v1`

### Read Endpoints

#### Resources

| Endpoint | Description |
|----------|-------------|
| `GET /resources` | List all public resources (paginated) |
| `GET /resources/:id` | Get a specific resource by ID |
| `GET /resources/search?q=QUERY` | Search resources by name or tag |
| `GET /resources/new?days=7&limit=20` | Resources added in the last N days |
| `GET /resources/trending?limit=20` | Top resources by vote count |
| `GET /resources/weekly-digest?format=json` | Weekly digest (JSON) |
| `GET /resources/weekly-digest?format=markdown` | Weekly digest (copy-paste newsletter) |

**Resource list query parameters:**
- `page` (default: 1) - Page number
- `perPage` (default: 20, max: 100) - Items per page
- `type` - Filter by type: `tool`, `article`, `video`, `repository`, `other`
- `tag` - Filter by tag (exact match, e.g. `mcp`, `cursor`, `ai`)

#### Apps

| Endpoint | Description |
|----------|-------------|
| `GET /apps` | List all public apps (paginated) |
| `GET /apps/:slug` | Get a specific app by slug |
| `GET /apps/search?q=QUERY` | Search apps by name or tag |
| `GET /apps/leaderboard?limit=20` | Top apps ranked by votes |

#### Collections

| Endpoint | Description |
|----------|-------------|
| `GET /collections` | List public collections (paginated) |
| `GET /collections/:idOrSlug` | Get collection with its apps and resources |

#### Platform Meta

| Endpoint | Description |
|----------|-------------|
| `GET /stats` | Platform totals (users, apps, resources, collections) |
| `GET /categories` | Resource count by type |

### Write Endpoints

#### Add Resources (Admin API keys)

| Endpoint | Description |
|----------|-------------|
| `POST /resources` | Create a resource directly (admin only) |
| `DELETE /resources/:id` | Delete a resource by ID (admin only) |

**Request body (POST):**

```json
{
  "url": "https://example.com/tool",
  "name": "My Tool",
  "description": "A great vibe coding tool",
  "resourceType": "tool",
  "tags": ["ai", "cursor", "mcp"]
}
```

Required: `url`, `name`. Optional: `description`, `resourceType` (default: `tool`), `tags`, `screenshotUrl`.

Valid `resourceType` values: `tool`, `article`, `video`, `repository`, `other`.

**Screenshot handling:** If you can scrape the page's `og:image` or `twitter:image` meta tag, pass it as `screenshotUrl`. The site will use it directly. If omitted, the server will automatically try to fetch the og:image or capture a screenshot via Puppeteer.

**Response:** Returns the created resource. If the URL already exists, returns the existing resource with `_duplicate: true`.

#### Collections (Admin API keys)

| Endpoint | Description |
|----------|-------------|
| `POST /collections` | Create a new collection |
| `DELETE /collections/:id` | Delete a collection |
| `POST /collections/:id/items` | Add an app or resource to a collection |
| `DELETE /collections/:id/items/:itemId` | Remove an item from a collection |
| `POST /collections/:id/feature` | Toggle featured status on a collection |

**Create collection (POST /collections):**

```json
{
  "name": "Best AI Tools This Week",
  "description": "Curated selection of top AI development tools",
  "visibility": "public",
  "color": "#7C3AED",
  "icon": "sparkles"
}
```

Required: `name`. Optional: `description`, `visibility` (default: `public`), `color`, `icon`.
Valid `visibility` values: `public`, `private`, `link`.

**Add item to collection (POST /collections/:id/items):**

```json
{
  "type": "resource",
  "id": "RESOURCE_ID"
}
```

Required: `type` (`app` or `resource`), `id` (the app or resource ID).
If the item is already in the collection, returns `_duplicate: true`.

**Toggle featured (POST /collections/:id/feature):**

```json
{
  "isFeatured": true,
  "featuredOrder": 1
}
```

Required: `isFeatured` (boolean). Optional: `featuredOrder` (number, lower = first).
Featured collections appear on the homepage and community page.

#### Suggest Resources (Any API key)

| Endpoint | Description |
|----------|-------------|
| `POST /suggestions` | Suggest a resource for review |

**Request body:**

```json
{
  "url": "https://example.com/new-tool",
  "name": "New Tool",
  "description": "Optional description",
  "resourceType": "tool",
  "tags": ["ai"],
  "notes": "Found this on Hacker News, looks useful for MCP development"
}
```

Required: `url`. Optional: `name`, `description`, `resourceType`, `tags`, `notes`.

**Response:** Returns the suggestion with `status: "pending"`.

#### Manage Suggestions (Admin only)

| Endpoint | Description |
|----------|-------------|
| `GET /suggestions?status=pending` | List suggestions (pending/approved/rejected) |
| `POST /suggestions/approve/:id` | Approve and create resource from suggestion |
| `POST /suggestions/reject/:id` | Reject a suggestion |

## Common Patterns

### Add a resource you discovered

```bash
curl -s -X POST -H "X-API-Key: $VIBEIT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/tool","name":"Cool Tool","description":"A tool for vibe coding","resourceType":"tool","tags":["ai","cursor"],"screenshotUrl":"https://example.com/og-image.png"}' \
  "https://vibeit.work/api/v1/resources"
```

**Tip:** When adding a resource, scrape the page first to get the `og:image` or `twitter:image` URL and include it as `screenshotUrl`. This gives the resource a preview image immediately. If you can't get one, omit it -- the server will try to fetch it automatically.

### Check if a resource already exists before adding

```bash
curl -s -H "X-API-Key: $VIBEIT_API_KEY" \
  "https://vibeit.work/api/v1/resources/search?q=example" | jq '.data[] | {name, url}'
```

### Find new vibe coding tools

```bash
curl -s -H "X-API-Key: $VIBEIT_API_KEY" \
  "https://vibeit.work/api/v1/resources/new?days=7&limit=10" | jq '.data[] | {name, url, description, tags}'
```

### Search for MCP-related resources

```bash
curl -s -H "X-API-Key: $VIBEIT_API_KEY" \
  "https://vibeit.work/api/v1/resources/search?q=mcp" | jq '.data[] | {name, url}'
```

### Get the weekly newsletter digest

```bash
curl -s -H "X-API-Key: $VIBEIT_API_KEY" \
  "https://vibeit.work/api/v1/resources/weekly-digest?format=markdown"
```

### Check platform stats

```bash
curl -s -H "X-API-Key: $VIBEIT_API_KEY" \
  "https://vibeit.work/api/v1/stats" | jq '.data'
```

### Get top community apps

```bash
curl -s -H "X-API-Key: $VIBEIT_API_KEY" \
  "https://vibeit.work/api/v1/apps/leaderboard?limit=5" | jq '.data[] | {rank, name, slug, voteCount}'
```

### Browse resources by type

```bash
# Only tools
curl -s -H "X-API-Key: $VIBEIT_API_KEY" \
  "https://vibeit.work/api/v1/resources?type=tool&perPage=10"

# Only repositories
curl -s -H "X-API-Key: $VIBEIT_API_KEY" \
  "https://vibeit.work/api/v1/resources?type=repository&perPage=10"
```

### Batch workflow: search then add

When you discover a new resource, always check if it exists first:

```bash
# 1. Search first
curl -s -H "X-API-Key: $VIBEIT_API_KEY" \
  "https://vibeit.work/api/v1/resources/search?q=toolname"

# 2. If not found, add it
curl -s -X POST -H "X-API-Key: $VIBEIT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://...","name":"...","resourceType":"tool","tags":["..."]}' \
  "https://vibeit.work/api/v1/resources"
```

The API automatically deduplicates by URL (normalized), so posting a duplicate returns the existing resource with `_duplicate: true` instead of creating a new one.

### Create a curated collection

```bash
curl -s -X POST -H "X-API-Key: $VIBEIT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"Best AI Tools This Week","description":"Top picks from the community","visibility":"public"}' \
  "https://vibeit.work/api/v1/collections"
```

### Add items to a collection

```bash
# Add a resource
curl -s -X POST -H "X-API-Key: $VIBEIT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"type":"resource","id":"RESOURCE_ID"}' \
  "https://vibeit.work/api/v1/collections/COLLECTION_ID/items"

# Add an app
curl -s -X POST -H "X-API-Key: $VIBEIT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"type":"app","id":"APP_ID"}' \
  "https://vibeit.work/api/v1/collections/COLLECTION_ID/items"
```

### Feature a collection (shows on homepage)

```bash
curl -s -X POST -H "X-API-Key: $VIBEIT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"isFeatured":true,"featuredOrder":1}' \
  "https://vibeit.work/api/v1/collections/COLLECTION_ID/feature"
```

### Unfeature a collection

```bash
curl -s -X POST -H "X-API-Key: $VIBEIT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"isFeatured":false}' \
  "https://vibeit.work/api/v1/collections/COLLECTION_ID/feature"
```

### Remove an item from a collection

```bash
curl -s -X DELETE -H "X-API-Key: $VIBEIT_API_KEY" \
  "https://vibeit.work/api/v1/collections/COLLECTION_ID/items/ITEM_ID"
```

### Delete a collection

```bash
curl -s -X DELETE -H "X-API-Key: $VIBEIT_API_KEY" \
  "https://vibeit.work/api/v1/collections/COLLECTION_ID"
```

### Auto-curation workflow: build a weekly collection

```bash
# 1. Get trending resources from the last 7 days
RESOURCES=$(curl -s -H "X-API-Key: $VIBEIT_API_KEY" \
  "https://vibeit.work/api/v1/resources/new?days=7&limit=10")

# 2. Create a new collection for this week
COLLECTION=$(curl -s -X POST -H "X-API-Key: $VIBEIT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"Top Picks - Week of Feb 10","description":"This week'"'"'s best vibe coding resources","visibility":"public"}' \
  "https://vibeit.work/api/v1/collections")

# 3. Extract collection ID
COLLECTION_ID=$(echo "$COLLECTION" | jq -r '.data.id')

# 4. Add each resource to the collection
echo "$RESOURCES" | jq -r '.data[].id' | while read RID; do
  curl -s -X POST -H "X-API-Key: $VIBEIT_API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"type\":\"resource\",\"id\":\"$RID\"}" \
    "https://vibeit.work/api/v1/collections/$COLLECTION_ID/items"
done

# 5. Feature the new collection and unfeature the old one
curl -s -X POST -H "X-API-Key: $VIBEIT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"isFeatured":true,"featuredOrder":1}' \
  "https://vibeit.work/api/v1/collections/$COLLECTION_ID/feature"
```

### Delete a resource

```bash
curl -s -X DELETE -H "X-API-Key: $VIBEIT_API_KEY" \
  "https://vibeit.work/api/v1/resources/RESOURCE_ID"
```

## Response Format

All JSON responses follow this structure:

```json
{
  "data": [ ... ],
  "pagination": {
    "page": 1,
    "perPage": 20,
    "total": 95,
    "hasMore": true
  }
}
```

### Resource fields

| Field | Description |
|-------|-------------|
| `id` | Unique resource ID |
| `name` | Resource name |
| `url` | Resource URL |
| `description` | Description text |
| `resourceType` | `tool`, `article`, `video`, `repository`, `other` |
| `tags` | Array of tag strings |
| `screenshotUrl` | Screenshot/OG image URL |
| `faviconUrl` | Site favicon URL |
| `voteCount` | Community upvotes |
| `starCount` | User stars/bookmarks |
| `createdBy` | Username of submitter |
| `createdAt` | ISO 8601 timestamp |

### App fields

| Field | Description |
|-------|-------------|
| `id` | Unique app ID |
| `name` | App name |
| `slug` | URL slug (used in vibeit.work/username/slug) |
| `url` | App URL |
| `description` | Short description |
| `longDescription` | Full description |
| `tags` | Array of tag strings |
| `appType` | App type |
| `voteCount` | Community upvotes |
| `ownerUsername` | Creator's username |
| `developmentPlatforms` | Platforms used to build |
| `aiModels` | AI models used |

### Collection fields

| Field | Description |
|-------|-------------|
| `id` | Unique collection ID |
| `name` | Collection name |
| `slug` | URL slug |
| `description` | Description text |
| `visibility` | `public`, `private`, or `link` |
| `ownerUsername` | Creator's username |
| `color` | Hex color code |
| `icon` | Icon name |
| `appCount` | Number of apps |
| `memberCount` | Number of members |
| `isFeatured` | Whether it's featured on the homepage |
| `featuredOrder` | Display order (lower = first) |
| `featuredAt` | ISO 8601 timestamp when featured |
| `createdAt` | ISO 8601 timestamp |

## Rate Limits

- 100 requests per minute
- Responses are cached (5 min for lists, 10 min for stats)

## Troubleshooting

- **401 Unauthorized**: Check that `VIBEIT_API_KEY` is set and starts with `vib_`
- **403 Forbidden**: Endpoint requires admin access (e.g. direct resource creation)
- **409 Conflict**: Resource or suggestion already exists for that URL
- **429 Rate Limited**: Wait 1 minute and retry
- **500 Internal Error**: Likely a Firestore index issue; report to admin
- **Empty search results**: Firestore search is prefix-based for names and exact-match for tags; try shorter queries or known tags like `mcp`, `cursor`, `ai`, `tool`
