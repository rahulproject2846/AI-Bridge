# AI-Bridge: Step-by-Step Implementation Checklist

**Start Date:** Today  
**Expected Completion:** 4-6 hours  
**Difficulty:** Medium

---

## PHASE 1: Setup & Dependencies (15 minutes)

### Step 1: Install Required Packages
```bash
npm install bcryptjs
npm install -D @types/bcryptjs
```

**Status:** ☐ Complete  
**Command:** `npm list bcryptjs`  
**Expected:** Should show bcryptjs version installed

---

### Step 2: Create .env.example File
Create file: `.env.example`

```
# MongoDB Connection (Required)
MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net/aibridge

# App Configuration
NEXT_PUBLIC_APP_VERSION=v1.0.0
APP_ENVIRONMENT=production
LOG_LEVEL=info

# Security (Required for production)
CRON_SECRET=generate-a-random-key-here-at-least-32-chars

# Feature Flags
RATE_LIMITING_ENABLED=true
REQUIRE_AUTH_FOR_SYNC=true

# Limits
MAX_SYNC_BATCH_SIZE=4194304
MAX_FILES_PER_SHARE=10000
SHARE_DAILY_QUOTA_MB=100
```

**Status:** ☐ Complete  
**Verify:** File should exist and be readable

---

### Step 3: Verify Development Environment
```bash
npm run build
# Should complete without critical errors (warnings OK)
```

**Status:** ☐ Complete  
**Expected:** Build succeeds

---

## PHASE 2: Core Library Fixes (1 hour)

### Step 4: Fix `lib/env.ts`

**Current state:** 2 exported variables  
**Target:** Comprehensive env validation

**Actions:**
- [ ] Read current file: `lib/env.ts`
- [ ] Replace entire file with new content from IMPLEMENTATION_GUIDE.md
- [ ] Verify syntax
- [ ] Test in dev mode: `npm run dev` (should not error on env validation)

**Status:** ☐ Complete  
**Test:** `npm run dev` should start without env errors

---

### Step 5: Fix `lib/hash.ts`

**Current state:** Only sha256Hex function  
**Target:** Add bcrypt + helper functions

**Actions:**
- [ ] Read current file
- [ ] Add imports: `import bcrypt from "bcryptjs";`
- [ ] Add 4 new functions:
  - `hashPassword()` - Use bcrypt
  - `verifyPassword()` - Compare with bcrypt
  - Keep `sha256Hex()` - For file hashing
  - Add `timingSafeEqual()` - For timing-safe comparison
- [ ] Verify imports work

**Status:** ☐ Complete  
**Test:** `npm run typecheck` should pass

---

### Step 6: Fix `lib/log.ts`

**Current state:** Only logError function  
**Target:** Full logging with levels

**Actions:**
- [ ] Backup current file (copy to log.ts.bak)
- [ ] Replace with new version from IMPLEMENTATION_GUIDE.md
- [ ] Add: logDebug, logInfo, logWarn (keep logError)
- [ ] Add timestamp formatting
- [ ] Verify all imports work

**Status:** ☐ Complete  
**Test:** `npm run typecheck` should pass

---

### Step 7: Fix `lib/api-guard.ts`

**Current state:** Basic rate limiting with IP spoofing vulnerability  
**Target:** Enhanced with IP validation and auth verification

**Actions:**
- [ ] Read current file
- [ ] Keep `checkRateLimit()` function (same)
- [ ] Keep `parseJsonWithLimit()` (same)
- [ ] Keep `errorStatus()` (same)
- [ ] Replace `getClientIp()` with new version that validates IP format
- [ ] Add `isValidIp()` helper function
- [ ] Add `verifyApiKey()` function
- [ ] Import new log functions: `import { logError } from "./log";`

**Status:** ☐ Complete  
**Test:** `npm run typecheck` should pass

---

### Step 8: Fix `lib/mongodb.ts`

