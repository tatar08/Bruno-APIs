# Bruno APIs — Improvement & Future-Readiness Roadmap

> เอกสารวิเคราะห์ ณ วันที่ 20 กรกฎาคม 2026  
> ขอบเขต: Bruno Desktop, Browser UI, Bruno Bridge Server และ shared packages ใน repository นี้

> **สถานะการทำงาน (อัปเดตล่าสุด):** ✅ = เสร็จแล้ว, 🟡 = เสร็จบางส่วน (ดูรายละเอียดว่าเหลืออะไรใต้หัวข้อนั้น), ไม่มีสัญลักษณ์ = ยังไม่เริ่ม  
> รายละเอียดการ implement/verify แต่ละอย่างอยู่ใน `find bug and Improvement.md` (หัวข้อ 4.1 เป็นต้นไป)

## 1. Executive Summary

Browser version ในปัจจุบันมี functional parity กับ Desktop ใน flow หลักแล้ว แต่ architecture ยังอยู่ในช่วง compatibility bridge: ฝั่ง server จำลอง Electron, intercept `require('electron')` และ expose IPC ผ่าน HTTP/WebSocket โดยตรง วิธีนี้เหมาะกับการพิสูจน์แนวคิดและทำ parity ระยะแรก แต่ยังไม่เหมาะกับ production, remote access หรือ multi-user usage

ลำดับการลงทุนที่แนะนำคือ:

1. **Secure the Bridge** — authentication, origin allowlist, localhost binding, path sandbox, rate limit และปิด privileged features ตามค่าเริ่มต้น
2. **Create a typed, shared application core** — แยก business logic ออกจาก Electron IPC และเลิกพึ่ง global module monkey patch
3. **Add Browser parity CI** — ทดสอบ contract และ user journey ทั้ง Browser/Desktop อัตโนมัติ
4. **Make Browser UX native-quality** — server file explorer, upload/download, connection state, reconnect และ OAuth callback
5. **Productionize deployment** — single-server packaging, HTTPS/WSS, Docker, health/readiness, config และ observability
6. **Adopt future API standards** — OpenAPI 3.2, Arazzo 1.1 และ AsyncAPI 3

ข้อเสนอสำคัญที่สุดคือ **อย่าเปิด Browser Bridge ให้ Internet ใช้งานก่อนทำ P0 Security** เพราะ Bridge สามารถอ่าน/เขียน filesystem, รัน terminal, เรียก Git และส่ง network request จากเครื่อง host ได้

---

## 2. Current-State Findings

### 2.1 จุดแข็งที่มีอยู่แล้ว

- Browser transport รองรับ request/response ผ่าน HTTP และ push event ผ่าน WebSocket
- IPC channel ฝั่ง Browser ครอบคลุม Desktop handlers และ events หลัก
- รองรับ HTTP, WebSocket, gRPC, collections, workspaces, environments, Git, terminal, AI และ API Specs
- ใช้ collection/workspace/API spec watchers จริง ทำให้ state sync ใกล้เคียง Desktop
- React 19 และ Rsbuild เป็นฐาน frontend ที่ยังทันสมัย
- มี test suite ขนาดใหญ่สำหรับ Desktop และ shared behavior
- มี installation guide สำหรับ Browser/Desktop ครบสามระบบปฏิบัติการ

### 2.2 ช่องว่างที่ควรแก้

