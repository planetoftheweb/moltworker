---
name: x-twitter
description: Interact with X/Twitter using the official API v2. Search recent tweets, look up tweets by ID, read user profiles and timelines. Use when asked about tweets, X/Twitter content, finding discussions about topics on X, or when you need to fetch tweet metadata (including card images). Requires X_BEARER_TOKEN env var.
---

# X/Twitter Official API v2

Read tweets, search X, and look up user profiles using the official X API v2 with Bearer token authentication.

## Prerequisites

- API secrets available at `/tmp/.api-env` (written by `start-moltbot.sh` on container boot)
- Contains: `X_BEARER_TOKEN`, `X_CONSUMER_KEY`, `X_CONSUMER_SECRET`

## Authentication

**Always source the secrets file first**, then use Bearer token (app-only) auth:

```bash
source /tmp/.api-env && curl -s -H "Authorization: Bearer $X_BEARER_TOKEN" "https://api.x.com/2/..."
```

> Why `source`? OpenClaw exec sessions don't inherit the gateway process's environment
> variables. The secrets are written to `/tmp/.api-env` at container startup and must
> be sourced before each command.

## Rate Limits

Basic tier limits (per 15-minute window):
- Tweet lookup: 300 requests
- Recent search: 60 requests
- User lookup: 300 requests
- User tweets timeline: 300 requests

## Endpoints

### Look up tweets by ID

Fetch one or more tweets by their ID. Use this when you have a tweet URL.

Extract tweet ID from URL: `https://x.com/user/status/1234567890` -> ID is `1234567890`

```bash
# Single tweet with all useful fields
curl -s -H "Authorization: Bearer $X_BEARER_TOKEN" \
  "https://api.x.com/2/tweets/TWEET_ID?tweet.fields=created_at,author_id,text,entities,attachments,public_metrics&expansions=author_id,attachments.media_keys&media.fields=url,preview_image_url,type&user.fields=name,username,profile_image_url"

# Multiple tweets (comma-separated IDs, max 100)
curl -s -H "Authorization: Bearer $X_BEARER_TOKEN" \
  "https://api.x.com/2/tweets?ids=ID1,ID2,ID3&tweet.fields=created_at,author_id,text,entities,public_metrics&expansions=author_id&user.fields=name,username"
```

**Key fields in response:**
- `data.text` - Tweet text
- `data.entities.urls[].expanded_url` - Full URLs shared in tweet
- `data.entities.urls[].images[].url` - Twitter card preview images for shared URLs
- `data.entities.urls[].title` - Twitter card title
- `data.entities.urls[].description` - Twitter card description
- `data.public_metrics` - Like count, retweet count, reply count
- `includes.users` - Author info (name, username, profile image)
- `includes.media` - Attached media (images, videos)

### Search recent tweets (last 7 days)

```bash
# Search for tweets about a topic
curl -s -H "Authorization: Bearer $X_BEARER_TOKEN" \
  "https://api.x.com/2/tweets/search/recent?query=SEARCH_QUERY&max_results=10&tweet.fields=created_at,author_id,text,entities,public_metrics&expansions=author_id&user.fields=name,username"
```

**Search query operators:**
- `"exact phrase"` - Exact match
- `from:username` - Tweets by a specific user
- `to:username` - Replies to a user
- `url:"example.com"` - Tweets containing a URL
- `has:links` - Only tweets with links
- `has:media` - Only tweets with media
- `-is:retweet` - Exclude retweets
- `lang:en` - Only English tweets
- Combine with spaces (AND) or `OR`

