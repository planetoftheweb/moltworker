---
name: vibeit-api
description: Query and interact with the VibeIt API to search resources, apps, collections, and platform stats. Use when asked about vibe coding resources, tools, apps on VibeIt, or when you need to look up what's new or trending. Requires VIBEIT_API_KEY env var.
---

# VibeIt API

Query the VibeIt platform (vibeit.work) for vibe coding resources, community apps, collections, and platform statistics.

## Prerequisites

- `VIBEIT_API_KEY` environment variable set (starts with `vib_`)

## Authentication

All requests must include the API key header:

```bash
curl -H "X-API-Key: $VIBEIT_API_KEY" https://vibeit.work/api/v1/...
```

## Endpoints

Base URL: `https://vibeit.work/api/v1`

### Resources

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

### Apps

| Endpoint | Description |
|----------|-------------|
| `GET /apps` | List all public apps (paginated) |
| `GET /apps/:slug` | Get a specific app by slug |
| `GET /apps/search?q=QUERY` | Search apps by name or tag |
| `GET /apps/leaderboard?limit=20` | Top apps ranked by votes |

**App list query parameters:**
- `page`, `perPage` - Pagination
- `appType` - Filter by app type
- `tag` - Filter by tag

### Collections

| Endpoint | Description |
|----------|-------------|
| `GET /collections` | List public collections (paginated) |
| `GET /collections/:slug` | Get collection with its apps and resources |

### Platform Meta

| Endpoint | Description |
|----------|-------------|
| `GET /stats` | Platform totals (users, apps, resources, collections) |
| `GET /categories` | Resource count by type |

## Common Patterns

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

## Rate Limits

- 100 requests per minute
- Responses are cached (5 min for lists, 10 min for stats)

## Troubleshooting

- **401 Unauthorized**: Check that `VIBEIT_API_KEY` is set and starts with `vib_`
- **429 Rate Limited**: Wait 1 minute and retry
- **500 Internal Error**: Likely a Firestore index issue; report to admin
- **Empty search results**: Firestore search is prefix-based for names and exact-match for tags; try shorter queries or known tags like `mcp`, `cursor`, `ai`, `tool`