**Current state:** Simple connection, no timeout, no error recovery  
**Target:** Robust connection with recovery

**Actions:**
- [ ] Read current file
- [ ] Update `connectMongo()` function:
  - Add connection timeout options
  - Add `maxPoolSize: 10`
  - Add `.catch()` handler to clear promise on error
- [ ] Keep global caching logic same

**Status:** ☐ Complete  
**Test:** Manual MongoDB connection test (or just verify syntax)

---

## PHASE 3: API Route Fixes (2 hours)

### Step 9: Fix `app/api/share/auth/route.ts`

**Current state:** Uses SHA256 directly  
**Target:** Use bcrypt verification

**Actions:**
- [ ] Read current file
- [ ] Update imports:
  - Remove: `import crypto from "node:crypto"`
  - Add: `import { hashPassword, verifyPassword, timingSafeEqual } from "@/lib/hash"`
- [ ] In POST handler:
  - Tighten rate limit: change 20 to 5
  - Add shareId format validation: `/^[a-zA-Z0-9_-]{1,64}$/`
  - Replace sync hash with: `await verifyPassword(password, doc.passwordHash)`
  - Add error logging on failed auth
  - Add `secure: true` to cookie options
- [ ] Verify syntax

**Status:** ☐ Complete  
**Test:** `npm run typecheck`

---

### Step 10: Fix `app/api/sync/route.ts`

**Current state:** No authorization or input validation  
**Target:** Full validation + auth + proper error handling

**Actions:**
- [ ] Read current file
- [ ] Update imports:
  - Add: `import { hashPassword } from "@/lib/hash"`
  - Add: `verifyApiKey` to import from api-guard
- [ ] In POST handler:
  - Add input validation for shareId format
  - Add validation for all required fields
  - Add file validation loop (path, content length)
  - Replace: `await sha256Hex(password)` with `await hashPassword(password)`
  - Add API key verification before processing
  - Improve error messages
  - Add response status 201 for new shares
  - Add logging of operations
- [ ] Verify syntax

**Status:** ☐ Complete  
**Test:** `npm run typecheck`

---

### Step 11: Fix `app/api/sync/project/route.ts`

**Current state:** No auth, rate limiting, or input validation  
**Target:** Full security implementation

**Actions:**
- [ ] Replace entire file with new version from IMPLEMENTATION_GUIDE.md
- [ ] For DELETE:
  - Add rate limiting
  - Add shareId validation
  - Add API key verification
  - Return proper error codes (404 if not found)
  - Add logging
- [ ] For PATCH:
  - Add rate limiting (higher limit than DELETE)
  - Add shareId validation
  - Add projectName validation (length checks)
  - Add API key verification
  - Update updatedAt timestamp
  - Return proper error codes
- [ ] Import: `getClientIp`, `checkRateLimit`, `parseJsonWithLimit`, `errorStatus`, `verifyApiKey`, `logError`

**Status:** ☐ Complete  
**Test:** `npm run typecheck`

---

### Step 12: Fix `app/api/cron/purge-expired/route.ts`

**Current state:** Completely unprotected, no logging  
**Target:** Protected with secret, proper logging

**Actions:**
- [ ] Read current file
- [ ] Add secret verification at start:
  ```typescript
  const authHeader = req.headers.get("authorization");
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  ```
- [ ] Replace `console.log` and empty catch with proper logging
- [ ] Add timestamp to response
- [ ] Improve error handling

**Status:** ☐ Complete  
**Test:** `npm run typecheck`

---

### Step 13: Fix `app/api/sync/delete/route.ts` (Rate Limit Consistency)

**Current state:** Uses checkRateLimit but duplicated endpoint naming  
**Target:** Consistent naming and limits

**Actions:**
- [ ] Read current file
- [ ] Change rate limit from "bulk-delete-single" to "file-delete"
- [ ] Change limit from 60 to 20 per minute
- [ ] Keep rest same

**Status:** ☐ Complete

