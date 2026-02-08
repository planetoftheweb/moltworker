---
name: publer
description: Schedule, publish, and manage social media posts across multiple platforms using the Publer API. Use when asked to post to social media, schedule content, check post status, list connected accounts, or manage social media workflows. Requires PUBLER_API_KEY and PUBLER_WORKSPACE_ID env vars.
---

# Publer Social Media API

Schedule, publish, and manage social media posts across multiple platforms (X/Twitter, LinkedIn, Facebook, Instagram, Bluesky, Threads, YouTube, TikTok, and more).

API docs: https://publer.com/docs/api-reference/introduction

## Prerequisites

Source the API secrets before any command:

```bash
source /tmp/.api-env
```

Required env vars: `PUBLER_API_KEY`, `PUBLER_WORKSPACE_ID`

## Quick Verification

Run this first to confirm credentials and connectivity work:

```bash
source /tmp/.api-env && curl -s \
  -H "Authorization: Bearer-API $PUBLER_API_KEY" \
  -H "Publer-Workspace-Id: $PUBLER_WORKSPACE_ID" \
  "https://app.publer.com/api/v1/accounts" | jq '.[0] | {id, provider, name}'
```

If this fails, check:
- **401 Unauthorized** — API key is wrong
- **403 "no access on this workspace"** — Workspace ID is wrong (it should be a hex string like `5fbb491edb2797642ba54ae0`, NOT a key name)
- **"Could not resolve host"** — Make sure you're using `app.publer.com`, NOT `api.publer.io` (which doesn't exist)

## Authentication

All requests need these headers:

```bash
-H "Authorization: Bearer-API $PUBLER_API_KEY" \
-H "Publer-Workspace-Id: $PUBLER_WORKSPACE_ID" \
-H "Content-Type: application/json"
```

## Endpoints

### List connected accounts

Get all social media accounts in the workspace. You need account IDs to create posts.

```bash
source /tmp/.api-env && curl -s \
  -H "Authorization: Bearer-API $PUBLER_API_KEY" \
  -H "Publer-Workspace-Id: $PUBLER_WORKSPACE_ID" \
  "https://app.publer.com/api/v1/accounts" | jq '.[].{id, provider, name, type}'
```

**Response fields:**
- `id` — Account ID (needed for posting)
- `provider` — Platform name (facebook, twitter, linkedin, instagram, bluesky, threads, etc.)
- `name` — Account display name
- `type` — Account type (profile, page, channel, etc.)

### List posts

```bash
source /tmp/.api-env && curl -s \
  -H "Authorization: Bearer-API $PUBLER_API_KEY" \
  -H "Publer-Workspace-Id: $PUBLER_WORKSPACE_ID" \
  "https://app.publer.com/api/v1/posts?state=scheduled&page=0" | jq '.posts'
```

**Useful query parameters:**
- `state` — Filter: `scheduled`, `published`, `draft`, `failed`, `all`
- `from` / `to` — Date range (ISO format, e.g., `2026-02-07`)
- `query` — Full-text search in post content
- `postType` — Filter: `status`, `link`, `photo`, `video`, `carousel`
- `account_ids[]` — Filter by specific account IDs
- `page` — Pagination (default: 0)

### Schedule a post

Post creation is **asynchronous** — you get a `job_id` back and poll for completion.

```bash
source /tmp/.api-env && curl -s -X POST \
  -H "Authorization: Bearer-API $PUBLER_API_KEY" \
  -H "Publer-Workspace-Id: $PUBLER_WORKSPACE_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "bulk": {
      "state": "scheduled",
      "posts": [{
        "networks": {
          "twitter": {
            "type": "status",
            "text": "Your tweet text here"
          }
        },
        "accounts": [{
          "id": "ACCOUNT_ID",
          "scheduled_at": "2026-02-08T14:30:00+00:00"
        }]
      }]
    }
  }' \
  "https://app.publer.com/api/v1/posts/schedule"
```

### Publish immediately

Same as schedule but uses the `/publish` endpoint:

```bash
source /tmp/.api-env && curl -s -X POST \
  -H "Authorization: Bearer-API $PUBLER_API_KEY" \
  -H "Publer-Workspace-Id: $PUBLER_WORKSPACE_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "bulk": {
      "state": "scheduled",
      "posts": [{
        "networks": {
          "twitter": {
            "type": "status",
            "text": "Publishing this right now!"
          }
        },
        "accounts": [{
          "id": "ACCOUNT_ID"
        }]
      }]
    }
  }' \
  "https://app.publer.com/api/v1/posts/schedule/publish"
```

### Check job status

After creating/scheduling a post, poll until `status` is `completed`:

```bash
source /tmp/.api-env && curl -s \
  -H "Authorization: Bearer-API $PUBLER_API_KEY" \
  -H "Publer-Workspace-Id: $PUBLER_WORKSPACE_ID" \
  "https://app.publer.com/api/v1/job_status/JOB_ID" | jq '.'
```

### Post to multiple platforms

Customize content per platform by adding multiple entries under `networks`:

```bash
source /tmp/.api-env && curl -s -X POST \
  -H "Authorization: Bearer-API $PUBLER_API_KEY" \
  -H "Publer-Workspace-Id: $PUBLER_WORKSPACE_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "bulk": {
      "state": "scheduled",
      "posts": [{
        "networks": {
          "twitter": {
            "type": "status",
            "text": "Short tweet with #hashtags"
          },
          "linkedin": {
            "type": "status",
            "text": "Longer, professional content for LinkedIn audience. Check out this article."
          },
          "bluesky": {
            "type": "status",
            "text": "Hey Bluesky! Here is the post."
          }
        },
        "accounts": [
          {"id": "TWITTER_ACCOUNT_ID", "scheduled_at": "2026-02-08T14:30:00Z"},
          {"id": "LINKEDIN_ACCOUNT_ID", "scheduled_at": "2026-02-08T15:00:00Z"},
          {"id": "BLUESKY_ACCOUNT_ID", "scheduled_at": "2026-02-08T15:00:00Z"}
        ]
      }]
    }
  }' \
  "https://app.publer.com/api/v1/posts/schedule"
```

### Save as draft

Set `state` to `draft`:

```bash
source /tmp/.api-env && curl -s -X POST \
  -H "Authorization: Bearer-API $PUBLER_API_KEY" \
  -H "Publer-Workspace-Id: $PUBLER_WORKSPACE_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "bulk": {
      "state": "draft",
      "posts": [{
        "networks": {
          "twitter": {
            "type": "status",
            "text": "Draft post — review before publishing"
          }
        },
        "accounts": [{"id": "ACCOUNT_ID"}]
      }]
    }
  }' \
  "https://app.publer.com/api/v1/posts/schedule"
```

### Delete a post

```bash
source /tmp/.api-env && curl -s -X DELETE \
  -H "Authorization: Bearer-API $PUBLER_API_KEY" \
  -H "Publer-Workspace-Id: $PUBLER_WORKSPACE_ID" \
  "https://app.publer.com/api/v1/posts/POST_ID"
```

## Content Types

| Type | Description | Required Fields |
|------|-------------|-----------------|
| `status` | Text-only post | `text` |
| `link` | Post with link preview | `text`, `url` |
| `photo` | Image post | `text`, `media` array |
| `video` | Video post | `text`, `media` array |
| `carousel` | Multi-image | `text`, `media` array |

## Supported Platforms

facebook, instagram, twitter (X), linkedin, pinterest, youtube, tiktok, google (Business), wordpress, telegram, mastodon, threads, bluesky

## Timestamps

All dates use ISO 8601 with timezone: `2026-02-08T14:30:00+00:00`

## Workflow: First-Time Setup

1. Run `source /tmp/.api-env` to load credentials
2. List accounts to get your account IDs: `GET /api/v1/accounts`
3. Save the account IDs you want to post to (note the `provider` for each)
4. Use those IDs in the `accounts` array when creating posts

## Error Handling

- **401 Unauthorized** — API key is invalid
- **403 Forbidden** — Missing required scope or permissions
- **429 Too Many Requests** — Rate limited, wait and retry
- **400 Bad Request** — Check request body structure

## Important Notes

- Post creation is **asynchronous**: always poll `job_status` after scheduling
- Media must be **pre-uploaded** via the Media API before referencing in posts
- Each platform has different character limits and content restrictions
- Use `draft` state to review posts before committing to a schedule
- The `scheduled_at` timestamp must be in the future for scheduled posts
