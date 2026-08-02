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
- ✅ redact token, cookie, Authorization และ secret values จาก log — ตรวจสอบ `console.*` call site ทั้งหมดใน `bruno-server` แล้ว (78 จุด) ไม่มีจุดไหน log token/cookie/session/header ตรง ๆ เลย (bootstrap token ปริ้นท์ครั้งเดียวตอน start ตามดีไซน์)
- ✅ **error message redaction layer** — จุดที่เคยเป็น 🟡 (`err.message` จาก handler ที่ throw ถูก log ต่อโดยไม่ sanitize เนื้อหา, เสี่ยง secret หลุดถ้า handler ปล่อย error ที่มี URL/token ฝังอยู่) แก้แล้วด้วย generic pattern-based redaction utility (`packages/bruno-server/src/security/log-redaction.js`, `redactSecrets()`) แทนที่จะ audit ทีละ handler (~203 handlers ไม่มี finite set ของ "risky" handler ให้ prioritize ต่างจาก schema validation ของ P0.2) — ใช้ posture เดียวกับ P0.3 filesystem sandbox scanner คือ "coarse safety net" ครอบคลุม 3 pattern: (1) credential ใน URL userinfo (`scheme://user:pass@host`), (2) `Authorization: Bearer/Basic <token>`, (3) key=value ที่ชื่อ key ดูเป็น secret (`api_key`, `token`, `password`, `secret`, ฯลฯ) ไม่ว่าจะเป็น JSON-ish หรือ query-string-ish shape; ทดสอบครบ 6/6 กรณี (`log-redaction.spec.js`) ผูกเข้ากับทุกจุดที่ log `err.message` ใน `bruno-server`: `routes/ipc-proxy.js` (จุดรวมของ error จากทั้ง ~203 IPC handler), `index.js` (21 จุด — handler-load warning และ graceful-shutdown error), `routes/auth.js` (4 จุด — logout cleanup), `ws/event-bridge.js` (2 จุด — WebSocket error/send failure); เจตนา redact เฉพาะ server log — response ที่ส่งกลับ client ยังเป็น `err.message` เดิม เพราะ client คือ session เดียวกับที่ request เข้ามา ไม่ใช่ security boundary ที่ต้องกัน

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
- ✅ เพิ่ม confirmation/policy สำหรับ action เสี่ยงสูง — เดิม mark ว่า "ต้องถามผู้ใช้ก่อน (breaking UX change)" ตาม **"ไม่ต้องเลื่อน ทำให้ครับไปเลย"** แก้ concern นั้นด้วยการทำเป็น opt-in: `BRUNO_SERVER_REQUIRE_CONFIRMATION=true` (ปิดเป็นดีฟอลต์ — ไม่ตั้งค่าก็ไม่มี behavior เปลี่ยนแปลงเลย) เปิด gate ที่ `security/confirmation-policy.js`'s `needsConfirmation()` เรียกใน `ipc-proxy.js` ก่อนถึง path-policy check — เฉพาะ channel ที่เป็น irreversible delete จริงๆ (ไม่ใช่ "high risk" แบบกว้างๆ ที่รวม rename/move/save ซึ่ง revert ได้): `delete-item`, `delete-environment`, `delete-global-environment`, `delete-dotenv-file`, `delete-workspace-dotenv-file`, `delete-workspace-environment`, `delete-transient-requests`, `delete-cookie`, `delete-cookies-for-domain`, `remove-collection`, `remove-collection-from-workspace` (11 channels — ตรงกับกลุ่ม "destructive collection-delete" ที่ schema coverage ข้างบนระบุไว้แล้ว บวก workspace/global-environment delete ที่เข้าเกณฑ์เดียวกันแต่ไม่อยู่ใน list เดิม) เรียกโดยไม่ส่ง `"confirm": true` ใน request body → `428 Precondition Required` (code `CONFIRMATION_REQUIRED`) พร้อม error message บอกวิธีแก้ตรงๆ; ส่ง `confirm: true` มา → ผ่านเข้า handler ปกติ เป็น server-side half เท่านั้น (UI confirm-dialog ที่ set `confirm: true` หลังผู้ใช้กดยืนยันเป็น frontend follow-up แยกต่างหาก เหมือน pattern เดียวกับ P1.5's OAuth popup UI)
- 🟡 validate input/output ทุก channel ด้วย schema — มี extension point (`CHANNEL_SCHEMAS`) และลงทะเบียนแล้วเฉพาะกลุ่มเสี่ยงสูง (terminal + git-mutate + destructive collection-delete: `delete-item`, `delete-environment`, `delete-dotenv-file`, `delete-transient-requests`, `remove-collection`, `delete-cookies-for-domain`, `delete-cookie` + rename/move/save/import-export collection: `rename-collection`, `save-file`, `rename-environment`, `rename-item-name`, `rename-item-filename`, `move-item`, `move-item-cross-format`, `move-file-item`, `move-folder-item`, `clone-folder`, `import-collection`, `export-collection-zip`, `import-collection-zip` + save-* file-overwrite siblings: `save-folder-root`, `save-collection-root`, `save-request`, `save-dotenv-variables`, `save-dotenv-raw`, `save-api-spec`, `save-global-environment`, `save-workspace-dotenv-variables`, `save-workspace-dotenv-raw`, `save-openapi-spec`, `save-preferences`, `save-collection-security-config`, `save-transient-request`, `save-multiple-requests`, `save-environment`, `save-scratch-request`, `save-workspace-docs` + workspace-level mutation/destructive: `create-workspace`, `rename-workspace`, `close-workspace`, `export-workspace`, `import-workspace`, `delete-workspace-environment`, `import-workspace-environment`, `update-workspace-environment`, `rename-workspace-environment`, `copy-workspace-environment`, `add-collection-to-workspace`, `remove-collection-from-workspace` + remaining environments-capability mutation channels: `create-global-environment`, `rename-global-environment`, `delete-global-environment`, `select-global-environment`, `update-global-environment-color`, `create-workspace-dotenv-file`, `delete-workspace-dotenv-file` + network capability file-overwrite channel: `save-response-to-file`) ยังไม่ครบทั้ง ~203 handler — ตั้งใจทำทีละกลุ่มความเสี่ยงสูง verify signature จริงก่อน ไม่ทำทีเดียวทั้งหมด (ดูเหตุผลใน comment บนสุดของ `channel-policy.js`) — capability-by-capability survey ครบทั้ง 13 capability แล้ว (`collections`, `workspace`, `environments`, `git`, `filesystem`, `preferences`, `system`, `notifications`, `apispec`, `terminal`, `network`, `ai`, `ui`); `filesystem`/`system`/`notifications`/`ui` สำรวจแล้วจงใจไม่เพิ่ม schema เพราะไม่มี channel เข้าเกณฑ์ outsized-consequences
- ✅ จำกัด payload เป็นราย channel แทน global `100mb` (ราย capability, global ลดจาก 100mb → 25mb)
- ✅ เพิ่ม rate limit, concurrency limit และ execution timeout (เปิดเป็นค่าเริ่มต้น)

**Acceptance criteria:** unknown channel เป็น `404` ✅, known-but-forbidden เป็น `403` ✅, invalid payload เป็น `400` ✅ (บางส่วน — ตาม schema ที่ลงทะเบียนแล้ว) และ privileged channels ใช้งานไม่ได้จนกว่าจะ grant capability 🟡 (ปิดตามค่าเริ่มต้นแล้ว แต่ยังไม่มี grant-flow UX แยก)

### P0.3 Filesystem Sandbox 🟡 เสร็จบางส่วน (coarse safety net, opt-in)

**เป้าหมาย:** Browser เข้าถึงได้เฉพาะ roots ที่ผู้ใช้อนุญาต