| พื้นที่ | สภาพปัจจุบัน | ความเสี่ยง/ผลกระทบ |
|---|---|---|
| HTTP authentication | `/api/ipc/:channel` ไม่มี authentication | เว็บไซต์หรือ client ที่เข้าถึง port ได้อาจเรียก privileged IPC |
| CORS | `origin: true` พร้อม credentials | origin ใดก็ได้สามารถส่ง request ใน development configuration ปัจจุบัน |
| Network binding | `server.listen(PORT)` ไม่กำหนด loopback host | อาจเปิดรับ connection จาก network interfaces อื่น |
| IPC authorization | route เรียก registered channel ได้โดยชื่อ channel | ไม่มี per-channel capability หรือ role check |
| WebSocket security | ไม่มี origin validation, auth, `maxPayload`, rate limit และ heartbeat | เสี่ยง CSWSH, connection exhaustion และ memory pressure |
| Session isolation | `WindowShim` และ watchers เป็น singleton; event broadcast ไปหลาย clients | event/state/secrets อาจข้าม session เมื่อเปิดหลาย browser clients |
| Filesystem boundary | รับ absolute path จาก Browser | ผู้ใช้หรือผู้โจมตีอาจเข้าถึง path นอก workspace ที่ตั้งใจ |
| Terminal/Git | Browser เรียก privileged handlers ได้ | เพิ่ม blast radius หาก Bridge ถูกโจมตี |
| Secret storage | Browser shim ระบุว่า encryption unavailable และ encode ด้วย `Buffer` | ไม่ใช่ encryption at rest |
| Payload size | JSON และ URL-encoded limit `100mb` | สูงเกินจำเป็นสำหรับ IPC ทั่วไปและเพิ่ม DoS risk |
| Architecture | monkey patch `Module._load` เพื่อแทน Electron module | เปราะเมื่อ Electron handlers หรือ dependencies เปลี่ยน |
| Startup health | handler registration หลายส่วน catch error แล้ว server ยัง start | server อาจรายงาน healthy ทั้งที่ feature บางชุดไม่พร้อม |
| Browser file UX | ใช้ `window.prompt()` ให้กรอก server path | ใช้งานยาก, validate feedback จำกัด และไม่เหมาะกับ remote users |
| Reconnect | retry ไม่จำกัดและ queue ไม่มีเพดาน | offline นานอาจสร้าง log noise หรือ memory growth |
| Cancellation | HTTP invoke ไม่มี standardized timeout/cancel/request ID | request ที่ค้างควบคุมและ debug ยาก |
| Automated parity | Playwright config ยังไม่มี Browser Bridge project | regression ฝั่ง Browser มีโอกาสหลุดเข้า release |
| Version lifecycle | Node 22, Electron 37, React 19.0 และ Express 4 | ต้องมี automated upgrade cadence; Electron 37 อยู่นอกสาม major ล่าสุดแล้ว |

---

## 3. Product Principles

ใช้หลักต่อไปนี้เป็น guardrail ของ roadmap:

1. **Local-first by default** — collections ต้องยังเป็นไฟล์ที่ version control ได้ และไม่บังคับ cloud
2. **Secure by default** — feature ที่มีสิทธิ์สูงต้อง opt-in และจำกัด scope
3. **One core, multiple shells** — Desktop และ Browser ใช้ domain services ชุดเดียวกัน ไม่ duplicate logic
4. **Capability-based parity** — UI ตรวจ capability ของ runtime แทนการสมมติว่า Browser ทำได้ทุกอย่างเหมือน Electron
5. **Backward-compatible formats** — การ upgrade ต้องไม่ทำ collection format เดิมเสีย
6. **Observable and testable** — ทุก critical flow มี contract test, metrics และ structured error
7. **Progressive enhancement** — Browser ที่ไม่รองรับ native API ยังใช้งาน core features ได้

---

## 4. Prioritized Roadmap

## P0 — ต้องทำก่อน Production/Remote Access (0–6 สัปดาห์)

### P0.1 Secure Bridge Bootstrap and Authentication ✅ เสร็จแล้ว (opt-in — ปิดเป็นค่าเริ่มต้น, เปิดด้วย `BRUNO_SERVER_REQUIRE_AUTH=true`)

**เป้าหมาย:** มีเพียง Browser instance ที่ผู้ใช้อนุญาตเท่านั้นที่เรียก Bridge ได้

งานที่ควรทำ:

- ✅ bind `127.0.0.1`/`::1` เป็นค่าเริ่มต้น และต้อง opt-in ชัดเจนสำหรับ LAN mode
- ✅ สร้าง one-time bootstrap token ตอน start server
- ✅ แลก bootstrap token เป็น short-lived session
- ✅ ใช้ `HttpOnly`, `Secure`, `SameSite=Strict` cookie หรือ Authorization token ที่ไม่ถูกเก็บใน URL/log
- ✅ validate `Origin` ทั้ง HTTP และ WebSocket ด้วย exact allowlist
- ✅ เพิ่ม CSRF protection หากใช้ cookie session
- ✅ rotate/revoke session และปิด WebSocket ทันทีเมื่อ logout/หมดอายุ
- 🟡 redact token, cookie, Authorization และ secret values จาก log — bootstrap token ปริ้นท์ครั้งเดียวตอน start เท่านั้น (ไม่ log ซ้ำ) แต่ยังไม่มี blanket log-redaction layer ทั่วทั้ง server

**Acceptance criteria:**

- request ที่ไม่มี session ได้ `401`
- origin ที่ไม่ได้อนุญาตถูกปฏิเสธทั้ง HTTP และ WebSocket
- default process ไม่รับ connection จาก LAN
- token ไม่ปรากฏใน application log, browser history หรือ query string
- automated tests ครอบคลุม auth bypass และ cross-site WebSocket attempt