---

### Step 14: Fix `app/api/sync/bulk-delete/route.ts` (Rate Limit + Validation)

**Current state:** Basic rate limiting, minimal validation  
**Target:** Enhanced validation

**Actions:**
- [ ] Read current file
- [ ] Keep rate limiting same (30 per minute is OK)
- [ ] Add shareId format validation
- [ ] Add filePaths array validation (empty array should error)
- [ ] Keep rest same

**Status:** ☐ Complete

---

### Step 15: Fix `app/api/sync/reset/route.ts` (Rate Limit + Validation)

**Current state:** Low rate limit, no validation  
**Target:** Add validation

**Actions:**
- [ ] Read current file
- [ ] Keep rate limit (10 per minute is OK)
- [ ] Add shareId format validation
- [ ] Keep rest same

**Status:** ☐ Complete

---

## PHASE 4: Share Reading Endpoints (1 hour)

### Step 16: Fix `app/share/[id]/route.ts`

**Current state:** Uses sync crypto.createHash  
**Target:** Use async verifyPassword

**Actions:**
- [ ] Find line with: `const hash = crypto.createHash("sha256")`...`
- [ ] Add import: `import { verifyPassword } from "@/lib/hash"`
- [ ] Replace crypto hash block with:
  ```typescript
  const isValid = await verifyPassword(providedPassword, doc.passwordHash);
  if (!isValid) {
    return new NextResponse("Unauthorized", { status: 401, headers: headers() });
  }
  ```
- [ ] Remove unused `import crypto`

**Location:** Around line 62  
**Status:** ☐ Complete  
**Test:** `npm run typecheck`

---

### Step 17: Fix `app/share/[id]/file/route.ts`

**Current state:** Uses sync crypto.createHash  
**Target:** Use async verifyPassword

**Actions:**
- [ ] Same as Step 16 but find different line (around 33)
- [ ] Add import: `import { verifyPassword } from "@/lib/hash"`
- [ ] Replace crypto hash with verifyPassword call
- [ ] Remove unused `import crypto`

**Status:** ☐ Complete  
**Test:** `npm run typecheck`

---

### Step 18: Fix `app/share/[id]/json/route.ts`

**Current state:** Uses sync crypto.createHash + sha256Hex inconsistency  
**Target:** Use async verifyPassword consistently

**Actions:**
- [ ] Find password verification section (around line 56)
- [ ] Current code uses `await sha256Hex()` - this is OK
- [ ] But for consistency, change to `verifyPassword()`
- [ ] Update imports to use verifyPassword

**Status:** ☐ Complete  
**Test:** `npm run typecheck`

---

### Step 19: Fix `app/share/[id]/jsonl/route.ts`

**Current state:** Uses sync crypto.createHash  
**Target:** Use async verifyPassword

**Actions:**
- [ ] Find password verification section (around line 44)
- [ ] Add import: `import { verifyPassword } from "@/lib/hash"`
- [ ] Replace crypto hash with verifyPassword call
- [ ] Remove unused `import crypto`

**Status:** ☐ Complete  
**Test:** `npm run typecheck`

---

## PHASE 5: Configuration Files (30 minutes)

### Step 20: Update `vercel.json`

**Current state:** Basic CORS headers only  
**Target:** Full security headers

**Actions:**
- [ ] Read current file
- [ ] Keep existing structure
- [ ] Update `/share/(.*)` section with new headers from IMPLEMENTATION_GUIDE.md
- [ ] Add `/api/:path*` section with security headers
- [ ] Specifically add:
  - X-Content-Type-Options: nosniff
  - X-Frame-Options: DENY
  - Strict-Transport-Security
  - Content-Security-Policy
  - Referrer-Policy

**Status:** ☐ Complete  
**Test:** Valid JSON format

---

### Step 21: Update `package.json` (Optional but Recommended)

**Actions:**
- [ ] Add scripts in package.json:
  ```json
  {
    "scripts": {
      "build": "next build",
      "typecheck": "tsc --noEmit",
      "validate": "npm run lint && npm run typecheck"
    }
  }
  ```

**Status:** ☐ Complete

---

## PHASE 6: Testing & Verification (1 hour)

### Step 22: Build Verification

```bash
npm run build
npm run typecheck
npm run lint
```

**Status:** ☐ Complete  
**Expected:** All pass without CRITICAL errors

---

### Step 23: Local Testing Setup

**Setup:**
- [ ] Start MongoDB locally or ensure connection string set
- [ ] Set CRON_SECRET: `export CRON_SECRET=test-secret-key`
- [ ] Start dev server: `npm run dev`
- [ ] Server should start on port 3000

**Status:** ☐ Complete  
**Test:** Visit http://localhost:3000 - app loads

---

### Step 24: Security Test 1 - Authorization Check

```bash
# Test: POST to sync endpoint without API key (should fail)
curl -X POST http://localhost:3000/api/sync \
  -H "Content-Type: application/json" \
  -d '{
    "shareId":"test-share",
    "projectName":"test",
    "files":[]
  }'