- ✅ เพิ่ม `allowedRoots` configuration (`BRUNO_SERVER_ALLOWED_ROOTS`, opt-in — ปิดเป็นค่าเริ่มต้น)
- ✅ resolve path ด้วย `realpath` ก่อน authorize
- ✅ ป้องกัน `..`, symlink escape — มี unit test ครอบทั้งคู่; 🟡 UNC/drive-relative path บน Windows ตอนนี้ถูก scanner จับเป็น candidate แล้ว (แก้ `ABSOLUTE_PATH_RE` ให้ครอบ `C:foo` แบบ drive-relative ที่เดิมหลุด scan ไปเลย นอกเหนือจาก `C:\foo`/`C:/foo`/UNC `\\server\share` ที่ครอบอยู่แล้ว) มี unit test ระดับ string-matching ครบ; case-insensitive bypass พึ่งพา `fs.realpathSync` ให้ normalize casing ทั้งสองฝั่งก่อนเทียบ (มี comment อธิบาย mechanism ไว้ใน `isUnderRoot()`) แต่ยังไม่เคยรันยืนยันจริงบน Windows host เพราะไม่มี Windows box ใน environment นี้
- ✅ แยก read/write permission ต่อ root — root ต่อท้ายด้วย `:ro` (เช่น `BRUNO_SERVER_ALLOWED_ROOTS=/rw-root,/reference-root:ro`) ถูก enforce เป็น read-only; fail-safe ต่อ channel ที่ยังไม่ตรวจสอบ (มี allowlist มือ 8 channel ที่ยืนยันว่าอ่านอย่างเดียวจาก `filesystem.js`, channel อื่นถือเป็น write แล้วบล็อกกับ root ที่เป็น ro ไปก่อน) — error code แยก `PATH_READ_ONLY_ROOT`
- ✅ ให้ผู้ใช้ revoke root ได้ — runtime admin API (`GET`/`DELETE /api/admin/allowed-roots`), mount หลัง `requireAuth` เหมือน `/api/ipc`; revoke-only (narrow เท่านั้น ไม่มี un-revoke/add), เก็บ state ใน memory ที่ reset กลับเป็นค่า env var ตอน restart; log ผ่าน `logRootRevoked`
- ✅ บันทึก audit event โดยไม่ log secret/file content — `security/audit-log.js` log เฉพาะ channel/denied-path/session/requestId ตอน sandbox ปฏิเสธ (403) ไม่แตะ argument หรือ file content
- ✅ upload ตรวจ size, extension, magic bytes และ filename normalization — `routes/uploads.js` (P1.1 Transfer Center's upload flow มีจริงแล้ว ปลดบล็อกข้อนี้): size ผ่าน `multer`'s `limits.fileSize` (`BRUNO_SERVER_UPLOAD_MAX_MB`) อยู่แล้วเดิม; extension ผ่าน `fileFilter` ที่รับเฉพาะ `.zip` (case-insensitive) เพราะ caller จริงทุกตัว (`uploadZipFile()`) อัพโหลดแต่ zip เท่านั้น — Content-Type ไม่ใช้เช็คเพราะ client กำหนดเองได้ไม่น่าเชื่อถือ; magic bytes ผ่านการอ่าน 4 byte แรกของไฟล์ที่เขียนลง disk แล้วเทียบกับ ZIP signature จริงทั้ง 3 แบบ (`PK\x03\x04`/`PK\x05\x06`/`PK\x07\x08`) ก่อนปล่อยให้ handler ปลายทาง (AdmZip ผ่าน `renderer:is-bruno-collection-zip`) เปิดไฟล์ — จับได้ทั้ง extension ปลอมและไฟล์เสีย/truncate; filename normalization ได้จากดีไซน์เดิมอยู่แล้ว (ชื่อไฟล์บน disk เป็น random UUID เสมอ ไม่เคยใช้ชื่อจาก client เลยนอกจาก extension ที่ whitelist)

**ข้อจำกัดสำคัญ**: ตัว scanner เป็น generic เดาจาก "string ที่หน้าตาเหมือน absolute path" ไม่รู้ semantic รายช่อง — เป็น **safety net เสริม ไม่ใช่ per-channel validation ที่สมบูรณ์** (มีแค่ 5/~85+ handler ที่รับ path ที่เคย validate เองมาก่อนหน้านี้) มี extension point (`CHANNEL_PATH_EXTRACTORS`) ให้เพิ่มความแม่นยำทีละ channel ได้ในอนาคต

**Acceptance criteria:** ทุก filesystem handler ผ่าน policy layer เดียว 🟡 (ผ่าน chokepoint เดียวจริง แต่เป็น generic scan ไม่ใช่ per-channel) และ test traversal/symlink/Windows path edge cases ครบ 🟡 (traversal+symlink มี live test จริงบน Linux, Windows path-shape detection มี unit test ระดับ string-matching แล้ว แต่ยังไม่มี live test บน Windows host จริง)

### P0.4 Per-Session Isolation ✅ เสร็จแล้ว (ทำงานเมื่อเปิด P0.1 auth เท่านั้น — ไม่เปิด auth = session เดียว ไม่มีอะไรให้ isolate)

**เป้าหมาย:** หลาย Browser tabs/users ไม่เห็น event, active workspace, terminal หรือ secret ของกันและกัน

- ✅ สร้าง `SessionContext` ต่อ authenticated client (`AsyncLocalStorage`-based, ทั้ง `bruno-server` และ `bruno-requests`)
- ✅ map HTTP request และ WebSocket connection ด้วย session ID เดียวกัน
- ✅ route `webContents.send()` ไปยัง session owner แทน global broadcast
- ✅ isolate terminal processes, cancel tokens (WS/gRPC connection ownership), active environment (legacy global-env uid) และ temporary collections/mount state, cookie jar
- ✅ reference-count shared filesystem watchers และ cleanup เมื่อ session ปิด
- ✅ จำกัดจำนวน sessions/terminals/watchers ต่อ session (ผ่าน `resource-limits.js`, ปรับได้ผ่าน env var — "ต่อ user" ปรับเป็น "ต่อ session" เพราะสถาปัตยกรรมนี้ไม่มี user จริง มีแต่ anonymous session)

**ตัดสินใจแล้ว — onboarding singleton คงพฤติกรรมเดิม ไม่ใช่ gap**: onboarding flow (`hasLaunchedBefore` flag) เป็น shared singleton ระดับ server process โดยตั้งใจ ไม่ผูก session — ผู้ใช้ยืนยันแล้วว่าตรงกับโมเดล "Bridge เดียวใช้ร่วมกันหลายคน" ของ P0.4 (นับครั้งแรกที่ server process รันทั้งหมด ไม่ใช่ต่อ browser tab/session) จึงไม่ต้องแก้ไขเพิ่ม

**Acceptance criteria:** integration test สอง browser contexts ต้องไม่รับ event หรือ state ของอีก context ✅ (unit + live E2E ยืนยันแล้วสำหรับ cookie, WS/gRPC connection, terminal, watcher — active-state 4 จุดสุดท้ายยืนยันด้วย unit test + code review ไม่มี live E2E เพิ่ม)

### P0.5 Typed RPC Contract Instead of Raw IPC Proxy 🟡 เสร็จบางส่วน

**เป้าหมาย:** ป้องกัน channel drift และลด runtime-only bugs

สร้าง package เช่น `packages/bruno-rpc-contract` ที่ประกอบด้วย: (✅ package นี้สร้างแล้วจริง — `@usebruno/rpc-contract`)

- ✅ channel names แบบ typed constants (`CHANNELS`/`ALL_CHANNELS`, generate จาก 229 channel จริง)
- ✅ request schemas — ย้าย `CHANNEL_SCHEMAS`/`validateArgs` (เดิมอยู่ที่ `bruno-server/src/security/channel-policy.js`) มาเป็น canonical `REQUEST_SCHEMAS`/`validateRequestArgs` ที่ `packages/bruno-rpc-contract/src/request-schemas.js` แล้ว — `channel-policy.js` เหลือแค่ thin re-export (pattern เดียวกับ `channel-capabilities.js`), byte-for-byte behavior-preserving (286 test เดิมใน `channel-policy.spec.js` ผ่านหมดโดยไม่แก้ assertion เลย) พร้อม test ใหม่ยืนยัน parity กับ live fixture (`request-schemas.spec.js`) ว่าทุก schema key เป็น channel จริงที่ registered — ครอบ 66 channel จาก ~203 channel ทั้งหมด (เกณฑ์ "outsized consequences" เดิม ไม่เปลี่ยน)
- ✅ response shapes (docs-only, ตามการตัดสินใจของผู้ใช้ — ไม่ทำ runtime enforcement) — `packages/bruno-rpc-contract/src/response-schemas.js`'s `RESPONSE_SHAPES` บันทึก return shape จริงของ handler ไว้เป็น human-readable string ต่อ channel, **ไม่มี validation function ใดๆ ผูกเข้า runtime**: ต่างจาก request schema ตรงที่ response ที่ handler คืนมาถูกต้องโดยนิยามอยู่แล้ว (เป็น source of truth) การเดา shape ผิดแล้วบังคับ enforce จะ reject legitimate response แทนที่จะจับบั๊กจริง จึงเลือกทำเป็น drift-documentation reference เท่านั้น — สโคปรอบนี้ครอบ 66 channel เดียวกับที่ request schema ครอบ (เพราะ handler body ถูกอ่านละเอียดอยู่แล้วจากงานนั้น) พร้อม parity test (`response-schemas.spec.js`) ยืนยันว่าทุก key เป็น channel จริงที่ registered — ที่เหลือ (~137 channel) ยังไม่ทำ เป็นส่วนขยายในอนาคตได้ผ่านการเพิ่ม entry ทีละกลุ่ม เหมือน pattern ที่ใช้กับ request schema
- ✅ event schemas (docs-only, ตาม pattern เดียวกับ response shapes ข้างบน — ไม่ทำ runtime enforcement) — `packages/bruno-rpc-contract/src/event-schemas.js`'s `EVENT_SHAPES` บันทึก shape ของ one-way server→renderer event (ผ่าน `webContents.send()`/`EventBridge.broadcast()`/`sendToSession()`, คนละครึ่งของ IPC surface จาก request/response) เป็น human-readable string ต่อ event name — ครอบ **79 event name/pattern จริง** ที่เจอจากการ grep ทุก `.send()`-style call site ทั่ว bruno-electron และ bruno-requests (ไม่มี central registration API แบบ `ipcMain.handle` ให้ dump อัตโนมัติเหมือน request/response เลยไม่มี parity fixture รอบนี้ — เป็น future work ที่บันทึกไว้ใน comment ของไฟล์); มี test (`event-schemas.spec.js`) ยืนยันว่าทุก entry เป็น non-empty string; เจอ 2 listener ฝั่ง client (`main:process-env-update`, `main:workspace-dotenv-update`) ที่ไม่มี emitter จริงเลยในโค้ด บันทึกไว้เป็น comment ว่าเป็น vestigial ไม่รวมเป็น entry (ไม่ใช่ของที่ลืม)
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

**Acceptance criteria:** CI fail เมื่อ Desktop handler, Browser route หรือ renderer caller ไม่ตรง contract และไม่มี string channel ที่สำคัญกระจายโดยไม่มี type checking — ✅ มี audit script รันได้จริงและ live-verify แล้วว่า detect drift ถูกต้อง (`npm run audit:parity`, มี `--write` heal) และตอนนี้ผูกเข้า CI แล้ว (`.github/workflows/ci.yml`'s `rpc-contract-parity` job รันทุก push/PR ไป `main`)

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

เพิ่ม static parity audit ที่เปรียบเทียบ Electron handlers กับ RPC contract ทุก PR — ✅ script มีแล้ว (`scripts/audit-parity.js`, ดู P0.5) และตอนนี้รันทุก push/PR ผ่าน `.github/workflows/ci.yml` แล้ว

### P0.7 CI Pipeline 🟡 เสร็จบางส่วน (พื้นฐาน + browser-bridge e2e เสร็จแล้ว)

**เป้าหมาย:** ปิดช่องว่างที่หลาย item ข้างบน (P0.5, P0.6) ค้างอยู่ที่ 🟡 เพราะไม่มี CI pipeline ให้ผูก gate เข้าไป (repo มีแค่ `.github/dependabot.yml` ไม่มี `.github/workflows` มาก่อน)

- ✅ สร้าง `.github/workflows/ci.yml` — รันทุก push เข้า `main` และทุก pull request, สามงาน (parallel jobs):
  - `lint` — `npm run lint` ทั้ง repo, blocking; ตอนสร้าง workflow นี้ครั้งแรกพบ lint error ค้างอยู่ 54 จุด (ทั้งหมด auto-fixable, กระจายในไฟล์ที่ไม่เกี่ยวกับ CI เลย) — รัน `npm run lint:fix` แก้หมดแล้ว (quote style, indent, blank-line เท่านั้น ไม่แตะ logic เลย, test suite ที่เกี่ยวข้องรันผ่านหมดหลังแก้) ก่อนเปิด job เป็น blocking
  - `test` — `npm test --workspaces --if-present` รัน jest ของทุก workspace ที่มี `test` script (ข้าม workspace ที่ไม่มี เช่น `bruno-docs`, `bruno-schema-types`) — live-verified แล้วว่าผ่านทั้งหมดก่อน commit (เช่น `bruno-server` 286/286, `bruno-rpc-contract` 19/19)
  - `rpc-contract-parity` — `npm run audit:parity --workspace=packages/bruno-rpc-contract` (ดู P0.5) — live-verified ผ่านก่อน commit
- ✅ Playwright e2e/`browser-bridge` suite (P0.6) ใน CI — เพิ่ม job `browser-bridge-e2e` (`npx playwright install --with-deps chromium` แล้ว `npm run test:e2e:browser-bridge`) พร้อม `upload-artifact` สำหรับ `playwright-report/` เมื่อ fail — live-verify ก่อนผูกเข้าเจอ 1 fail ปลอมจาก unrelated process (แอปอื่น "Open WebUI") squat port 3000 ของเครื่อง dev เอง ไม่ใช่บั๊ก Bruno; แยก isolate ยืนยันด้วย port อื่นแล้ว boot flow จริงผ่าน 1/1 — CI runner สะอาดเสมอไม่มีปัญหานี้
- ยังไม่ทำ — SBOM, dependency scanning, signed artifacts (P1.3): ตอนนี้มี CI ให้ผูกแล้ว แต่ยังต้องเลือก tool/signing-key policy ก่อน เป็น decision แยก
- ยังไม่ทำ — matrix ข้าม platform (Windows/macOS/Linux) หรือ Node version (P0.6's minimum test matrix): รันแค่ `ubuntu-latest` ตอนนี้
- ไม่แก้ diff-only lint mode — `eslint-plugin-diff` registered เป็น plugin ใน `eslint.config.js` อยู่แล้วแต่ยังไม่ได้ wire เข้า rule ใดๆ จริง (dead registration) ไม่ใช่ blocker อีกต่อไปเพราะ debt เดิมแก้หมดแล้ว แต่ยังเป็นโอกาสปรับปรุงในอนาคตถ้าอยากให้ PR ใหญ่ ๆ ไม่ต้องพะวงกับ lint error ของโค้ดที่ตัวเองไม่ได้แตะ

---

## P1 — ทำให้ Browser ใช้งานจริงได้ดี (1–3 เดือน)

### P1.1 Server File Explorer and Transfer Center 🟡 เสร็จบางส่วน (folder-picking modal + upload/download + progress/cancel + create-folder/rename + file-picker multi-select/preview + search/recent/favorites + Bridge-machine label + checksum verification + opaque file handle API (backend) จริงแล้ว; resume ยังไม่ทำ, opaque handle ฝั่ง frontend ยังไม่ทำ)

แทน `window.prompt()` ด้วย modal ที่มี:

- ✅ browse ผ่าน modal จริง (point-and-click navigation) แทน `window.prompt()` — สำหรับ 3 ช่องทางที่เลือก path เป็น "โฟลเดอร์" (`renderer:browse-directory`, `renderer:open-collection`, `renderer:open-workspace-dialog`); backend เพิ่ม `renderer:list-directory` (read-only, อยู่ใน `READ_ONLY_SAFE_CHANNELS`) ที่ `bruno-electron/src/ipc/filesystem.js` คืน `{ path, parentPath, entries }`; frontend เป็น provider ใหม่ `providers/BrowseFolder` (mirror pattern เดียวกับ `PromptVariablesProvider`) + `components/BrowseFolderModal` ที่รองรับทั้ง single-select (browse-directory, open-workspace-dialog) และ multi-select ด้วย checkbox (open-collection คงความสามารถเลือกหลาย path พร้อมกันแบบเดิมไว้); ทดสอบผ่าน Playwright จริงบน built app ที่ serve ผ่าน bruno-server (navigate เข้า/ออกโฟลเดอร์, multi-select, cancel — ทำงานถูกต้องทุกจุด)
- ⚠️ "browse เฉพาะ allowed roots" — ยังไม่ enforce ที่ตัว modal เอง (ถ้า `BRUNO_SERVER_ALLOWED_ROOTS` ตั้งไว้ sandbox ฝั่ง server จะ block การเรียกอยู่ดีผ่าน `findPathPolicyViolation`, แต่ modal ไม่ได้กรอง UI ให้ navigate ออกนอก root ไม่ได้ตั้งแต่แรก — UX gap ไม่ใช่ security gap)
- ✅ **upload จาก client ไป Bridge และ download จาก Bridge ไป client** — แทนที่ `window.prompt()`-based path entry ของ `export-collection-zip`, `export-workspace`, `save-response-to-file`, และเปิด zip-import จริงจาก browser file input (`import-collection-zip`/`import-workspace`)
  - Backend: route ใหม่ 2 เส้นทาง แยกจาก `/api/ipc/:channel` (JSON-only) เพราะต้องรับ/ส่งไฟล์ไบนารีจริง — `POST /api/uploads/scratch-file` (multipart ผ่าน `multer.diskStorage`, ตั้งชื่อไฟล์บน disk เป็น `crypto.randomUUID()` เสมอ ไม่เชื่อชื่อไฟล์จาก client ยกเว้น extension ที่ผ่าน allowlist regex `/^\.[a-z0-9]{1,8}$/`) และ `POST /api/downloads/:channel` (รับ JSON args, สตรีมไฟล์กลับผ่าน `res.download()`) — ทั้งสอง route reuse security primitive ชุดเดียวกับ `ipc-proxy.js` ทุกตัว (`validateArgs`, `findPathPolicyViolation`, rate-limit/concurrency, `withTimeout`, `requireAuth`); `downloads.js` จำกัดเฉพาะ `DOWNLOADABLE_CHANNELS` allowlist (`export-collection-zip`, `export-workspace`) ไม่ผ่าน generic dispatch เหมือน `/api/ipc` เพื่อคุม argument shape ที่ตรวจสอบมาแล้วเท่านั้น; scratch dir ร่วม (`os.tmpdir()/bruno-bridge-transfers`) มี sweep อัตโนมัติทุก 10 นาทีสำหรับ upload และลบทันทีหลัง stream เสร็จสำหรับ download; CORS เพิ่ม `exposedHeaders: ['Content-Disposition']` ให้ `fetch()` อ่านชื่อไฟล์ cross-origin ได้
  - Frontend: `ipc-transport.js`'s `BrowserTransport` เพิ่ม `_downloadViaBridge()` (fetch ไป `/api/downloads/:channel`, อ่าน `Content-Disposition`, trigger Blob download ผ่าน `<a download>` element), `_saveResponseToFileLocally()` (decode `response.dataBuffer` base64 ที่มีอยู่ใน browser memory แล้ว trigger Blob download ฝั่ง client ล้วนๆ ไม่ต้อง round-trip ไป server เลย), และ `uploadZipFile()` (POST `FormData` ไป `/api/uploads/scratch-file` คืน scratch path จริง); `ElectronTransport.uploadZipFile()` เป็น no-op ที่คืน `getFilePath()` เดิมเพราะ desktop มี local path จริงอยู่แล้ว; `FileTab.js`/`ImportWorkspace/index.js` เปลี่ยนจาก `getFilePath()` เป็น `await transport.uploadZipFile()`
  - Test coverage ใหม่: `uploads-downloads.spec.js` (9 tests: upload success/no-file/oversized/auth-required, download success-with-Content-Disposition/non-allowlisted-channel/path-outside-allowed-roots/malformed-args/auth-required)
  - **Live-verified ด้วย Playwright จริง** บน production build ที่ serve ผ่าน bruno-server: เปิด collection จริง → Share modal → ZIP → Proceed → `POST /api/downloads/renderer:export-collection-zip` คืน 200 พร้อม `Content-Disposition: Test.zip`, ได้ไฟล์ zip จริง 677 bytes ผ่าน browser download event จริง (ไม่ใช่ `window.prompt()` แล้ว) → feed zip ไฟล์นั้นเข้า Import Collection modal's file input → `POST /api/uploads/scratch-file` คืน 200 พร้อม scratch path จริง → `renderer:is-bruno-collection-zip` ผ่าน → import wizard advance ไปหน้า location step สำเร็จ (พิสูจน์ round-trip upload→validate→handleSubmit ทำงานถูกต้องครบวงจร)
  - **บั๊กที่พบระหว่าง live verification (ไม่เกี่ยวกับ upload/download โดยตรง แต่บล็อกการ verify) — แก้แล้ว**: WebSocket reconnect ใน `BrowserTransport._connectWebSocket()`'s `onopen` ส่ง resubscribe เป็น 1 message ต่อ 1 channel (`for (const channel of this._listeners.keys())`) — ตอนนี้ app มี distinct event channel รวม 63 ตัว ทำให้ทุกครั้งที่ reconnect ชน `event-bridge.js`'s `MESSAGE_RATE_LIMIT = 50` messages/10s ทันที โดน `ws.close(1008)` ทันที และเพราะ `_reconnectAttempts` ถูก reset เป็น 0 ใน `onopen` (ก่อนรู้ว่า connection stable จริง) exponential backoff ไม่เคยโตขึ้นเลย กลายเป็น infinite reconnect loop รอบละ ~1-2 วินาที ค้างที่ "Offline" ตลอดไป — เป็น regression ที่บล็อก **การใช้งาน Browser mode ทั้งหมด** ไม่ใช่แค่ฟีเจอร์นี้ แก้โดย batch resubscribe เป็น 1 message เดียว (`{ type: 'subscribe-batch', channels: [...] }`) แทน N messages, เพิ่ม handler คู่ `subscribe-batch`/`unsubscribe-batch` ฝั่ง `event-bridge.js` (มี cap `MAX_BATCH_CHANNELS = 500` กันละเมิด) — เพิ่ม 5 tests ใหม่ใน `event-bridge.spec.js` ยืนยันว่า batch นับเป็น 1 message ต่อ rate limit จริง
- ✅ **progress + cancel สำหรับ upload/download** — `uploadZipFile()` เขียนใหม่เป็น XHR-based (`upload.onprogress`) แทน `fetch()` เดิมที่รายงาน progress ไม่ได้, เพิ่ม `downloadWithProgress()` ใหม่ (streamed `fetch()` + `response.body.getReader()` คำนวณ % จาก `Content-Length`) ให้ export ก็มี progress bar เหมือนกัน ทั้งสองทางผูกกับ `AbortController`/`AbortSignal` เดียวกันเพื่อให้ cancel กลางทางได้จริง (`TransferCancelledError` แยก error ประเภทนี้ออกจาก error จริงเพื่อไม่ toast ผิด); UI: progress bar + ปุ่ม cancel ใน `FileTab.js` (`zip-upload-progress`/`zip-upload-cancel-btn`) และ `ShareCollection/index.js` (`export-progress`/`export-cancel-btn`); ปิดจบ redundant WS-reconnect flush ที่เหลือด้วย (`_wsQueue` ไม่ต้อง flush แยกอีกเพราะ `_listeners`-based resubscribe-batch ครอบคลุมอยู่แล้ว)
  - **บั๊กจริงที่พบระหว่าง live verification — แก้แล้ว**: `ImportCollection/index.js`'s `if (isLoading) return <FullscreenLoader />;` unmount `FileTab`ทั้ง component (รวม progress bar/cancel ที่เพิ่งสร้าง) ทันทีที่ `isLoading === true` — แต่ `processZipFile()` เดิมเรียก `setIsLoading(true)` เป็นบรรทัดแรกสุดตั้งแต่ก่อนเริ่ม upload ทำให้ progress UI ไม่มีทางถูกมองเห็นเลยตลอดการ upload แม้ progress state ข้างใต้จะอัปเดตถูกต้องก็ตาม — unit test 23/23 ผ่านหมดไม่จับบั๊กนี้ได้เพราะทดสอบ `ipc-transport.js` แยกส่วน ไม่เคย render parent-child จริง เจอเฉพาะตอน live-verify ผ่าน Playwright จริงบน production build เท่านั้น — fix: ย้าย `setIsLoading(true)` ไปเรียกหลัง upload เสร็จ (ก่อน `renderer:is-bruno-collection-zip` validate ซึ่งเหมาะกับ fullscreen loader อยู่แล้วเพราะไม่มี cancel affordance) — verify ซ้ำหลัง rebuild: progress bar โผล่ทันที, % ขยับจริงระหว่าง throttled upload, cancel ทำงานสะอาดไม่มี error toast, full upload ที่ไม่ throttle จบครบถึงหน้า location step ปกติ
- ✅ **create folder, rename และ conflict resolution ใน `BrowseFolderModal`** — backend เพิ่ม 2 channels ใหม่ใน `bruno-electron/src/ipc/filesystem.js`: `renderer:create-directory(parentPath, name)` และ `renderer:rename-directory(oldPath, newName)` — ทั้งคู่ reuse ของเดิมทั้งหมด ไม่เขียน validation ใหม่ (`createDirectory`/`validateName`/`safeToRename` จาก `utils/filesystem.js` ตัวเดียวกับที่ `renderer:rename-item-filename` ใช้อยู่แล้ว) จึงได้ conflict guard, name validation (reject path separator/control char/reserved Windows name/length>255) และ case-only-rename-on-case-insensitive-fs handling มาฟรี; ทั้งสอง channel ผ่าน `HandlerRegistry` auto-discovery และ existing `allowed-roots`/rate-limit infra โดยไม่ต้องแก้ security layer เพิ่ม เพราะ argument ที่เป็น path คือ parent/target directory ที่ validate อยู่แล้ว ส่วน leaf name ผ่าน `validateName()` ที่ structurally กัน path traversal ไม่ให้สมุกเข้ามาได้; เพิ่ม `REQUEST_SCHEMAS` entry ใน `bruno-rpc-contract` และ regenerate fixture ผ่าน `audit:parity -- --write`
  - Frontend: `BrowseFolderModal/index.js` เพิ่มปุ่ม "New folder" ที่แถบ path บนสุด (เปิด inline form พร้อม auto-focus), และปุ่ม rename แบบ hover-reveal ต่อแถว (เปิด inline form แทนที่ชื่อโฟลเดอร์ในแถวเดิม) — ทั้งสอง form ยืนยันด้วย Enter/ปุ่ม check, ยกเลิกด้วย Escape/ปุ่ม X, แสดง error inline ใต้ input โดยไม่รบกวน error banner ของ directory-listing เดิม; error message เช็คด้วย substring `"already exists"` (ตาม convention เดิมของ `renderer:rename-item-filename`) เพราะ Browser Bridge's `ipc-proxy.js` ส่งกลับแค่ `err.message` เป็น string ไม่ใช่ custom `.code` property
  - Test coverage ใหม่: `filesystem.spec.js` (backend, 8 tests: create/rename success, conflict, invalid name, non-directory parent/non-existent source) และ `BrowseFolderModal/index.spec.js` (frontend, 8 tests: initial listing, create success/conflict/escape-cancel, rename success/conflict/escape-cancel/no-op-when-unchanged)
  - **Live-verified ด้วย Playwright จริง** บน production build ที่ serve ผ่าน bruno-server (206 handlers registered, ขึ้นจาก 204): เปิด Create Collection modal → คลิก Browse → สร้างโฟลเดอร์ใหม่สำเร็จ (ปรากฏใน listing ทันที) → สร้างซ้ำชื่อเดิมได้ error inline "... already exists" ถูกต้อง พร้อม cancel กลับสำเร็จ → hover แถวเพื่อ rename สำเร็จ (ชื่อเก่าหายชื่อใหม่ปรากฏ) → rename ชนชื่อที่มีอยู่แล้วได้ error inline ถูกต้อง → Escape ยกเลิก rename form สำเร็จ ไม่พบบั๊กใหม่ระหว่าง live verification รอบนี้
- ✅ **multi-select พร้อม preview สำหรับไฟล์** (`renderer:browse-files` เลิกใช้ `window.prompt()`) — `BrowseFolderModal` generalize เป็น dual-mode component ผ่าน prop ใหม่ `mode` (`'folders'` default | `'files'`) โดย default คง backward-compatible 100% (8 test เดิมผ่านไม่ต้องแก้); backend: `renderer:list-directory` เพิ่ม `size`/`mtimeMs` ต่อไฟล์ผ่าน `fs.stat()` (try/catch ต่อ entry กัน broken symlink ไม่ให้บัง entry ทั้งแถว) — ไม่มี IPC channel ใหม่ ไม่มี security-surface เพิ่ม; frontend: `matchesFilters(entry, filters)` helper รองรับ Electron-style filters shape (`[{ name, extensions }]`) ใช้ร่วมกันได้ทั้ง client-side (Browser Bridge) และเป็นรูปแบบเดียวกับที่ native `dialog.showOpenDialog` ใช้อยู่แล้วฝั่ง Electron; แถวไฟล์เพิ่ม checkbox/radio (ตาม `multiple` prop) + preview panel ท้าย listing แสดง name/size/mtime ของไฟล์ที่เลือกอยู่; provider: `providers/BrowseFolder` เพิ่ม `browseFiles()`/`window.browseFilesOnBridge` (mirror `browseFolder`/`window.browseFolderOnBridge` เดิม), `ipc-transport.js`'s `renderer:browse-files` ใช้ bridge นี้ก่อน โดยยังคง `window.prompt()` fallback ไว้กรณี provider ยังไม่ mount (เช่น เรียกนอก React tree)
  - Test coverage ใหม่: `filesystem.spec.js` (backend, +2 tests: size/mtimeMs ต่อไฟล์, reject non-directory) และ `BrowseFolderModal/index.spec.js` (frontend, +6 tests: folders-mode ซ่อนไฟล์เหมือนเดิม, files+folders ปนกันในกล่องเดียว, extension filter, single-select+preview, submit-on-confirm, multi-select) — รวม 14/14 ผ่านทั้งไฟล์
  - **Live-verified ด้วย Playwright จริง** บน production build ที่ serve ผ่าน bruno-server (206 handlers, ไม่มี channel ใหม่): สร้าง collection → New Request → Body tab → Multipart Form → เพิ่มแถว → คลิกไอคอน upload เปิด `BrowseFolderModal` ใน file mode ถูก title "Select File(s)" → ไฟล์จริงใน `$HOME` ปรากฏใน listing พร้อม size/date → เลือกไฟล์ ปุ่ม Select เปิดใช้งาน preview panel แสดง name/size/mtime ถูกต้อง → ยืนยันแล้วไฟล์ผูกเข้าแถว multipart จริง (ยืนยันผ่าน `MultipartFileChipsCell`'s collapsed-summary chip title `"1 file"` — คอลัมน์แคบเลย collapse เป็น summary แทนชื่อไฟล์ตรงๆ ตาม responsive behavior เดิมของ component นี้ที่มีอยู่ก่อนแล้ว ไม่ใช่บั๊กใหม่)
  - **บั๊ก script/test เจอระหว่าง live verification (ไม่ใช่บั๊ก product code) — แก้ในสคริปต์**: (1) modal-backdrop ของ CreateCollection ที่เพิ่งปิดยังค้าง intercept pointer event กับ modal ถัดไปช่วง transition เร็วๆ — แก้ด้วยการรอ `.bruno-modal-backdrop` หายจริง (`state: 'detached'`) แทน fixed timeout; (2) script เดิม trigger "Create Collection" ผ่านปุ่มใน Quick Actions ของหน้า Overview ซึ่งหายไปถ้ามี request tab ค้างอยู่จาก session ก่อนหน้า (state ฝั่ง server persist ข้าม page reload) — เปลี่ยนไปใช้ sidebar header's persistent "+" menu (`collections-header-add-menu`) แทนซึ่งอยู่ทุกหน้าเสมอ
- ✅ **search + recent paths + favorites ใน `BrowseFolderModal`** — backend เพิ่มคลาสใหม่ `store/recent-browse-paths.js` (`RecentBrowsePaths`) เก็บ list แยกเป็น recent (cap 10 รายการ, dedup+move-to-front เมื่อ add ซ้ำ) และ favorites (toggle in/out) โดยใช้ top-level key `browsePaths.*` แยกจาก `preferences` (กัน `PreferencesStore.savePreferences()`'s full-overwrite เขียนทับข้อมูลนี้ทิ้ง — pattern เดียวกับ `LastOpenedWorkspaces`'s `workspaces.*`) และ session-scope ผ่าน `getCurrentSessionKey()` เหมือนกัน (`undefined` = flat list สำหรับ Electron/no-auth, มี key จริง = list แยกต่อ session สำหรับ Browser Bridge หลาย client พร้อมกัน); เพิ่ม 3 IPC channels ใหม่ใน `ipc/filesystem.js` (`renderer:get-browse-paths`, `renderer:add-recent-browse-path`, `renderer:toggle-favorite-browse-path`) — ไม่ต้องแก้ handler-registration ใดๆ เพิ่มเพราะ module นี้ registered อยู่แล้ว, ไม่เพิ่ม `REQUEST_SCHEMAS` entry ใน `bruno-rpc-contract` ตาม policy เดิม (channel เขียน string ธรรมดาเข้า store ความเสี่ยงต่ำ ไม่ใช่ destructive/privileged operation) แต่ regenerate `fixtures/real-channel-sources.json` ผ่าน `audit-parity.js --write` ให้ 3 channels ใหม่ map ไปที่ไฟล์ถูกต้อง
  - Frontend: `BrowseFolderModal/index.js` เพิ่ม search input ที่กรอง `entries` ปัจจุบันด้วย substring match บน `entry.name` (client-side, กรองเฉพาะโฟลเดอร์ที่ list อยู่แล้ว ไม่ทำ full filesystem search — ขอบเขตตั้งใจให้แคบ), ปุ่ม favorite-star ที่แถบ path บนสุด (toggle path ปัจจุบัน), และ quick-access dropdown แสดง Favorites/Recent แยก section คลิกแล้ว navigate ทันที; ทั้ง `setRecentPaths`/`setFavoritePaths` เช็ค `Array.isArray()` ก่อน apply ค่าใหม่ทับ state เดิมเสมอ (แก้ race condition จริงที่เจอ — ดูหัวข้อบั๊กด้านล่าง)
  - Test coverage ใหม่: `recent-browse-paths.spec.js` (backend store, 9 tests: empty state, add/dedup/cap-at-10, favorite toggle, independent lists, session-scoping), `filesystem.spec.js` (+2 tests สำหรับ 3 channels ใหม่), `BrowseFolderModal/index.spec.js` (+7 tests: search filter, no-match message, clear button, mount-time fetch+list ใน quick-access panel, navigate ผ่าน recent item, record recent หลัง navigate, toggle favorite+pressed state) — รวม 21/21 ผ่านทั้งไฟล์
  - **บั๊กจริงที่พบและแก้ระหว่างเขียน test (production code, ไม่ใช่แค่ script)**: `setRecentPaths`/`setFavoritePaths` เดิม apply response ของ `add-recent-browse-path`/`toggle-favorite-browse-path` ตรงๆ โดยไม่เช็คว่าเป็น array จริงก่อน — เพราะลำดับความสำเร็จของ 2 IPC call ต่อครั้ง navigate (mount-time `get-browse-paths` fetch กับ fire-and-forget `add-recent-browse-path`) ไม่การันตีลำดับ ทำให้ response ที่ falsy/undefined เขียนทับ state ที่ถูกต้องอยู่แล้วด้วย `[]` ได้ — แก้โดยเช็ค `Array.isArray(response)` ก่อน apply ทุกจุด
  - **Live-verified ด้วย Playwright จริง** บน production build ที่ serve ผ่าน bruno-server: เปิด Create Collection → Browse → search กรอง entries ถูกต้อง → navigate เข้า/ออกโฟลเดอร์ทดสอบ → toggle favorite ปุ่ม star (`aria-pressed` สลับถูกต้อง, ยืนยัน state persist ฝั่ง server ข้าม script run แยกกันด้วยการรัน 2 รอบเห็นทิศทางสลับตรงข้ามกัน) → เปิด quick-access panel เห็นทั้ง favorites/recent ถูกต้อง → คลิก recent item navigate กลับเข้าโฟลเดอร์เดิมสำเร็จ ไม่พบบั๊ก product code ใหม่ระหว่าง verify รอบนี้ (เจอแค่ script bug เดียว: Playwright strict-mode ชน 2 ปุ่ม "Cancel" ที่ค้างอยู่พร้อมกันจาก CreateCollection modal ที่ซ้อนกับ BrowseFolderModal — แก้ script เป็น `getByRole('button', { name: 'Cancel', exact: true }).last()`)
- ✅ **แสดงให้ชัดว่า path เป็นของ Bridge machine หรือเครื่องของผู้ใช้เอง** — สำรวจแล้วพบว่าใน Browser Bridge mode `BrowseFolderModal` ไม่มีทางเข้าถึง filesystem ของเครื่องที่รัน browser ได้เลย (`renderer:list-directory`/`renderer:browse-files` ทุกอันเดินผ่าน IPC ไป `bruno-server` เสมอ) แปลว่า path ที่ modal แสดงเป็น path ของเครื่อง Bridge server เท่านั้นเสมอ — ความเสี่ยงคือผู้ใช้อาจเข้าใจผิดคิดว่ากำลัง browse เครื่องตัวเอง (โดยเฉพาะ deployment ที่ Bridge อยู่คนละเครื่องกับ browser) จึงเพิ่ม badge เล็กๆ "BRIDGE SERVER" ที่แถบ path พร้อม tooltip (ผ่าน `components/ToolHint`, pattern เดียวกับ `ConnectionIndicator`) อธิบายว่า "This path is on the Bridge server's machine, not this browser's computer" — badge นี้ gate ด้วย `!isElectronMode()` (helper ที่มีอยู่แล้วใน `ipc-transport.js`) จึง**ไม่แสดงเลยใน Electron desktop mode** เพราะโหมดนั้นไม่มีความกำกวมอยู่แล้ว (เครื่องเดียวกันเป๊ะ ไม่มี "Bridge" แยกจาก UI) — ไม่มีการเพิ่ม IPC channel/endpoint ใหม่ใดๆ เลยในรอบนี้ (ตัดสินใจไม่ query hostname จริงของ Bridge server เพราะ `/api/runtime-config`/`/api/health` ทั้งคู่ไม่ผ่าน `requireAuth` — การเพิ่ม hostname เข้าไปจะเป็น info-disclosure ให้ unauthenticated request ได้ฟรี ซึ่งเกินความจำเป็นของ label ที่แค่ต้องการบอกว่า "ไม่ใช่เครื่องคุณ" ไม่ต้องรู้ชื่อเครื่องจริง) — เพิ่ม 2 test cases ใน `BrowseFolderModal/index.spec.js` (badge แสดงใน Browser mode, ซ่อนใน Electron mode) — Live-verified ด้วย Playwright จริงบน production build: badge "BRIDGE SERVER" ปรากฏถูกต้อง hover แล้วเห็น tooltip ข้อความถูกต้องครบ
- ✅ **checksum verification สำหรับ upload/download** — server คำนวณ SHA-256 ของไฟล์จริงหลัง multer เขียนลง scratch dir เสร็จ (`fs.createReadStream` + `crypto.createHash('sha256')`, ไม่ streaming-hash ระหว่างเขียนเพราะไฟล์ scratch พวกนี้เล็ก ไม่คุ้มความซับซ้อนเพิ่ม) แล้วส่งกลับเป็น `sha256` field ใน `POST /api/uploads/scratch-file`'s JSON response (คำนวณพลาด → unlink ไฟล์ทิ้งแล้วตอบ 500 กัน orphan file); `POST /api/downloads/:channel` คำนวณ SHA-256 ของ `tempPath` ก่อน `res.download()` แล้วตั้ง response header `X-Content-SHA256`; เพิ่ม `X-Content-SHA256` เข้า CORS `exposedHeaders` คู่กับ `Content-Disposition` เดิมให้ `fetch()` อ่านได้ cross-origin — frontend: `ipc-transport.js` เพิ่ม helper `sha256Hex(blob)` ตัวเดียวใช้ร่วมกันทั้ง 3 จุด (`Web Crypto`'s `crypto.subtle.digest('SHA-256', await blob.arrayBuffer())` แบบ one-shot ไม่ streaming เพราะทั้ง `File`/`Blob` โหลดเข้า memory เต็มอยู่แล้วก่อนเรียกจุดนี้เสมอ) และ error class ใหม่ `TransferIntegrityError` (mirror `TransferCancelledError`) — `uploadZipFile()`'s `xhr.onload` เทียบ client-side hash ของ `file` กับ `body.sha256` ก่อน resolve (reject ด้วย `TransferIntegrityError` ถ้าไม่ตรง, ไม่เปลี่ยน resolve shape เดิมที่เป็น string path เพื่อไม่กระทบ caller), `downloadWithProgress()`/`_downloadViaBridge()` เทียบ hash ของ `blob` ที่ประกอบเสร็จแล้วกับ header `X-Content-SHA256` ก่อน trigger `<a download>` (ถ้า server ไม่ส่ง header มา ข้ามการเช็คไปเงียบๆ เพื่อ backward-compat กับ response ใดๆ ที่ไม่มี header นี้)
  - Test coverage ใหม่: `uploads-downloads.spec.js` (+2 tests: sha256 field ตรงกับ bytes จริงบน disk, X-Content-SHA256 header ตรงกับ bytes ที่ stream ออกจริง), `ipc-transport.spec.js` (+4 tests: upload match/mismatch, download match/mismatch) — jsdom ไม่ implement ทั้ง `crypto.subtle` และ `Blob.prototype.arrayBuffer` (มีจริงในทุก browser จริงแต่ไม่มีใน jsdom) จึงเพิ่ม polyfill ทั้งสองใน `jest.setup.js` (ผ่าน Node's `require('crypto').webcrypto.subtle` และ `FileReader`-based `arrayBuffer()`) — ไม่กระทบ production code เลย เป็นแค่ test-environment gap
  - **Live-verified ด้วย Playwright จริง** (Chromium จริงมี `crypto.subtle`/`Blob.arrayBuffer` ครบ ไม่ใช่ jsdom) บน production build ที่ serve ผ่าน bruno-server: upload zip ผ่าน Import Collection modal's file input → ไม่มี error toast/console error → wizard advance ไปหน้า location step สำเร็จ (พิสูจน์ checksum ผ่าน) → export collection จริงผ่าน Share modal → toast "Collection exported successfully" ปรากฏ ไม่มี `TransferIntegrityError` หรือ console error ใดๆ; ยืนยัน byte-level ด้วย curl ตรงๆ อีกชั้น: `sha256sum` ของไฟล์ที่ upload ตรงกับ `sha256` field ที่ตอบกลับเป๊ะ, `sha256sum` ของไฟล์ที่ download ตรงกับ `X-Content-SHA256` header เป๊ะ
  - **บั๊ก tooling เจอระหว่าง live-verify (ไม่ใช่บั๊ก product code) — self-inflicted**: ทดสอบ curl ตรงๆ รอบแรกเรียก `export-collection-zip` โดยส่ง `$HOME` เป็น collection path (ตั้งใจแค่ลองยิง endpoint เร็วๆ) ทำให้ archiver พยายาม zip ทั้ง home directory จริง กิน heap จน node process OOM crash (`FATAL ERROR: Ineffective mark-compacts near heap limit`) — ไม่เกี่ยวกับ checksum feature เลย เกิดจากเลือก test path ผิดล้วนๆ — แก้โดย restart server แล้วใช้ collection path เล็กๆ ที่มีอยู่แล้วในสคริปต์ทดสอบ (`tests/interpolation/collection`) แทน
- ยังไม่ทำ — resume สำหรับไฟล์ใหญ่ที่ upload/download ค้างกลางทาง (chunked protocol + partial-file lifecycle + byte-range resume — ขอบเขตใหญ่กว่า checksum มาก เทียบเท่า P1.2's idempotency-key scope ที่ defer ไว้แล้ว)
- ✅ **opaque file handle API** — เดิม mark ว่า "`renderer:list-directory` ยังคืน absolute path ตรงๆ ยังไม่ใช่ opaque handle ตามที่ spec ต้องการ" ตาม **"ไม่ต้องเลื่อน ทำให้ครับไปเลย"** ทำเป็น backend capability ที่ **additive ล้วนๆ ไม่ breaking**: `renderer:list-directory` ยังคืน `path`/`parentPath` เดิมทุกอย่างเหมือนเดิม (ไม่ตัดออก เพราะ UI ยังต้องแสดง path จริงให้ผู้ใช้เห็นเพื่อ wayfinding) แต่เพิ่ม field ใหม่ `handle`/`parentHandle` ต่อ entry และต่อ directory ที่ list — เป็น opaque token เข้ารหัสด้วย AES-256-GCM (`bruno-electron/src/utils/file-handles.js`, per-process random key ไม่ persist) แทน absolute path จริง; `renderer:create-directory`/`renderer:rename-directory` รับ `dirPath` เป็นได้ทั้ง raw path เดิม **หรือ** handle ที่ได้จาก list-directory ก่อนหน้า (`resolvePathOrHandle()` เช็ค prefix `bruno-fh:` แยกสองแบบออกจากกัน) — พิสูจน์แล้วว่า flow ทั้งชุด (list → create → rename) ทำงานจบครบวงจรได้โดยไม่ต้องส่ง raw path เลยสักครั้ง ถ้า caller เลือกใช้ handle ตลอด; handle ยัง auth ตัวเองด้วย (GCM auth tag) — client forge handle สำหรับ path ที่ไม่เคยได้รับไม่ได้ ต่างจาก raw path string ที่พิมพ์อะไรก็ได้
  - **แก้ bypass gap ที่พบระหว่างออกแบบ**: `security/allowed-roots.js`'s generic path-scanner (`findPathsInValue`) จับได้แค่ string ที่ขึ้นต้นด้วย `/`/`C:`/`\\` เท่านั้น — handle ที่ขึ้นต้นด้วย `bruno-fh:` จะไม่ถูก scan เป็น path candidate เลย ถ้าไม่แก้อะไรเพิ่ม การเรียก `create-directory`/`rename-directory`/`list-directory` ด้วย handle จะได้ผ่าน `BRUNO_SERVER_ALLOWED_ROOTS` sandbox ไปฟรีๆ โดยไม่ถูกตรวจเลยแม้ path ที่ decode ออกมาจะอยู่นอก allowed root — แก้ด้วยการเพิ่ม `CHANNEL_PATH_EXTRACTORS` entry ให้ทั้ง 3 channel นี้ decode handle กลับเป็น real path ก่อนเช็ค `checkPathPolicy()` เสมอ (handle ที่ decode ไม่ได้/ถูกแก้ไข ตกไปเช็คเป็น string เดิมแทน ซึ่งเกือบจะ fail แน่นอน — fail-safe ไม่ใช่ fail-open)
  - Test coverage ใหม่: `file-handles.spec.js` (9 tests: round-trip, unique-IV per call, ไม่ confuse กับ raw path, tamper detection, malformed handle), `filesystem.spec.js` (+5 tests: handle ต่อ entry/directory, null parentHandle ที่ filesystem root, create/rename ยอมรับ handle แทน path), `allowed-roots.spec.js` (+5 tests: handle ที่ decode แล้วอยู่ใน allowed root ผ่าน, อยู่นอก root โดนบล็อก, raw path ยังทำงานเหมือนเดิม, malformed handle ตกไปเช็คแบบ fail-safe, `list-directory` ไม่มี `dirPath` arg เลยไม่โดน false-positive) — full suite ทั้งสอง package ผ่าน (bruno-electron 25/25 ไฟล์ที่แก้, bruno-server 330/330) lint clean ทุกไฟล์
  - **Live-verified ด้วย server process จริง** (ไม่ใช่ mock): (1) server ไม่ตั้ง `BRUNO_SERVER_ALLOWED_ROOTS` — `list-directory` คืน `handle`/`parentHandle` จริง, ใช้ handle นั้นเรียก `create-directory` แล้วต่อด้วย `rename-directory` โดยไม่เคยส่ง raw path เลยแม้แต่ครั้งเดียว → โฟลเดอร์ถูกสร้าง/rename จริงบน disk ถูกต้อง; ยิง raw path แบบเดิมคู่ขนานยืนยันว่ายัง regress ไม่มี; (2) server ตั้ง `BRUNO_SERVER_ALLOWED_ROOTS` ชี้ไปที่ root เดียว — `list-directory` ด้วย raw path นอก root โดน `403 PATH_OUTSIDE_ALLOWED_ROOT` ตามเดิม, ยิง handle ปลอม/handle จาก process อื่น (key คนละตัว decode ไม่ออก) ก็โดน `403` เหมือนกัน (fail-safe), และ `create-directory` ด้วย handle ที่ decode แล้วอยู่ *ใน* root ผ่านสำเร็จ (200) — พิสูจน์ว่า bypass gap ที่พบถูกปิดจริงในระบบที่รันจริง ไม่ใช่แค่ unit test
  - **ยังไม่ทำ**: frontend ยังไม่เปลี่ยนไปใช้ `handle` เลย (`BrowseFolderModal`/`providers/BrowseFolder` ยังส่ง/รับ raw `path` เหมือนเดิม 100%) — เป็น follow-up แยกต่างหาก (pattern เดียวกับ P0.2/P1.5 backend-done-UI-follow-up); handle ไม่ persist ข้าม process restart (ตั้งใจ ไม่ใช่ bug — ดู comment ใน `file-handles.js`)

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

### P1.3 Production Browser Packaging 🟡 เสร็จบางส่วน (static serving + runtime config + reverse proxy base path + Docker image + HTTPS/WSS เสร็จแล้ว)

- ✅ Bridge serve production static assets ชุดเดียวกับ API — `bruno-server/src/index.js` auto-detect `bruno-app/dist/index.html` (override ได้ด้วย `BRUNO_SERVER_STATIC_DIR`); ถ้าไม่เจอ build ก็ทำงานเหมือนเดิมทุกอย่าง (API/WS อย่างเดียว, frontend host แยก) — ไม่ใช่ breaking change
- ✅ runtime config endpoint แทน compile-time/hardcoded port — `GET {basePath}/api/runtime-config` คืน `{ basePath }`; ตอน serve static ด้วยตัวเอง ค่าเดียวกันถูก inject ตรงเป็น `window.__BRUNO_RUNTIME_CONFIG__` ใน `index.html` (`static-frontend.js`'s `injectRuntimeConfig`) แทนที่ `window.__BRUNO_SERVER_PORT__` เดิมที่เป็น dead code (ไม่มีจุดไหน set ค่าจริงเลยทั้ง repo)
- ✅ รองรับ reverse proxy base path ผ่าน `BRUNO_SERVER_BASE_PATH` (validate format ใน `config-validation.js`) — prefix ทุก `/api/*` route, WS server (`event-bridge.js`'s `attach(server, basePath)`), static assets, และ SPA fallback ให้ตรงกัน; ฝั่ง frontend (`ipc-transport.js`) อ่าน basePath จาก `window.__BRUNO_RUNTIME_CONFIG__` เวลาสร้าง `BRIDGE_SERVER_URL`/`WS_URL` — ถ้าไม่มี (เช่น dev mode หรือ frontend host แยก) ก็ fallback ไปพฤติกรรมเดิมเป๊ะๆ (root path, ไม่มี prefix) `/health/live`/`/health/ready` ตั้งใจไม่ prefix เพราะ orchestrator ส่วนใหญ่ probe container ตรงๆ ข้าม reverse proxy
- ✅ Docker image แบบ non-root, read-only filesystem และ mount allowed roots แบบ explicit — `packages/bruno-server/Dockerfile` (multi-stage: `deps` → `build` → `runtime`) build image เดียวรวม Bridge + bruno-app static build; runtime stage คัดลอกเฉพาะ workspace package ที่ require() จริง (ตรวจสอบด้วยการ grep import จริง ไม่ใช่แค่ `package.json` เพราะพบว่า under-declare หลายจุด) ไม่ใช่ทั้ง repo; รันเป็น non-root `node` user (uid 1000), รองรับ `--read-only` root filesystem (ทดสอบแล้วด้วย `--tmpfs /tmp` + mount volume ที่ `/home/node/.config/bruno` สำหรับ `USER_DATA_DIR`), มี `HEALTHCHECK` ผูกกับ `/health/live`; default `BRUNO_SERVER_HOST=0.0.0.0` ภายใน container (ต่างจาก bare-metal default `127.0.0.1`) เพราะ network namespace ของ container เองเป็น isolation boundary อยู่แล้ว — ดู `Installation.md` ข้อ 5.7 และ `THREAT_MODEL.md` ข้อ 6 สำหรับรายละเอียดและตัวอย่างคำสั่งเต็ม
- ✅ HTTPS/WSS แบบ opt-in bring-your-own certificate — เดิมข้อนี้ถูก mark ว่า "ควรถามผู้ใช้ก่อน" เพราะเป็น deployment-topology decision (เลือก TLS-in-server เอง vs. บังคับใช้ reverse proxy เสมอ vs. ผูก ACME) ตาม **"ไม่ต้องเลื่อน ทำให้ครับไปเลย"** เลือกทางที่ไม่ผูก topology ใดๆ ไว้ล่วงหน้า: เพิ่ม `BRUNO_SERVER_TLS_CERT_FILE`/`BRUNO_SERVER_TLS_KEY_FILE` (ต้องตั้งคู่กัน, validate ตอน start ผ่าน `config-validation.js`'s `validateTlsConfig()` เหมือน env var อื่นทุกตัว — ทั้งคู่ไม่มี → HTTP ปกติ, มีแค่ตัวเดียว หรือ path อ่านไม่ได้/ไม่ใช่ไฟล์ → fail fast) และ `BRUNO_SERVER_TLS_CA_FILE`/`BRUNO_SERVER_TLS_PASSPHRASE` (optional) ที่ `index.js` สลับ `http.createServer(app)` เป็น `https.createServer(TLS_OPTIONS, app)` ตามค่านี้ — **WSS ได้มาฟรี**: `eventBridge.attach(server, BASE_PATH)` ทำงานกับ `server` object เดิมทุกประการไม่ว่าจะเป็น `http.Server` หรือ `https.Server` เพราะ WebSocket upgrade เกาะอยู่กับ `'upgrade'` event ของ underlying server ไม่ใช่ protocol-specific เลย ไม่ต้องแก้ `ws/event-bridge.js` แม้แต่บรรทัดเดียว; `OAUTH2_CALLBACK_URL` default และ startup log lines (`http://`/`ws://`) เปลี่ยนตาม scheme ที่ active อัตโนมัติ (ยัง override ได้ผ่าน `BRUNO_SERVER_OAUTH2_CALLBACK_URL` เหมือนเดิมสำหรับ deployment ที่อยู่หลัง TLS-terminating reverse proxy ซึ่ง Bridge เองยังฟัง plain HTTP) — ไม่ใช่ breaking change (ค่า default ทั้งหมดว่างเปล่า, ไม่ตั้งอะไรก็ทำงานเหมือนเดิม 100%) ไม่ผูก ACME/CA เฉพาะ tool ใดๆ (certificate provisioning/renewal ยังเป็น operator responsibility เหมือน reverse-proxy path เดิม) ตาม decision เดิมที่ยังไม่เปลี่ยน — test coverage ใหม่ 9 tests ใน `config-validation.spec.js` (cert+key คู่ที่ถูกต้อง/มี CA/ไม่ตั้งเลย/ตั้งแค่ cert/ตั้งแค่ key/path ไม่มีจริงทั้ง 3 ตัว/path เป็น directory) — live-verified ด้วย self-signed cert จริง (`openssl req -x509 ...`) บูต server จริงแล้วยืนยัน `curl -sk https://127.0.0.1:4444/api/health` สำเร็จ และ WS client ต่อ `wss://127.0.0.1:4444/ws/events` เปิด/ปิด connection ได้สะอาด, ยืนยันแยกว่า mismatched config (cert ไม่มี key) fail fast ตาม error message ที่คาดไว้ และ plain-HTTP mode (ไม่ตั้ง TLS env var เลย) ยังทำงานปกติไม่มี regression; อัปเดต `Installation.md` (ทั้ง Thai/English, section 5.7.1 ใหม่) และ `packages/bruno-server/THREAT_MODEL.md` (boundary 1's MITM row, accepted-risk ข้อ 1, deploy recommendation ข้อ 6) ให้ตรงกับพฤติกรรมใหม่
- ✅ `/health/live`, `/health/ready`, build info และ dependency readiness
- ✅ graceful shutdown ที่ปิด watchers, terminals, sockets และ pending requests (มี ordering fix ยืนยันแล้วว่าไม่ hang รอ timeout)
- ✅ configuration validation ตอน start; invalid config ต้อง fail fast
- ยังไม่ทำ — SBOM, dependency scanning, signed images/artifacts และ provenance (ตอนนี้มี CI pipeline แล้ว — ดู P0.7 — แต่ยังต้องเลือก tool/policy ก่อนถึงจะทำได้ เป็น decision แยก)

### P1.4 Real Secret Storage 🟡 (A) crypto bug แก้แล้ว + (B) provider interface/local default เสร็จแล้ว (rotation/lock-unlock/real Vault-AWS backend ยังไม่ทำ — ตามการตัดสินใจ scope)

ก่อนเริ่มงาน survey พบว่า item นี้จริงๆมีปัญหาสองขนาดปนกันอยู่: (A) bug ด้าน crypto ที่กระทบความปลอดภัยจริงในของที่มีอยู่แล้ว กับ (B) ฟีเจอร์เต็มรูปแบบที่ยังไม่มีเลย (external secret provider interface, rotation, lock/unlock, backup policy) ถามผู้ใช้แล้วตัดสินใจ **ทำเฉพาะ (A) รอบแรก** เก็บ (B) ไว้ทำทีหลัง (pattern เดียวกับที่ P1.5 แยก backend ออกจาก UI) — รอบนี้ (P1.4B) กลับมาทำส่วนแรกของ (B): **external secret provider interface + local default** ตาม **"ไม่ต้องเลื่อน ทำให้ครับไปเลย"**

**บั๊กที่พบและแก้แล้ว:**
- ✅ **zero-IV AES-256-CBC** — `encryption.js`'s `aes256Encrypt` เดิมใช้ IV คงที่เป็นศูนย์เสมอ (`Buffer.alloc(16, 0)`) แปลว่า plaintext เดียวกัน → ciphertext เดียวกันเสมอ (ECB-like leakage, ใครอ่านไฟล์ store ได้จะเห็น pattern ความเท่ากันของค่าลับได้) แก้โดยเปลี่ยนเป็น **AES-256-GCM พร้อม random IV ทุกครั้งที่ encrypt** (`aes256GcmEncrypt`/`aes256GcmDecrypt`, algo tag ใหม่ `$02:`) — ได้ authenticated encryption เป็นของแถมด้วย (tamper/wrong-key detection ผ่าน auth tag) เก็บ decrypt path เดิม (`$01:`, zero-IV) ไว้เป็น **decrypt-only** เพื่ออ่าน ciphertext เก่าที่มีอยู่แล้วได้ — เท่ากับ migrate อัตโนมัติทุกครั้งที่ store อ่าน-แก้ไข-เขียนค่ากลับ (encrypt ใหม่จะได้ format ใหม่เสมอ ไม่ต้อง migration script แยก)
- ✅ **master key เก็บข้าง ciphertext** — `store/cookies.js` เดิม generate random passkey แล้วเก็บ `encryptedPasskey` ไว้ใน `electron-store` ไฟล์เดียวกับ (`cookies`) ที่เก็บ ciphertext ของ cookie values เอง ตรงข้ามกับ requirement ข้อนี้โดยตรง แก้โดยแยก master key ไปเก็บใน store คนละไฟล์ (`cookies-master-key`) พร้อม one-time migration logic (ย้าย key เก่าไปไฟล์ใหม่แล้วลบออกจากไฟล์เดิม เพื่อไม่ให้ cookie ที่เข้ารหัสไว้แล้วถอดรหัสไม่ได้)
- ✅ **Bridge ใช้ shared machine-wide key โดยไม่ได้ตั้งใจ** — `safeStorage` shim เดิมใน `bruno-server/src/index.js` คืนค่า `isEncryptionAvailable() => false` เสมอ (เป็น dead-code stub ทั้งก้อน) ทำให้ path `encryptString()`/`encryptStringSafe()` ทุกที่ (AI keys, OAuth2 tokens, secret env vars, ฯลฯ) ตกไปที่ fallback `machineIdSync()`-derived key เสมอเมื่อรันผ่าน Bridge — เป็น key เดียวใช้ร่วมกันทั้ง process ไม่มีการแยกต่อ deployment ไม่มีการ manage ใดๆ แก้โดยสร้าง **`security/master-key.js`**: generate random 32-byte key ครั้งแรกที่ deploy เก็บไว้ในไฟล์แยก (`~/.config/bruno/.keys/bridge-master.key`, permission `0600`, directory `0700`) ไม่ปนกับไฟล์ ciphertext ใดๆ, override ได้ผ่าน `BRUNO_SERVER_MASTER_KEY` (hex, สำหรับ deployment ที่ inject key ผ่าน secrets manager) แล้วเอา key นี้ไป implement `safeStorage`-shaped shim จริง (AES-256-GCM) แทน stub เดิม — `encryption.js` ฝั่ง call site ไม่ต้องแก้อะไรเลยเพราะเดินผ่าน `isEncryptionAvailable()` code path เดิมที่มีอยู่แล้ว
- ✅ Base64 fallback — สำรวจแล้วไม่พบว่ามีการใช้ Base64 เป็น encryption scheme ที่ไหนเลย (มีแต่ Base64 legitimate สำหรับ HTTP Basic-Auth header/PKCE ที่ไม่เกี่ยวกับ secret-at-rest) — ไม่ใช่ gap ที่ต้องแก้
- Test coverage ใหม่: `master-key.spec.js` (9 tests: key generation/persistence/permissions, env override, GCM round-trip, random-IV proof, wrong-key auth failure), `encryption.spec.js` เพิ่ม 6 tests (algo `$02:` เป็น default, random IV, passkey round-trip, wrong-passkey ล้มเหลว, legacy `$01:` ยัง decrypt ได้, malformed GCM ciphertext ล้มเหลวแบบ graceful), `cookies-store.test.js` ปรับ mock ให้รองรับ `delete()` (สำหรับ migration logic ใหม่)
- Live-verified: บูต Bridge server จริงกับ scratch `$HOME` แล้วตรวจสอบว่า `bridge-master.key` ถูกสร้างที่ path ที่คาดไว้ด้วย permission `0600`

- ✅ **P1.4B: external secret provider interface + local default** — `security/secret-provider.js` นิยาม interface กลาง `{ name, getMasterKey(): Buffer }` (envelope-encryption-style boundary: provider มีหน้าที่เดียวคือผลิต master key 32 byte ตัวเดียว ไม่แตะ bulk encrypt/decrypt logic ใน `encryption.js`/`master-key.js`'s `createSafeStorageShim` เลย — เปลี่ยน provider ไม่ต้องแก้ call site ไหนทั้งสิ้น) เลือก provider ผ่าน `BRUNO_SERVER_SECRET_PROVIDER` (ดีฟอลต์ `local` = behavior เดิมทุกประการ ไม่มีอะไรเปลี่ยน) มี 3 ชื่อ registered ที่ `packages/bruno-server/src/security/secret-providers/`: `local-provider.js` (ห่อ `master-key.js`'s logic เดิมไว้เฉยๆ, implement จริง), `vault-provider.js`/`aws-secrets-manager-provider.js` (registered name พร้อม contract ที่ document ไว้ แต่ throw error ชัดเจนถ้าถูกเลือก เพราะ fetch key จาก Vault/AWS จริงเป็น async + network-dependent operation ที่ `index.js`'s synchronous startup ไม่รองรับ ต้องมี SDK dependency ใหม่ + retry/timeout/rotation policy เป็นของตัวเอง — เป็น architecture decision คนละขนาดกับ "นิยาม interface" ตามที่เคยตัดสินใจ scope ไว้ ไม่ implement มั่วๆ) `config-validation.js` เพิ่มเช็ค `BRUNO_SERVER_SECRET_PROVIDER` ต้องเป็นหนึ่งใน 3 ชื่อนี้เท่านั้น (fail fast ตั้งแต่ startup ถ้าพิมพ์ผิด แทนที่จะไป fail ลึกๆใน bootstrap) — Test: `secret-provider.spec.js` (8 tests: ดีฟอลต์เป็น local, local คืน key จริง 32 byte จาก `master-key.js`, option override env, vault/aws-secrets-manager throw ข้อความชัดเจน, unknown name throw พร้อม list ชื่อที่รองรับ), `config-validation.spec.js` เพิ่ม describe block ใหม่ (accept 3 ชื่อ, reject typo/case-mismatch/empty) — full suite ผ่าน 346/346 (ขึ้นจาก 330) — Live-verified: บูต Bridge จริงด้วยดีฟอลต์ (ไม่ตั้ง env) ยืนยัน `bridge-master.key` ถูกสร้างเหมือนเดิมทุกอย่าง (permission `0600`) และ `/api/health` ตอบปกติ; ตั้ง `BRUNO_SERVER_SECRET_PROVIDER=vault` แล้วบูต ยืนยัน process exit(1) พร้อม error message ที่ชัดเจนอธิบายว่าทำไมยังไม่รองรับและควรทำอะไรแทน; ตั้งชื่อ provider ที่พิมพ์ผิด (`gcp-secret-manager`) ยืนยันโดน `validateStartupConfig` เตะออกตั้งแต่ก่อน master-key bootstrap เลยด้วยซ้ำ

**ยังไม่ทำรอบนี้ (ตัดสินใจแล้ว ไม่ใช่ของที่ลืม):**
- Desktop ยังใช้ OS keychain/safeStorage ตามเดิม (ไม่ได้แตะ — ยังทำงานถูกต้องอยู่แล้ว ไม่มี bug)
- Browser local mode ใช้ keyring backend ของ OS หรือ encrypted vault แยกต่างหาก — ยังไม่ทำ
- Vault/AWS Secrets Manager **provider จริง** (network call ไปดึง key จริงๆ) — ยังไม่ทำ ต้องทำ `index.js`'s startup ให้ async ได้ก่อน + เพิ่ม SDK dependency + ออกแบบ retry/timeout/credential/rotation policy เป็น architecture decision แยกรอบ (มี interface + registered name รอไว้แล้วจาก P1.4B)
- key rotation, lock/unlock concept, backup policy — greenfield ทั้งหมด ยังไม่ทำ ("ล็อค" หมายถึงอะไรสำหรับ headless server ก็ยังไม่ได้ตัดสินใจ)

### P1.5 Browser-Compatible OAuth 2.1 Flow ✅ เสร็จแล้วทั้ง backend/API และ frontend popup UI

- ✅ loopback callback endpoint ที่ Bridge — `GET /api/oauth2/callback` (`routes/oauth2.js`), ไม่ผ่าน `requireAuth` เพราะ IdP redirect ไม่มี session cookie/CSRF token อยู่แล้ว (เหมือน desktop custom-protocol handler เดิม)
- ✅ PKCE และ state validation — PKCE (S256) มีอยู่แล้วใน `oauth2.js`; state validation ทำผ่าน `oauth2-protocol-handler.js`'s `pendingRequests` Map (keyed by state) เหมือน desktop เดิม, route ใหม่เรียก `resolveOauth2AuthorizationRequest`/`rejectOauth2AuthorizationRequest` โดยตรง
- ✅ exact redirect URI registry — `app.browserBridge.oauth2CallbackUrl` (คำนวณจาก `BRUNO_SERVER_HOST`/`PORT`, override ได้ผ่าน `BRUNO_SERVER_OAUTH2_CALLBACK_URL`) ถูกบังคับใช้เป็น `redirect_uri` เสมอเมื่อรันผ่าน Bridge — ไม่สนใจ `callbackUrl` ที่ผู้ใช้ตั้งไว้ (breaking change เทียบกับ desktop โดยตั้งใจ ตามที่ตัดสินใจไว้)
- ✅ callback routing กลับ session ที่เริ่ม flow — ไม่ต้องเขียน routing code ใหม่เลย: ขาไป (`oauth2:authorization-required` event) ใช้ WindowShim's session-vs-broadcast routing ที่มีอยู่แล้ว (AsyncLocalStorage); ขากลับใช้กลไก HTTP request/response ธรรมดา — `POST /api/ipc/renderer:fetch-oauth2-credentials` เดิมค้าง pending อยู่จนกว่า callback route จะ resolve มัน แล้ว response ก็กลับไปหา browser tab เดิมเอง
- ✅ timeout/cancel — timeout (5 นาที) และ cancel (`renderer:cancel-oauth2-authorization-request`) มีอยู่แล้วและใช้งานได้ผ่าน Bridge โดยไม่ต้องแก้; นอกจากนี้แก้ IPC proxy's global 30s timeout ที่จะ kill flow นี้ก่อนเวลาด้วย per-channel timeout override ใหม่ (`ipc-limits.js`'s `LONG_RUNNING_CHANNEL_TIMEOUTS_MS`, override ได้ผ่าน `BRUNO_SERVER_IPC_OAUTH2_TIMEOUT_MS`)
- ✅ redact authorization code/token จาก logs — `logOauth2Callback({state, outcome})` ใน `audit-log.js` log เฉพาะ state + outcome เท่านั้น ไม่เคย log `code`
- ✅ test parallel OAuth flows จากสอง sessions — mechanism เดิม (`pendingRequests` keyed by state, isolation ต่อ session) มี test coverage อยู่แล้วใน `oauth2-protocol-handler.spec.js`; เพิ่ม test ใหม่สำหรับ `resolveOauth2AuthorizationRequest`/`rejectOauth2AuthorizationRequest` ที่ route ใหม่เรียกใช้โดยตรง
- ✅ frontend popup UI (follow-up ที่เคย defer ไว้ — กลับมาทำตาม **"ไม่ต้องเลื่อน ทำให้ครับไปเลย"**) — `Oauth2ActionButtons` subscribe `oauth2:authorization-required` ผ่าน `transport.on(...)` (generic, ใช้ได้ทุก channel อยู่แล้ว) แล้ว `window.open()` popup ทันทีที่ event มาถึง; ตรวจ blocked-popup จาก return value เดียว (`window.open` ไม่ throw เมื่อโดน block — คืน `null`/`closed: true`/`closed: undefined`) แล้ว fallback ไปโชว์ modal ใหม่ (`Oauth2ActionButtons/PopupBlockedModal`, เขียนตาม template ของ `GitNotFoundModal`) ให้ผู้ใช้กด "Open Authorization Page" เอง — click ตรงนี้เป็น fresh user gesture เสมอ เลย `window.open()` ซ้ำไม่โดน block; ปิด popup อัตโนมัติผ่าน `handleFetchOauth2Credentials`'s `finally` block (ไม่ต้องมี WS event ใหม่ เพราะ promise ของ `fetchOauth2Credentials` resolve/reject เมื่อ full round-trip เสร็จอยู่แล้ว) และ cancel-path (`handleCancelAuthorization`) ก็ปิด popup เหมือนกัน
- **out of scope ในรอบนี้ (ตัดสินใจแล้ว)**: implicit grant ถูก reject อย่างชัดเจนเมื่อรันผ่าน Bridge (`getOAuth2TokenUsingImplicitGrant`) เพราะ browser ไม่ส่ง URL hash fragment ไปที่ server ได้ — ไม่มีทางแก้ทาง technical, และ OAuth 2.1 เองก็ deprecate implicit grant อยู่แล้ว

### P1.6 Runtime and Dependency Modernization ✅ เสร็จแล้วทั้งหมด (step 1-6)

สถานะ ณ สิงหาคม 2026 (อัปเดตหลัง step 3-5 เสร็จ ตามที่ผู้ใช้อนุมัติ target versions: "ลองใช้ Node 26 และ Electron 43, React latest 19.2, Express 5.1"):

- Node 24 เป็น LTS baseline (`engines.node >=24`); Node 26 ผ่านการทดสอบทั้ง monorepo แล้ว (ดู step 2)
- Electron อัปเกรดครบจาก 37 → 43 (ทีละ major ทั้ง 6 major: 37→38→39→40→41→42→43) — ปัจจุบัน pin ที่ `~43.2.0`
- React อัปเกรดจาก 19.0.0 → 19.2.8 ใน `bruno-app` (และ `bruno-graphql-docs` เพื่อความสอดคล้อง)
- Express อัปเกรดจาก 4.21 → 5.1 (resolved 5.2.1) ใน Bridge (`bruno-server`)

แผนแนะนำ:

1. ✅ เพิ่ม Renovate/Dependabot แบบ grouped updates — `.github/dependabot.yml` (npm ecosystem, root-rooted ครอบทุก workspace ผ่าน lockfile เดียว) แบ่งกลุ่ม `runtime` (Electron/Express), `ui-libraries` (React/Redux/Phaser), `build-tooling` (bundler/lint/test tooling) ตาม risk bucket ที่ข้อความด้านล่างระบุไว้เอง — เป็นแค่ config เปิดใช้ automated PR ให้ review เท่านั้น ไม่ได้ trigger upgrade จริงใด ๆ
2. ✅ upgrade Node baseline เป็น 24 LTS — เพิ่ม `engines.node >=24` ใน root `package.json`, bump base image ทั้ง 3 Dockerfile (`bruno-server`, `bruno-cli` debian/alpine variant) เป็น `node:24-slim`/`node:24-alpine`, อัปเดต `Installation.md` (ทั้ง Thai/English) และ docker README ที่เกี่ยวข้องให้ตรงกัน ระหว่างทางเจอและแก้ pre-existing bug: 4 package.json (`bruno-electron`, `bruno-cli`, `bruno-converters`, `bruno-js`) ใช้ `$(npx which jest)` แบบไม่ quote ทำให้ shell word-split path ที่มีช่องว่างพัง (ไม่เกี่ยวกับ Node 24 โดยตรง แต่ block การรัน full test suite เพื่อ verify) — verify แล้วด้วย `npm test --workspaces --if-present` (exit 0 ทุก package) และ live Docker verification (`node:24-slim` image, health endpoint รายงาน `nodeVersion: v24.18.1`, non-root user, `--read-only --tmpfs /tmp`, WebSocket `/ws/events` เชื่อมต่อสำเร็จ) — **"ทดสอบ 26 แบบ allowed-to-fail" เสร็จแล้ว**: รัน full monorepo test suite ทุก workspace ผ่าน `nvm` ด้วย Node v26.5.1 จริง (ไม่ใช่ CI matrix job เพราะ repository ยังไม่มี CI pipeline — ดู P0.5/P1.3) ผลคือผ่านทั้งหมด 100% (ทุก suite ทุก workspace, zero failures) โดยที่ Node 24 ยังคงเป็น baseline หลักตาม `engines.node` ไม่เปลี่ยนแปลง
3. ✅ upgrade Electron ทีละ major พร้อม smoke test — ทำครบทั้ง 6 major (37→38→39→40→41→42→43) ทีละ commit แยกกัน แต่ละ commit มี smoke test/verification ของตัวเอง ปัจจุบัน pin ที่ `~43.2.0` ซึ่งอยู่ในสาม stable majors ล่าสุดตามที่ Electron project support
4. ✅ upgrade React 19.2 และแก้ React 19 ref warnings — bump `react`/`react-dom` เป็น `19.2.8` ใน `bruno-app` (และ `bruno-graphql-docs` เพื่อ align pin, ใช้เฉพาะตอน build เพราะ externalize ออกจาก published bundle ผ่าน `rollup-plugin-peer-deps-external`) ระหว่างทางเจอ bug จริง: bruno-app's exact-pinned React ใหม่ทำให้เกิด React สองชุดพร้อมกัน (root hoisted เก่า vs nested ใหม่) เพราะ transitive deps บางตัว (`react-hot-toast`, `@tabler/icons` ฯลฯ) peer-cap ไว้ที่ `^18` — แก้โดยเพิ่ม `react`/`react-dom` เข้า root `package.json`'s `dependencies` และ `overrides` (pattern เดียวกับที่ใช้กับ `axios`/`rollup`/`pbkdf2` อยู่แล้ว) บังคับให้ dedupe เหลือ React ชุดเดียวทั้ง tree — verify แล้วด้วย full monorepo test suite (13 workspaces, all green) และ production build (`rsbuild build -m production` ได้ `lib-react` chunk เดียว ไม่มี duplicate) — ส่วน **React 19 ref warning** ("Accessing element.ref was removed") root-cause แล้วว่ามาจากบรรทัดเดียวใน `@tippyjs/react`'s `Tippy.js` (third-party package ที่ดูเหมือนจะไม่ maintain ต่อสำหรับ React 19 แล้ว, เวอร์ชันล่าสุดบน npm คือ 4.2.6 เท่าที่มี) — **ตั้งใจไม่แก้ในรอบนี้**: เป็นแค่ console warning ไม่กระทบ test/functionality จริง (React เองบอกว่ายังใช้งานได้ "for now"), การ patch/เปลี่ยน UI dependency ทั้ง tree เป็นการตัดสินใจ product-risk ที่ควรถามผู้ใช้ก่อนเหมือน P1.5's popup UI ไม่ใช่สิ่งที่ควรทำเองแบบเงียบ ๆ
5. ✅ migrate Bridge ไป Express 5 พร้อม contract/integration tests — bump `express` เป็น `^5.1.0` (resolved `5.2.1`) ใน `bruno-server`; cross-reference breaking changes ทั้งหมดของ Express 5 กับ usage จริง เจอจุดกระทบจริงจุดเดียวคือ SPA fallback route ใช้ bare wildcard `/*` ซึ่ง Express 5's path-to-regexp v8 reject ตรง ๆ — แก้เป็น `/*splat` (named wildcard) ตามที่ Express 5 กำหนด; เพิ่ม `packages/bruno-server/src/__tests__/app-routes.spec.js` เป็น HTTP-level integration test suite ใหม่ (ใช้ `supertest`, mount route modules จริงไม่ mock) 13 tests ครอบ auth/ipc-proxy/admin/oauth2 routes และ SPA fallback routing โดยเฉพาะ — ปิด gap เดิมที่ไม่เคยมี test สร้าง real Express app เลย — verify แล้วด้วย full test suite (18 suites/256 tests) และ live-boot smoke test (production server บูตจริง, 203 real IPC handlers, serve ถูกต้องบน Express 5.2.1)
6. ✅ กำหนด quarterly dependency upgrade window และ SLA สำหรับ security patches — เขียนเป็นเอกสารจริงที่ `docs/dependency-upgrade-policy.md`: quarterly window (สัปดาห์ที่สองของทุกไตรมาส, merge Dependabot PR เรียงตาม risk bucket เดิม `runtime → ui-libraries → build-tooling`) + SLA ตาม severity (Critical 48 ชม., High 7 วัน, Moderate/Low รอ window ถัดไป) พร้อมกฎว่า Critical/High ต้องเป็น standalone commit แยกจาก batch, ยังต้องผ่าน full test suite เสมอ, และถ้าไม่มี patch ทันเวลาให้ document mitigation ชั่วคราวใน `find bug and Improvement.md`

อย่า upgrade ทุก dependency ใน PR เดียว ควรแยก runtime, build tooling และ UI libraries เพื่อลด blast radius — ข้อ 3-5 ทำแยก commit ต่อ major/dependency ตามหลักการนี้แล้ว (Electron แยก 6 commit ทีละ major, Express และ React แยกกันคนละ commit), ข้อ 6 กำหนดเป็น policy อย่างเป็นทางการแล้วที่ `docs/dependency-upgrade-policy.md`

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