### P0.2 Channel Policy and Capability Authorization 🟡 เสร็จบางส่วน

**เป้าหมาย:** การเชื่อมต่อกับ Bridge ไม่เท่ากับมีสิทธิ์เรียกทุก IPC

แบ่ง channel เป็น capability เช่น (✅ ทำแล้ว — 13 capability ครอบทุก channel จริงผ่าน `security/channel-capabilities.js`, ไม่ตรง 1:1 กับชื่อตัวอย่างด้านล่างเป๊ะแต่ครอบความหมายเดียวกัน):

- `collections:read`, `collections:write`
- `network:send`
- `filesystem:read`, `filesystem:write`
- `git:read`, `git:write`
- `terminal:execute`
- `ai:use`, `secrets:manage`

ข้อเสนอ:

- ✅ allowlist เฉพาะ channel ที่ Browser รองรับอย่างตั้งใจ (unknown channel → 404)
- ✅ ปิด Terminal, arbitrary filesystem write และ destructive Git actions ตามค่าเริ่มต้น (`privileged-channels.js`)
- 🟡 เพิ่ม confirmation/policy สำหรับ action เสี่ยงสูง — ยังไม่ทำ ต้องถามผู้ใช้ก่อน (breaking UX change)
- 🟡 validate input/output ทุก channel ด้วย schema — มี extension point (`CHANNEL_SCHEMAS`) และลงทะเบียนแล้วเฉพาะกลุ่มเสี่ยงสูง (terminal + git-mutate) ยังไม่ครบทั้ง ~203 handler
- ✅ จำกัด payload เป็นราย channel แทน global `100mb` (ราย capability, global ลดจาก 100mb → 25mb)
- ✅ เพิ่ม rate limit, concurrency limit และ execution timeout (เปิดเป็นค่าเริ่มต้น)

**Acceptance criteria:** unknown channel เป็น `404` ✅, known-but-forbidden เป็น `403` ✅, invalid payload เป็น `400` ✅ (บางส่วน — ตาม schema ที่ลงทะเบียนแล้ว) และ privileged channels ใช้งานไม่ได้จนกว่าจะ grant capability 🟡 (ปิดตามค่าเริ่มต้นแล้ว แต่ยังไม่มี grant-flow UX แยก)

### P0.3 Filesystem Sandbox 🟡 เสร็จบางส่วน (coarse safety net, opt-in)

**เป้าหมาย:** Browser เข้าถึงได้เฉพาะ roots ที่ผู้ใช้อนุญาต

- ✅ เพิ่ม `allowedRoots` configuration (`BRUNO_SERVER_ALLOWED_ROOTS`, opt-in — ปิดเป็นค่าเริ่มต้น)
- ✅ resolve path ด้วย `realpath` ก่อน authorize
- ✅ ป้องกัน `..`, symlink escape — มี unit test ครอบทั้งคู่; UNC/network path และ case-insensitive bypass บน Windows ยังไม่ได้ทดสอบเฉพาะเจาะจง
- แยก read/write permission ต่อ root — ยังไม่ทำ (ตอนนี้ allow/deny รวมทั้ง root ไม่แยก read/write)
- ให้ผู้ใช้ revoke root ได้ — ยังไม่ทำ (ตั้งค่าผ่าน env var ตอน start เท่านั้น ไม่มี runtime UI)
- บันทึก audit event โดยไม่ log secret/file content — ยังไม่ทำ
- upload ต้องตรวจ size, extension, magic bytes และ filename normalization — ยังไม่ทำ

**ข้อจำกัดสำคัญ**: ตัว scanner เป็น generic เดาจาก "string ที่หน้าตาเหมือน absolute path" ไม่รู้ semantic รายช่อง — เป็น **safety net เสริม ไม่ใช่ per-channel validation ที่สมบูรณ์** (มีแค่ 5/~85+ handler ที่รับ path ที่เคย validate เองมาก่อนหน้านี้) มี extension point (`CHANNEL_PATH_EXTRACTORS`) ให้เพิ่มความแม่นยำทีละ channel ได้ในอนาคต

**Acceptance criteria:** ทุก filesystem handler ผ่าน policy layer เดียว 🟡 (ผ่าน chokepoint เดียวจริง แต่เป็น generic scan ไม่ใช่ per-channel) และ test traversal/symlink/Windows path edge cases ครบ 🟡 (traversal+symlink มี, Windows-specific ยังไม่มี)

### P0.4 Per-Session Isolation ✅ เสร็จแล้ว (ทำงานเมื่อเปิด P0.1 auth เท่านั้น — ไม่เปิด auth = session เดียว ไม่มีอะไรให้ isolate)