```

**Expected Response:** `401 Unauthorized`  
**Status:** ☐ Pass

---

### Step 25: Security Test 2 - ShareId Validation

```bash
# Test: Invalid shareId format (should fail)
curl -X POST http://localhost:3000/api/sync \
  -H "X-API-Key: test-share" \
  -H "Content-Type: application/json" \
  -d '{
    "shareId":"../../../etc/passwd",
    "projectName":"test",
    "files":[]
  }'
```

**Expected Response:** `400 Invalid shareId format`  
**Status:** ☐ Pass

---

### Step 26: Security Test 3 - Cron Protection

```bash
# Test 1: Cron without secret (should fail)
curl -X POST http://localhost:3000/api/cron/purge-expired

# Test 2: Cron with wrong secret (should fail)
curl -X POST http://localhost:3000/api/cron/purge-expired \
  -H "Authorization: Bearer wrong-key"

# Test 3: Cron with correct secret (should work)
curl -X POST http://localhost:3000/api/cron/purge-expired \
  -H "Authorization: Bearer test-secret-key"
```

**Expected:** Tests 1 & 2 return 401, Test 3 returns 200  
**Status:** ☐ Pass

---

### Step 27: Functional Test 1 - Create Share

```bash
curl -X POST http://localhost:3000/api/sync \
  -H "X-API-Key: my-share-123" \
  -H "Content-Type: application/json" \
  -d '{
    "shareId":"my-share-123",
    "projectName":"My Project",
    "files":[
      {"path":"README.md","content":"# Hello World"}
    ]
  }'
```

**Expected Response:** `{"ok":true,"shareId":"my-share-123"}`  
**Status:** ☐ Pass

---

### Step 28: Functional Test 2 - Read Share

```bash
curl "http://localhost:3000/api/share?shareId=my-share-123"
```

**Expected Response:** JSON with projectName and files  
**Status:** ☐ Pass

---

### Step 29: Functional Test 3 - Password Protection

```bash
# Set password
curl -X POST http://localhost:3000/api/share/auth \
  -H "Content-Type: application/json" \
  -d '{
    "shareId":"my-share-123",
    "password":"secret123"
  }'

# Should return {ok: true}
```

**Expected Response:** `{"ok":true}`  
**Status:** ☐ Pass

---

### Step 30: Functional Test 4 - Password Verification

```bash
# Verify with correct password
curl "http://localhost:3000/share/my-share-123?password=secret123"

