# IPZSK 图片工作台

Web adaptation of JayceHuang/dsh-imagegen 1.7.0. The upstream React studio,
ecommerce flow and node canvas are in `vendor/src/client`; web-only services
are in `web`. Build with `npm ci` and `npm run build` in this directory.
Serve the site root; the entry remains `/image.html`.

The default web entry is a beginner workspace: choose an effect, fill one or two
fields (or upload a photo), then generate one image. `web/beginner-effects.ts`
defines the eight curated effects; the first four appear on the home screen.
Prompts are assembled locally and remain editable under “查看提示词”. Model,
ratio and resolution controls are collapsed under “更多设置”. GPT Image 2 is
the default; GPT Image 2.5 Flare and Gemini remain selectable.
`web/BeginnerStudio.tsx` reuses WebImageApi's existing queue, billing and history.
Generation is locked while a request is queued/running, and completed results
show the actual charged points. There is no hardcoded price estimate.
“我的作品” reads existing browser history; “更多工具” opens the original studio,
including its full template library, ecommerce mode and infinite canvas.

`assets/catalog.json` preserves the previous page's templates and 35 style
images. `import-legacy.mjs` documents the one-time migration from the former
embedded `punkData` page; do not rerun against the new page.

The top-level 素材库 opens all 561 categorized cases; 我的素材 contains only
the user's saved/uploaded images. The normal workspace lists cases in stable
order, 24 per page with a load-more button. `translate-catalog.mjs` localizes
foreign-language prompts at build time; the shipped catalog and case picker
use Chinese prompts without an original-language toggle or runtime translation.

Case selection opens the full prompt editor and clears the previous result preview.
New-image actions reset the working form without deleting saved history. The sidebar
also supports an expanded editor with save/cancel and keyboard shortcuts.
The 561 cases are grouped by 13 Chinese use cases. Library cards render 48 at a time,
using local 420px WebP thumbnails; original images are loaded only in case details.
Regenerate thumbnails with `node prepare-gallery.mjs /path/to/existing/sharp`.
Sharp is an offline build tool, not a production dependency.

Images use the authenticated gateway `/api/me/images/generations` and `/api/me/tasks/:id` with account cookies. The gateway requires prepaid points and settles each task; the task tray shows its billed points. Prompt enhancement also uses the account gateway.
IndexedDB partitions tasks, history, galleries, favorites and canvases by the
business user ID returned by `/api/me/profile`. Anonymous users can browse
public templates. Account changes dispose the previous engine and remount the
private UI. Unscoped legacy works are preserved and imported only after an
explicit ownership claim; legacy tasks are not resubmitted.

Each image gets a durable `Idempotency-Key` before submission. Accepted backend
IDs are checkpointed immediately; reloads resume polling and uncertain POSTs
reconcile through `GET /api/me/image-requests/:key`. Missing records reuse the
same key. Network/download retries keep accepted work; only explicitly failed
images get a new key on user retry. Browser Web Locks coordinate open tabs,
while backend idempotency protects the submission itself. Completed task rows
reference one history entry rather than copying the entire history.

The simple workspace exposes “继续查询原任务” for uncertain work and explains
when retrying a confirmed failure can incur a new charge. Closing the page
pauses local polling; reopening resumes it. Cancelling stops waiting and queued
images; an already-submitted provider request may still be billed.

The maintained backend is `../ipzsk-api-gateway` from the repository root.
Release its schema 18, request-lookup route and `X-IPZSK-User-Id` CORS/identity
guard before releasing this web build. No production deployment is performed
by the local build. Run `npm test` for UI, storage, recovery and account tests.
Native DSH chat attachment and OS folder controls are unavailable on the web.