**เป้าหมาย:** หลาย Browser tabs/users ไม่เห็น event, active workspace, terminal หรือ secret ของกันและกัน

- ✅ สร้าง `SessionContext` ต่อ authenticated client (`AsyncLocalStorage`-based, ทั้ง `bruno-server` และ `bruno-requests`)
- ✅ map HTTP request และ WebSocket connection ด้วย session ID เดียวกัน
- ✅ route `webContents.send()` ไปยัง session owner แทน global broadcast
- ✅ isolate terminal processes, cancel tokens (WS/gRPC connection ownership), active environment (legacy global-env uid) และ temporary collections/mount state, cookie jar
- ✅ reference-count shared filesystem watchers และ cleanup เมื่อ session ปิด
- ✅ จำกัดจำนวน sessions/terminals/watchers ต่อ session (ผ่าน `resource-limits.js`, ปรับได้ผ่าน env var — "ต่อ user" ปรับเป็น "ต่อ session" เพราะสถาปัตยกรรมนี้ไม่มี user จริง มีแต่ anonymous session)

**ที่เหลือ (severity ต่ำ, บันทึกเป็น follow-up ไม่ใช่ตัดทิ้ง)**: onboarding flow (`hasLaunchedBefore` flag) ยังเป็น shared singleton ระดับ server ไม่ผูก session — only fires ตอน session แรก boot เท่านั้น ผลกระทบต่ำกว่าจุดอื่นที่แก้ไปแล้วมาก

**Acceptance criteria:** integration test สอง browser contexts ต้องไม่รับ event หรือ state ของอีก context ✅ (unit + live E2E ยืนยันแล้วสำหรับ cookie, WS/gRPC connection, terminal, watcher — active-state 4 จุดสุดท้ายยืนยันด้วย unit test + code review ไม่มี live E2E เพิ่ม)

### P0.5 Typed RPC Contract Instead of Raw IPC Proxy 🟡 เสร็จบางส่วน

**เป้าหมาย:** ป้องกัน channel drift และลด runtime-only bugs

สร้าง package เช่น `packages/bruno-rpc-contract` ที่ประกอบด้วย: (✅ package นี้สร้างแล้วจริง — `@usebruno/rpc-contract`)

- ✅ channel names แบบ typed constants (`CHANNELS`/`ALL_CHANNELS`, generate จาก 229 channel จริง)
- request/response schemas — ยังไม่ทำ (ต้อง verify signature จริงของ ~203 handler ก่อน)
- event schemas — ยังไม่ทำ
- ✅ error envelope มาตรฐาน (`ERROR_CODES` + `createErrorEnvelope()`, wired เข้า `ipc-proxy.js` แบบ additive)
- ✅ capability metadata (ย้าย capability taxonomy จาก P0.2 มาเป็น canonical ที่นี่)
- generated Browser client และ Electron adapter — ยังไม่ทำ, renderer ยังเรียกด้วย raw channel string เหมือนเดิม (เป็น plain JS เกือบทั้งหมด ยังไม่มี TS convention ให้ leverage)

กำหนด error format:

```json
{
  "code": "PATH_OUTSIDE_ALLOWED_ROOT",
  "message": "The selected path is outside an allowed root",
  "requestId": "...",
  "retryable": false,
  "details": {}
}
```

**Acceptance criteria:** CI fail เมื่อ Desktop handler, Browser route หรือ renderer caller ไม่ตรง contract และไม่มี string channel ที่สำคัญกระจายโดยไม่มี type checking — 🟡 มี audit script รันได้จริงและ live-verify แล้วว่า detect drift ถูกต้อง (`npm run audit:parity`, มี `--write` heal) แต่ยังไม่ผูกเข้า CI merge gate เพราะ **repo นี้ไม่มี CI pipeline เลย** (ไม่มี `.github/workflows`/`.gitlab-ci`/ฯลฯ)

### P0.6 Browser Parity CI ✅ เสร็จแล้ว

เพิ่ม Playwright project `browser-bridge` ที่ start:

1. `bruno-server`
2. `bruno-app`
3. isolated temporary user-data/workspace

🟡 **สโคปที่ทำจริงตอนนี้เป็น smoke suite ระดับ boot + API surface + security defaults เท่านั้น (3 spec file, 9/9 test ผ่าน)** — Minimum test matrix เต็มด้านล่างส่วนใหญ่ยังไม่ครอบคลุม เพราะยังต้องพึ่ง Electron e2e suite เดิมสำหรับ UI-driven flow (component เดียวกัน ต่างแค่ transport layer):

