---
name: deploy-verify
version: 1.0.0
description: |
  Guides AI agents through a post-deploy smoke test: navigate to deployed URL, check page loads, console errors, take screenshot, and report pass/fail.
metadata:
  openclaw:
    emoji: "✅"
    requires:
      bins: ["curl", "jq"]
    install:
      - id: apt
        kind: apt
        package: "curl jq"
        bins: ["curl", "jq"]
        label: "Install curl and jq for web requests and JSON parsing"
---

# Deploy-Verify Skill

Use this skill to run a quick smoke test after a deployment. Verifies that the deployed application is accessible, loads correctly, and has no critical JavaScript errors.

## When to Use

✅ **USE this skill when:**

- You've just deployed an application and need to verify it's up and healthy
- Checking if a new environment (staging, prod) is reachable
- Validating that a deployment didn't break critical functionality
- Providing visual proof (screenshot) that the page loads

❌ **DON'T use this skill when:**

- You need comprehensive end-to-end testing (use `gstack browse` or other QA tools)
- You need to test authenticated flows or complex user interactions
- You need to verify API endpoints (use `curl` directly)
- You need performance or load testing

## Quick Start

### Basic Smoke Test

```bash
# 1. Set the URL to test
URL="https://your-app.example.com"

# 2. Navigate and check page loads (no blank screen)
curl -s -I "$URL" | head -n 1 | grep -q "200\|301\|302" && echo "✅ HTTP OK" || echo "❌ HTTP failure"

# For more detailed check (requires gstack browse)
# If gstack is available, use it for deeper inspection
B=$(browse/bin/find-browse 2>/dev/null || ~/.claude/skills/gstack/browse/bin/find-browse 2>/dev/null)
if [ -n "$B" ]; then
  $B goto "$URL"
  $B text | head -20  # Check page has content (not blank)
  $B console --errors # Check for JS errors
  $B screenshot /tmp/deploy-verify-$(date +%s).png
else
  echo "⚠️  gstack browse not available, falling back to basic curl check"
  curl -s "$URL" | head -100 | grep -q "<body" && echo "✅ Page has body content" || echo "❌ Page may be blank"
fi
```

## Complete Workflow

### 1️⃣ Navigate to the deployed URL

First, determine the URL to test. This could be:
- A newly deployed production URL
- A staging/preview environment
- A local development server exposed via tunnel

```bash
# Example: testing a local service on port 3000 exposed via ngrok
NGROK_URL=$(curl -s http://localhost:4040/api/tunnels | jq -r '.tunnels[0].public_url')
URL="${NGROK_URL:-http://localhost:3000}"
echo "Testing URL: $URL"
```

### 2️⃣ Check page loads (no blank screen)

Verify the page returns a successful HTTP status and contains content.

```bash
# Check HTTP status
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$URL")
if [[ "$HTTP_STATUS" =~ ^(2|3)[0-9][0-9]$ ]]; then
  echo "✅ HTTP $HTTP_STATUS OK"
else
  echo "❌ HTTP $HTTP_STATUS - Page may not be loading"
  exit 1
fi

# Check page has content (not just empty or error page)
CONTENT_CHECK=$(curl -s "$URL" | head -200 | wc -l)
if [ "$CONTENT_CHECK" -gt 10 ]; then
  echo "✅ Page has substantial content ($CONTENT_CHECK lines)"
else
  echo "⚠️  Page may be minimal or empty"
fi
```

### 3️⃣ Check console for errors

If `gstack browse` is available, use it to check for JavaScript console errors.

```bash
# Check if gstack browse is available
B=$(browse/bin/find-browse 2>/dev/null || ~/.claude/skills/gstack/browse/bin/find-browse 2>/dev/null)
if [ -n "$B" ]; then
  echo "🔍 Using gstack browse for console inspection..."
  $B goto "$URL"
  CONSOLE_ERRORS=$($B console --errors)
  if [ -n "$CONSOLE_ERRORS" ]; then
    echo "❌ Console errors found:"
    echo "$CONSOLE_ERRORS"
  else
    echo "✅ No console errors"
  fi
else
  echo "⚠️  gstack browse not available, skipping console error check"
fi
```

### 4️⃣ Take a screenshot as proof

Capture visual evidence that the page loads correctly.

```bash
# Take screenshot if gstack browse is available
if [ -n "$B" ]; then
  TIMESTAMP=$(date +%Y%m%d-%H%M%S)
  SCREENSHOT_PATH="/tmp/deploy-verify-$TIMESTAMP.png"
  $B screenshot "$SCREENSHOT_PATH"
  echo "📸 Screenshot saved: $SCREENSHOT_PATH"
  
  # Optional: upload screenshot to image hosting or attach to report
  # echo "🖼️  Screenshot URL: $(upload-image "$SCREENSHOT_PATH")"
else
  echo "⚠️  gstack browse not available, screenshot skipped"
fi
```

### 5️⃣ Report pass/fail

Summarize the results with a clear pass/fail status.

```bash
# Determine overall status
OVERALL_STATUS="PASS"
if [[ ! "$HTTP_STATUS" =~ ^(2|3)[0-9][0-9]$ ]]; then
  OVERALL_STATUS="FAIL"
fi

if [ -n "$CONSOLE_ERRORS" ]; then
  echo "⚠️  Console errors present but may not be critical"
  # Depending on severity, you might want to fail:
  # if [[ "$CONSOLE_ERRORS" =~ "Critical\|Fatal\|Uncaught" ]]; then
  #   OVERALL_STATUS="FAIL"
  # fi
fi

echo ""
echo "========================================"
echo "📊 DEPLOY VERIFICATION REPORT"
echo "========================================"
echo "URL: $URL"
echo "HTTP Status: $HTTP_STATUS"
echo "Content Check: $CONTENT_CHECK lines"
echo "Console Errors: $(if [ -n "$CONSOLE_ERRORS" ]; then echo "YES"; else echo "NONE"; fi)"
echo "Screenshot: $(if [ -n "$SCREENSHOT_PATH" ]; then echo "$SCREENSHOT_PATH"; else echo "NOT TAKEN"; fi)"
echo ""
echo "✅ OVERALL STATUS: $OVERALL_STATUS"
echo "========================================"
```

