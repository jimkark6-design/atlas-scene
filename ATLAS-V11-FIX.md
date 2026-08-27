# ATLAS V11 — Fix the persistent Failed to fetch

The render endpoint previously returned the full MP4 in the same POST response. In this Windows/Next dev setup that made the browser-side fetch fragile even though the server logged HTTP 200.

V11 changes the flow:

1. POST `/api/render` renders and stores the MP4 server-side.
2. `/api/render` returns only small JSON metadata + reviewId.
3. Browser GETs `/api/render-output?reviewId=...` to retrieve the MP4 for preview.
4. Browser sends only `reviewId` to `/api/review-render`.
5. Review extracts frames server-side, scores with Vision, then can trigger correction/re-render.

Expected:

```text
POST /api/render 200
ATLAS REVIEW CACHE CREATED: ...
ATLAS V11 RENDER COMPLETE — fetching rendered video ...
GET /api/render-output?reviewId=... 200
ATLAS V11 RENDER OUTPUT READY — ... bytes
[ATLAS V8] SERVER-SIDE REVIEW PASS 1: reviewing server-side render ...
POST /api/review-render 200
ATLAS REVIEW ...
```

This removes the large MP4 from the POST response entirely.