- Windows, macOS, Linux — ยังไม่ทำ (รันเฉพาะ platform ปัจจุบัน)
- Node 24 LTS เป็นหลัก; Node 22 ระหว่าง migration — ยังไม่ทำ
- create/open/reload collection — ยังไม่ทำ (UI-driven, ยังไม่ครอบ)
- request send/cancel — ยังไม่ทำ (UI-driven, ยังไม่ครอบ)
- WebSocket/gRPC/SSE — ยังไม่ทำ (UI-driven, ยังไม่ครอบ)
- environments/secrets — ยังไม่ทำ (UI-driven, ยังไม่ครอบ)
- workspace snapshot restore — ยังไม่ทำ (UI-driven, ยังไม่ครอบ)
- file import/export — ยังไม่ทำ (UI-driven, ยังไม่ครอบ)
- OAuth callback — ยังไม่ทำ (UI-driven, ยังไม่ครอบ)
- reconnect หลัง restart Bridge — ยังไม่ทำ (UI-driven, ยังไม่ครอบ)
- two-session isolation — ยังไม่ทำ ใน Playwright (มี live-verification แบบ manual script แล้วสำหรับหลาย resource type ใน P0.4 แต่ไม่ใช่ automated Playwright suite)
- ✅ security negative tests — `security-defaults.spec.ts` ครอบ origin allowlist, privileged-channel block, auth-off default, sandbox-off default

เพิ่ม static parity audit ที่เปรียบเทียบ Electron handlers กับ RPC contract ทุก PR — ✅ script มีแล้ว (`scripts/audit-parity.js`, ดู P0.5) แต่ 🟡 ยังไม่ผูกเข้า "ทุก PR" เพราะไม่มี CI pipeline

---

## P1 — ทำให้ Browser ใช้งานจริงได้ดี (1–3 เดือน)

### P1.1 Server File Explorer and Transfer Center

แทน `window.prompt()` ด้วย modal ที่มี:

- browse เฉพาะ allowed roots
- breadcrumb, search, recent paths และ favorites
- create folder, rename และ conflict resolution
- multi-select พร้อม preview
- upload จาก client ไป Bridge และ download จาก Bridge ไป client
- progress, cancel, checksum และ resume สำหรับไฟล์ใหญ่
- แสดงให้ชัดว่า path เป็นของ **Bridge machine** หรือ **Browser machine**

API ควรใช้ opaque file handles แทนส่ง absolute path กลับ renderer ทุกครั้ง

### P1.2 Connection and Recovery UX 🟡 เสร็จบางส่วน

- ✅ connection indicator: Connecting / Online / Degraded / Offline
- ✅ exponential backoff พร้อม jitter และ max delay
- ✅ heartbeat/ping-pong และ stale connection detection
- ✅ bounded outbound queue พร้อม deduplication
- ✅ request ID, timeout และ `AbortController` cancellation
- ยังไม่ทำ — idempotency key สำหรับ create/save ที่ retry ได้ (ต้องไล่ดูทีละ handler ว่า retry-safe จริงไหม เป็น product-scope decision ต่อ endpoint)
- ยังไม่ทำ — event sequence number และ resync หลัง reconnect (architecture decision ใหญ่กว่า 1 increment: event log/buffer design, TTL, memory budget)
- ยังไม่ทำ — offline read-only cache สำหรับ UI state ล่าสุด (product decision: storage scope + invalidation policy)

ไม่ควร retry destructive action อัตโนมัติหากไม่มี idempotency guarantee

### P1.3 Production Browser Packaging 🟡 เสร็จบางส่วน

- ยังไม่ทำ — ให้ Bridge serve production static assets ชุดเดียวกับ API (ต้องแก้ rsbuild config + runtime config mechanism ก่อน)
- ยังไม่ทำ — runtime config endpoint แทน compile-time/hardcoded port (`window.__BRUNO_SERVER_PORT__` เป็น dead code ปัจจุบัน ไม่มีจุดไหน set ค่าจริง)
- ยังไม่ทำ — รองรับ reverse proxy base path (ต้องแก้ hardcoded `/api/...`/`/ws/events` หลายจุดใน `ipc-transport.js`)
- ยังไม่ทำ — HTTPS/WSS สำหรับ non-loopback mode (deployment-topology decision ที่ควรถามผู้ใช้ก่อน)
- ยังไม่ทำ — Docker image แบบ non-root, read-only filesystem และ mount allowed roots แบบ explicit (repo นี้ยังไม่มี Dockerfile เลย)
- ✅ `/health/live`, `/health/ready`, build info และ dependency readiness
- ✅ graceful shutdown ที่ปิด watchers, terminals, sockets และ pending requests (มี ordering fix ยืนยันแล้วว่าไม่ hang รอ timeout)
- ✅ configuration validation ตอน start; invalid config ต้อง fail fast
- ยังไม่ทำ — SBOM, dependency scanning, signed images/artifacts และ provenance (ต้องมี CI pipeline ก่อน ซึ่ง repo นี้ยังไม่มี)