## Advanced Usage

### With environment-specific checks

```bash
# Different checks for different environments
ENVIRONMENT="${ENVIRONMENT:-production}"

case "$ENVIRONMENT" in
  production)
    # Strict checks for production
    MAX_LOAD_TIME=3  # seconds
    REQUIRED_TEXT="Welcome"
    ;;
  staging)
    # More tolerant for staging
    MAX_LOAD_TIME=5
    REQUIRED_TEXT="Staging"
    ;;
  development)
    MAX_LOAD_TIME=10
    REQUIRED_TEXT=""
    ;;
esac

# Add load time check
LOAD_TIME=$(curl -s -o /dev/null -w "%{time_total}" "$URL")
if (( $(echo "$LOAD_TIME > $MAX_LOAD_TIME" | bc -l) )); then
  echo "⚠️  Load time $LOAD_TIME exceeds $MAX_LOAD_TIME seconds"
fi

# Check for required text
if [ -n "$REQUIRED_TEXT" ]; then
  curl -s "$URL" | grep -q "$REQUIRED_TEXT" && echo "✅ Contains '$REQUIRED_TEXT'" || echo "❌ Missing '$REQUIRED_TEXT'"
fi
```

### Automated CI/CD integration

```bash
#!/bin/bash
# deploy-verify.sh - Integrate into CI/CD pipeline

set -e  # Exit on any failure

URL="$1"
ENVIRONMENT="$2"

# Source this skill's functions
# (You could extract the check functions into a separate script)

# Run verification
echo "Running deploy verification for $URL ($ENVIRONMENT)"

# Execute checks
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$URL")
if [[ ! "$HTTP_STATUS" =~ ^(2|3)[0-9][0-9]$ ]]; then
  echo "::error::Deploy verification failed: HTTP $HTTP_STATUS"
  exit 1
fi

# Additional checks...
```

### Slack/notification integration

```bash
# Post results to Slack
SLACK_WEBHOOK="${SLACK_WEBHOOK_URL}"
if [ -n "$SLACK_WEBHOOK" ]; then
  MESSAGE="Deploy verification for $URL: $OVERALL_STATUS"
  if [ "$OVERALL_STATUS" = "FAIL" ]; then
    COLOR="danger"
  else
    COLOR="good"
  fi
  
  curl -X POST -H 'Content-type: application/json' \
    --data "{\"attachments\":[{\"color\":\"$COLOR\",\"text\":\"$MESSAGE\",\"fields\":[{\"title\":\"HTTP Status\",\"value\":\"$HTTP_STATUS\",\"short\":true},{\"title\":\"Console Errors\",\"value\":\"$(if [ -n "$CONSOLE_ERRORS" ]; then echo "YES"; else echo "NONE"; fi)\",\"short\":true}]}]}" \
    "$SLACK_WEBHOOK"
fi
```

## Troubleshooting

### Common Issues

**Page loads but shows blank white screen:**
- Check if JavaScript bundles are loading (view page source, check network tab)
- Verify the correct index.html is being served
- Check for CSS/JS path mismatches

**HTTP 502/503/504 errors:**
- Application may not be fully started
- Load balancer or reverse proxy configuration issues
- Insufficient resources (memory, CPU)

**Console errors:**
- Third-party CDN failures (Google Fonts, Analytics, etc.)
- Mixed content warnings (HTTP vs HTTPS)
- Deprecated API usage

**Slow load times:**
- Large bundle sizes
- Unoptimized images
- Database connection delays

### Fallback Options

If gstack browse is not available, you can still perform basic checks:

```bash
# Basic health check script
#!/bin/bash
URL="$1"

# 1. HTTP check
curl -f -s -o /dev/null "$URL" || { echo "HTTP check failed"; exit 1; }

# 2. Content check
HTML=$(curl -s "$URL")
echo "$HTML" | grep -q "<title>" || { echo "No title tag found"; exit 1; }
echo "$HTML" | grep -q "<body" || { echo "No body tag found"; exit 1; }

# 3. Quick performance check
time curl -s -o /dev/null -w "Time: %{time_total}s\nSize: %{size_download} bytes\n" "$URL"

echo "✅ Basic checks passed"
```

## Best Practices

1. **Run immediately after deployment** - Don't wait for caches to propagate
2. **Test critical user paths** - Not just the homepage, but key flows (login, dashboard, etc.)
3. **Compare with previous version** - If possible, diff against known-good state
4. **Include visual regression** - For UI-heavy apps, compare screenshots
5. **Monitor error rates** - Integrate with error tracking (Sentry, Rollbar)
6. **Document failures** - Save logs, screenshots, and environment details for debugging

## Integration with Other Skills

- Use with `gstack browse` for comprehensive browser testing
- Use with `github` skill to create deployment status checks
- Use with `healthcheck` skill for infrastructure monitoring
- Use with `skill-creator` to customize for your specific deployment workflow

---

*This skill provides a foundation for deploy verification. Adapt it to your specific needs by adding environment-specific checks, integrating with your monitoring tools, and expanding the validation criteria.*