# Verify with wrong password (should fail)
curl "http://localhost:3000/share/my-share-123?password=wrong"
```

**Expected:** First returns project content, second returns `Unauthorized`  
**Status:** ☐ Pass

---

## PHASE 7: Pre-Deployment (30 minutes)

### Step 31: Final Build

```bash
npm run build && npm run typecheck
```

**Status:** ☐ Complete  
**Expected:** Zero errors (warnings OK)

---

### Step 32: Environment Setup

- [ ] Set MONGODB_URI in Vercel environment
- [ ] Set CRON_SECRET in Vercel environment (use `npx crypto randomUUID` to generate)
- [ ] Set APP_ENVIRONMENT=production
- [ ] Set LOG_LEVEL=warn (for production)
- [ ] Verify NEXT_PUBLIC_APP_VERSION

**Status:** ☐ Complete

---

### Step 33: Database Backup

```bash
# If using MongoDB Atlas, create backup
# If local, export database
```

**Status:** ☐ Complete

---

### Step 34: Deployment

```bash
git add .
git commit -m "Fix critical security issues before deployment"
git push origin main
# Deploy via Vercel dashboard
```

**Status:** ☐ Complete  
**Expected:** Deployment succeeds

---

### Step 35: Post-Deployment Verification

After deploying to production:

```bash
# Test 1: Health check
curl https://your-app.com/api/health

# Test 2: Create test share
curl -X POST https://your-app.com/api/sync \
  -H "X-API-Key: test-share-prod" \
  -H "Content-Type: application/json" \
  -d '{"shareId":"test-share-prod","projectName":"Test","files":[]}'

# Test 3: Read share
curl "https://your-app.com/api/share?shareId=test-share-prod"

# Test 4: Cleanup
curl -X DELETE https://your-app.com/api/sync/project \
  -H "X-API-Key: test-share-prod" \
  -H "Content-Type: application/json" \
  -d '{"shareId":"test-share-prod"}'
```

**Status:** ☐ Complete  
**Expected:** All tests pass

---

## Summary Checklist

### Phase 1: Setup
- [ ] Install dependencies
- [ ] Create .env.example
- [ ] Verify build works

### Phase 2: Libraries (Critical)
- [ ] Fix env.ts
- [ ] Fix hash.ts (add bcrypt)
- [ ] Fix log.ts
- [ ] Fix api-guard.ts
- [ ] Fix mongodb.ts

### Phase 3: API Routes (Critical)
- [ ] Fix share/auth route
- [ ] Fix sync route
- [ ] Fix sync/project route
- [ ] Fix cron route
- [ ] Fix sync/delete route
- [ ] Fix sync/bulk-delete route
- [ ] Fix sync/reset route

### Phase 4: Share Routes
- [ ] Fix share/[id]/route.ts
- [ ] Fix share/[id]/file/route.ts
- [ ] Fix share/[id]/json/route.ts
- [ ] Fix share/[id]/jsonl/route.ts

### Phase 5: Configuration
- [ ] Update vercel.json
- [ ] Create .env.example
- [ ] Add package.json scripts (optional)

### Phase 6: Testing
- [ ] Build and typecheck
- [ ] Local testing
- [ ] Security tests (6 tests)
- [ ] Functional tests (5 tests)

### Phase 7: Deployment
- [ ] Final build
- [ ] Setup environment variables
- [ ] Backup database
- [ ] Deploy to production
- [ ] Post-deployment verification

---

## Time Tracking Template

| Phase | Task | Est. Time | Actual | Status |
|-------|------|-----------|--------|--------|
| 1 | Setup & Dependencies | 15 min | ___ | ☐ |
| 2 | Core Libraries | 60 min | ___ | ☐ |
| 3 | API Routes | 120 min | ___ | ☐ |
| 4 | Share Routes | 60 min | ___ | ☐ |
| 5 | Configuration | 30 min | ___ | ☐ |
| 6 | Testing | 60 min | ___ | ☐ |
| 7 | Deployment | 30 min | ___ | ☐ |
| **TOTAL** | | **375 min (6.25 hours)** | ___ | ☐ |

---

**Status:** Ready to start implementation

**Next Step:** Begin with PHASE 1 - Setup & Dependencies