### P1.4 Real Secret Storage

- Desktop ใช้ OS keychain/safeStorage ต่อไป
- Browser local mode ใช้ keyring backend ของ OS หรือ encrypted vault
- remote/server mode รองรับ external secret provider ผ่าน interface
- master key ต้องไม่เก็บข้าง ciphertext
- support rotation, lock/unlock, backup policy และ secret redaction
- ห้ามใช้ Base64 เป็น encryption fallback

### P1.5 Browser-Compatible OAuth 2.1 Flow

- loopback callback endpoint ที่ Bridge
- PKCE และ state validation
- exact redirect URI registry
- callback routing กลับ session ที่เริ่ม flow
- timeout/cancel และ popup-blocked fallback
- redact authorization code/token จาก logs
- test parallel OAuth flows จากสอง sessions

### P1.6 Runtime and Dependency Modernization

สถานะ ณ กรกฎาคม 2026:

- Node 24 เป็น LTS; Node 26 เป็น Current
- Electron project support เฉพาะสาม stable majors ล่าสุด ขณะที่ repository ใช้ Electron 37 และ stable ล่าสุดอยู่ในสาย 43
- React latest documentation อยู่ที่ 19.2 แต่ repository ใช้ 19.0
- Express 5.1 เป็น default บน npm แต่ Bridge ใช้ Express 4.21

แผนแนะนำ:

1. เพิ่ม Renovate/Dependabot แบบ grouped updates
2. upgrade Node baseline เป็น 24 LTS และทดสอบ 26 แบบ allowed-to-fail
3. upgrade Electron ทีละ major พร้อม smoke test/security checklist
4. upgrade React 19.2 และแก้ React 19 ref warnings
5. migrate Bridge ไป Express 5 พร้อม contract/integration tests
6. กำหนด quarterly dependency upgrade window และ SLA สำหรับ security patches

อย่า upgrade ทุก dependency ใน PR เดียว ควรแยก runtime, build tooling และ UI libraries เพื่อลด blast radius

---

## P2 — Modern Product Capabilities (3–6 เดือน)

### P2.1 API Workflow Testing with Arazzo 1.1

Arazzo นิยามลำดับ API calls, dependencies, inputs, outputs และ success/failure criteria จึงเหมาะกับ Bruno Runner

ฟีเจอร์ที่เสนอ:

- import/export Arazzo workflow
- visual workflow graph
- map step outputs ไป variables ของ step ถัดไป
- parallel steps และ dependency graph
- retry/timeout/rollback policy
- CI runner report แบบ JUnit/JSON/HTML
- dry-run และ permission preview ก่อนรัน workflow ที่มาจาก third party

### P2.2 OpenAPI 3.2 First-Class Support

- parser, validation และ rendering สำหรับ OpenAPI 3.2
- retain 3.0/3.1 compatibility
- generate collection แบบ deterministic เพื่อให้ Git diff สะอาด
- two-way sync พร้อม conflict preview
- linting profiles และ quick fixes
- contract testing จาก schema/examples
- migration assistant ระหว่าง OAS versions

### P2.3 AsyncAPI 3 and Event-Driven APIs

AsyncAPI 3 รองรับ protocol-agnostic message-driven APIs เช่น WebSocket, MQTT, Kafka, AMQP และ STOMP

เริ่มจาก:

- import/render AsyncAPI 3
- generate WebSocket requests จาก channels/messages
- message schema validation
- record/replay event streams
- เพิ่ม MQTT/Kafka/AMQP เป็น plugin providers แทนฝังใน core

### P2.4 Installable PWA Shell

- web app manifest, icons, theme และ standalone display
- service worker cache เฉพาะ static UI assets
- offline startup ที่แสดง cached workspaces แบบ read-only
- update available notification และ safe reload
- protocol/deep-link handoff ไป Bridge

PWA ไม่ควร cache API responses หรือ secrets โดยอัตโนมัติ และ privileged actions ยังต้องผ่าน authenticated Bridge

### P2.5 Observability and Diagnostics