**Examples:**
```bash
# Find tweets sharing vibe coding tools (not retweets)
curl -s -H "Authorization: Bearer $X_BEARER_TOKEN" \
  "https://api.x.com/2/tweets/search/recent?query=%22vibe%20coding%22%20has%3Alinks%20-is%3Aretweet&max_results=10&tweet.fields=created_at,text,entities,public_metrics&expansions=author_id&user.fields=name,username"

# Find tweets from a specific user
curl -s -H "Authorization: Bearer $X_BEARER_TOKEN" \
  "https://api.x.com/2/tweets/search/recent?query=from%3Aplanetoftheweb&max_results=10&tweet.fields=created_at,text,entities,public_metrics"

# Find tweets about Cursor IDE with links
curl -s -H "Authorization: Bearer $X_BEARER_TOKEN" \
  "https://api.x.com/2/tweets/search/recent?query=%22cursor%20ide%22%20has%3Alinks%20-is%3Aretweet&max_results=10&tweet.fields=created_at,text,entities&expansions=author_id&user.fields=name,username"
```

### Look up a user by username

```bash
curl -s -H "Authorization: Bearer $X_BEARER_TOKEN" \
  "https://api.x.com/2/users/by/username/USERNAME?user.fields=name,username,description,profile_image_url,public_metrics"
```

### Get a user's recent tweets

```bash
# First get user ID from username
USER_ID=$(curl -s -H "Authorization: Bearer $X_BEARER_TOKEN" \
  "https://api.x.com/2/users/by/username/USERNAME" | jq -r '.data.id')

# Then get their tweets
curl -s -H "Authorization: Bearer $X_BEARER_TOKEN" \
  "https://api.x.com/2/users/$USER_ID/tweets?max_results=10&tweet.fields=created_at,text,entities,public_metrics&expansions=author_id&user.fields=name,username"
```

## Extracting Card Images from Tweets

When a tweet shares a URL, X generates a card preview with an image. This is in the `entities.urls` array:

```json
{
  "entities": {
    "urls": [
      {
        "expanded_url": "https://example.com/cool-tool",
        "title": "Cool Tool - Build faster",
        "description": "A tool for vibe coding",
        "images": [
          { "url": "https://pbs.twimg.com/card_img/...", "width": 800, "height": 418 }
        ]
      }
    ]
  }
}
```

To get the card image URL:
```bash
curl -s -H "Authorization: Bearer $X_BEARER_TOKEN" \
  "https://api.x.com/2/tweets/TWEET_ID?tweet.fields=entities" \
  | jq -r '.data.entities.urls[0].images[0].url'
```

## Integration with VibeIt

When you find a tweet sharing a tool/resource worth adding to VibeIt:

1. Fetch the tweet to get the shared URL and card image
2. Use the card image as `screenshotUrl` when creating the resource via the VibeIt API

```bash
# 1. Get tweet data
TWEET_DATA=$(curl -s -H "Authorization: Bearer $X_BEARER_TOKEN" \
  "https://api.x.com/2/tweets/TWEET_ID?tweet.fields=entities")

# 2. Extract URL and card image
RESOURCE_URL=$(echo "$TWEET_DATA" | jq -r '.data.entities.urls[0].expanded_url')
CARD_IMAGE=$(echo "$TWEET_DATA" | jq -r '.data.entities.urls[0].images[0].url // empty')

# 3. Add to VibeIt with the card image
curl -s -X POST -H "X-API-Key: $VIBEIT_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"$RESOURCE_URL\",\"name\":\"Resource Name\",\"screenshotUrl\":\"$CARD_IMAGE\"}" \
  "https://vibeit.work/api/v1/resources"
```

## Error Handling

- **401 Unauthorized**: Bearer token is invalid or expired
- **403 Forbidden**: Endpoint not available on your plan (may need Basic tier)
- **429 Too Many Requests**: Rate limited. Check `x-rate-limit-reset` header for when to retry
- **400 Bad Request**: Check query syntax, ensure URL encoding for special characters

## Important Notes

- Recent search only covers the **last 7 days**
- URL-encode query parameters (spaces as `%20`, colons as `%3A`)
- Use `jq` to parse JSON responses
- The Bearer token is read-only (app-only auth). To post tweets, you'd need OAuth 1.0a with consumer key/secret + access tokens
- Card images in `entities.urls[].images` are not always present -- depends on whether the linked site has og:image/twitter:image meta tags