- structured JSON logs พร้อม request/session ID
- OpenTelemetry traces สำหรับ Browser → Bridge → network request
- metrics: latency, error rate, reconnects, queue depth, active watchers และ memory
- local diagnostics bundle ที่ redact secrets
- opt-in telemetry เท่านั้น พร้อมหน้าจอ preview ข้อมูลก่อนส่ง
- performance budgets สำหรับ startup, large collections และ memory

### P2.6 Accessibility and Internationalization

- WCAG 2.2 AA audit
- keyboard navigation และ focus management ครบทุก modal/menu
- screen-reader labels และ live region สำหรับ request progress/error
- reduced motion, high contrast และ color-blind-safe status
- externalize Browser-specific prompt/error strings เข้า i18n
- automated axe tests ใน Browser และ Electron

---

## P3 — Strategic Features (6–12 เดือน)

### P3.1 Optional Team Collaboration

คง local-first เป็นค่าเริ่มต้น แล้วเพิ่ม collaboration แบบ opt-in:

- shared workspace membership และ RBAC
- review/comment บน requests และ environments โดยไม่ sync secret values
- presence และ edit conflict indication
- Git-backed review flow เป็นฐานก่อนพิจารณา real-time CRDT
- audit history และ organization policies

ไม่ควรเริ่มจาก real-time collaborative editing จนกว่า session isolation, auth และ data ownership จะเสร็จ

### P3.2 Plugin SDK

สร้าง extension points ที่ versioned สำหรับ:

- protocol adapters
- auth providers
- import/export converters
- secret providers
- request/response viewers
- lint rules และ workflow steps

Plugin ต้องมี manifest, declared permissions, sandbox, signature/trust UI, compatibility range และ kill switch ห้ามให้ plugin เข้าถึง Node/filesystem โดยอัตโนมัติ

### P3.3 Privacy-First AI Assistance

- provider-neutral AI interface
- local model endpoint support
- per-workspace AI disable policy
- preview/redact request bodies, headers และ secrets ก่อนส่ง model
- prompt-injection defense สำหรับ imported specs/docs
- tool-call allowlist และ user confirmation สำหรับ write/run actions
- eval suite วัด correctness, secret leakage และ destructive-action rate
- model/version/prompt provenance ใน generated output

### P3.4 Mocking, Contract Diff and Replay

- local mock server จาก OpenAPI/AsyncAPI examples
- traffic capture และ deterministic replay โดย redact secrets
- semantic contract diff แยก breaking/non-breaking changes
- baseline performance assertions
- consumer-driven contract export/import

---

## 5. Target Architecture

```text
React UI
   │
   ▼
Typed Transport Client
   ├── ElectronTransport ──► Electron RPC Adapter
   └── BrowserTransport  ──► Authenticated HTTP/WebSocket Gateway
                                │
                                ▼
                       Shared Domain Services
                         ├── Collections
                         ├── Workspaces
                         ├── Request Engine
                         ├── Environments/Secrets
                         ├── Git
                         ├── Terminal
                         └── API Specifications
                                │
                                ▼
                       Platform Adapters
                         ├── Filesystem
                         ├── Keychain/Vault
                         ├── Dialog/File Explorer
                         ├── Process/Terminal
                         └── Notifications
```

### Migration Sequence

1. สร้าง RPC schemas รอบ handlers เดิมโดย behavior ยังไม่เปลี่ยน
2. ย้าย filesystem/preferences/snapshot เป็น domain services ชุดแรก
3. ให้ Electron และ Browser เรียก service เดียวกันผ่าน adapter
4. ย้าย network/collection/workspace/Git/terminal ทีละชุด
5. ลบ `Module._resolveFilename`/`Module._load` interception หลัง coverage ครบ
6. เปลี่ยน parity audit จาก “มี channel ชื่อเดียวกัน” เป็น “ผ่าน contract และ behavior suite เดียวกัน”

---

## 6. Recommended Delivery Plan

### Milestone A — Safe Local Browser (6 สัปดาห์)

- Bridge auth + loopback binding
- origin allowlist
- channel capability policy
- filesystem sandbox
- WebSocket limits/heartbeat
- security tests

**Exit gate:** ผ่าน threat-model review และ Browser ไม่สามารถอ่านไฟล์นอก allowed roots

### Milestone B — Reliable Browser Beta (อีก 6–8 สัปดาห์)

- per-session isolation
- typed RPC contract
- Browser Playwright suite
- file explorer modal
- reconnect/resync/cancellation
- OAuth callback

**Exit gate:** critical parity journeys ผ่านบน Windows/macOS/Linux และสอง sessions ไม่รั่ว state/event

### Milestone C — Production Deployment (อีก 6–8 สัปดาห์)

- single-server production bundle
- HTTPS/WSS and reverse-proxy support
- encrypted secrets
- Docker/SBOM/signing
- health/readiness/structured logs/OpenTelemetry
- upgrade Node/Electron/React/Express

**Exit gate:** deploy ใหม่และ rollback ได้, diagnostics พร้อม, dependency/security scan ผ่าน

### Milestone D — Standards and Ecosystem (ไตรมาสถัดไป)

- OpenAPI 3.2
- Arazzo 1.1 workflows
- AsyncAPI 3 foundation
- PWA shell
- plugin SDK design

---

## 7. Metrics to Track

### Reliability

- Browser session crash-free rate ≥ 99.9%
- successful reconnect/resync ≥ 99.5%
- zero duplicate collection after retry
- watcher/terminal cleanup ผ่าน 100% ของ lifecycle tests

### Performance

- warm app interactive ≤ 2 วินาทีบนเครื่องมาตรฐาน
- open collection 1,000 requests ≤ 3 วินาที
- p95 IPC/RPC overhead บน localhost ≤ 50 ms โดยไม่รวมงาน handler
- memory ไม่โตต่อเนื่องหลัง reconnect 100 รอบ

### Security

- zero unauthenticated privileged RPC
- zero filesystem escape ใน traversal suite
- secrets ไม่ปรากฏใน logs/traces/diagnostics
- critical dependency patch SLA ≤ 7 วัน

### Quality

- RPC contract coverage 100%
- Browser/Desktop shared critical journeys ≥ 90%
- accessibility critical violations = 0
- supported runtime อยู่ใน vendor support window เสมอ

---

## 8. Features Not Recommended Yet

ควรเลื่อนสิ่งต่อไปนี้จนกว่า P0/P1 จะเสร็จ:

- เปิด Bridge เป็น public cloud endpoint
- anonymous multi-user access
- real-time collaborative editing
- marketplace ที่รัน arbitrary plugins
- AI agent ที่แก้ไฟล์หรือรัน terminal โดยไม่ยืนยัน
- automatic retry ของ destructive operations
- sync secrets เข้า cloud โดยค่าเริ่มต้น

ฟีเจอร์เหล่านี้เพิ่ม blast radius และจะทำให้แก้ security/session architecture ภายหลังยากขึ้น

---

## 9. Immediate Next Actions

รายการที่เริ่มทำได้ใน sprint ถัดไป:

1. เขียน threat model ของ Browser Bridge และกำหนด trust boundaries
2. เปลี่ยน default listen host เป็น loopback
3. เพิ่ม exact origin allowlist และ one-time bootstrap token
4. ปิด Terminal/Git write/filesystem write ใน Browser จนกว่าจะ grant capability
5. เพิ่ม `maxPayload`, heartbeat, connection/message rate limit ให้ WebSocket
6. ลด default JSON payload limit และกำหนด per-channel limits
7. สร้าง Browser Playwright smoke project
8. เพิ่ม static RPC manifest จาก 202 handlers ปัจจุบัน
9. ออกแบบ `allowedRoots` และทดสอบ traversal/symlink
10. สร้าง UX prototype ของ server file explorer แทน path prompt

---

## 10. References

- [Electron Security Checklist](https://www.electronjs.org/docs/latest/tutorial/security) — context isolation, sandbox, CSP, IPC sender validation และการใช้ Electron รุ่นที่ยังได้รับการสนับสนุน
- [Electron Release Timelines](https://www.electronjs.org/docs/latest/tutorial/electron-timelines) — Electron รองรับสาม stable major ล่าสุด
- [Electron Stable Releases](https://releases.electronjs.org/?channel=stable) — ข้อมูล stable releases ปัจจุบัน
- [Node.js Releases](https://nodejs.org/en/about/previous-releases) — Node 24 เป็น LTS และ Node 26 เป็น Current ณ วันที่จัดทำเอกสาร
- [Express 5 Migration Guide](https://expressjs.com/en/guide/migrating-5/) — แนวทาง migrate จาก Express 4 ไป 5
- [React Versions](https://react.dev/versions) — React documentation รุ่นล่าสุด
- [OWASP WebSocket Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html) — origin validation, auth, authorization, limits, heartbeat และ logging
- [OpenAPI Specification 3.2.0](https://spec.openapis.org/oas/v3.2.0.html)
- [Arazzo Specification 1.1.0](https://spec.openapis.org/arazzo/latest.html)
- [AsyncAPI Specification 3.0.0](https://www.asyncapi.com/docs/reference/specification/v3.0.0)
- [OpenTelemetry JavaScript](https://opentelemetry.io/docs/languages/js/)
- [Making PWAs Installable](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)

