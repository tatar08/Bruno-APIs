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
- 🟡 เพิ่ม confirmation/policy สำหรับ action เสี่ยงสูง — ยังไม่ทำ ต้องถามผู้ใช้ก่อน (breaking UX change)
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
- upload ต้องตรวจ size, extension, magic bytes และ filename normalization — ยังไม่ทำ (ยังไม่มี upload flow จริงในระบบจนกว่าจะทำ P1.1 file explorer)

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

### P0.7 CI Pipeline 🟡 เสร็จบางส่วน (พื้นฐานเสร็จแล้ว — repo ไม่มี CI มาก่อนเลย)

**เป้าหมาย:** ปิดช่องว่างที่หลาย item ข้างบน (P0.5, P0.6) ค้างอยู่ที่ 🟡 เพราะไม่มี CI pipeline ให้ผูก gate เข้าไป (repo มีแค่ `.github/dependabot.yml` ไม่มี `.github/workflows` มาก่อน)

- ✅ สร้าง `.github/workflows/ci.yml` — รันทุก push เข้า `main` และทุก pull request, สามงาน (parallel jobs):
  - `lint` — `npm run lint` ทั้ง repo, blocking; ตอนสร้าง workflow นี้ครั้งแรกพบ lint error ค้างอยู่ 54 จุด (ทั้งหมด auto-fixable, กระจายในไฟล์ที่ไม่เกี่ยวกับ CI เลย) — รัน `npm run lint:fix` แก้หมดแล้ว (quote style, indent, blank-line เท่านั้น ไม่แตะ logic เลย, test suite ที่เกี่ยวข้องรันผ่านหมดหลังแก้) ก่อนเปิด job เป็น blocking
  - `test` — `npm test --workspaces --if-present` รัน jest ของทุก workspace ที่มี `test` script (ข้าม workspace ที่ไม่มี เช่น `bruno-docs`, `bruno-schema-types`) — live-verified แล้วว่าผ่านทั้งหมดก่อน commit (เช่น `bruno-server` 286/286, `bruno-rpc-contract` 19/19)
  - `rpc-contract-parity` — `npm run audit:parity --workspace=packages/bruno-rpc-contract` (ดู P0.5) — live-verified ผ่านก่อน commit
- ยังไม่ทำ — Playwright e2e/`browser-bridge` suite (P0.6) ใน CI: ต้องมี browser binary install + headless boot strategy เป็นงานแยกที่ใหญ่กว่า
- ยังไม่ทำ — SBOM, dependency scanning, signed artifacts (P1.3): ตอนนี้มี CI ให้ผูกแล้ว แต่ยังต้องเลือก tool/signing-key policy ก่อน เป็น decision แยก
- ยังไม่ทำ — matrix ข้าม platform (Windows/macOS/Linux) หรือ Node version (P0.6's minimum test matrix): รันแค่ `ubuntu-latest` ตอนนี้
- ไม่แก้ diff-only lint mode — `eslint-plugin-diff` registered เป็น plugin ใน `eslint.config.js` อยู่แล้วแต่ยังไม่ได้ wire เข้า rule ใดๆ จริง (dead registration) ไม่ใช่ blocker อีกต่อไปเพราะ debt เดิมแก้หมดแล้ว แต่ยังเป็นโอกาสปรับปรุงในอนาคตถ้าอยากให้ PR ใหญ่ ๆ ไม่ต้องพะวงกับ lint error ของโค้ดที่ตัวเองไม่ได้แตะ

---

## P1 — ทำให้ Browser ใช้งานจริงได้ดี (1–3 เดือน)

### P1.1 Server File Explorer and Transfer Center 🟡 เสร็จบางส่วน (folder-picking modal + upload/download + progress/cancel จริงแล้ว; search/favorites/create-folder/preview/checksum-resume/opaque-handle ยังไม่ทำ)

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
- ยังไม่ทำ — search, recent paths และ favorites
- ยังไม่ทำ — create folder, rename และ conflict resolution
- ยังไม่ทำ — multi-select พร้อม preview (ไฟล์, ไม่ใช่โฟลเดอร์ — `renderer:browse-files` ยังใช้ `window.prompt()` เดิมอยู่)
- ยังไม่ทำ — checksum และ resume สำหรับไฟล์ใหญ่ (progress/cancel ปิดแล้ว)
- ยังไม่ทำ — แสดงให้ชัดว่า path เป็นของ **Bridge machine** หรือ **Browser machine** (modal ปัจจุบันแสดงแค่ path ตรงๆ ไม่มี label เครื่อง)

API ควรใช้ opaque file handles แทนส่ง absolute path กลับ renderer ทุกครั้ง — ยังไม่ทำ ตอนนี้ `renderer:list-directory` ยังคืน absolute path ตรงๆ เหมือน handler อื่นๆ ที่มีอยู่แล้วในระบบ (ไม่ใช่ regression เพราะ path เหล่านี้ก็ resolve ได้อยู่แล้วผ่าน `renderer:resolve-path`/`renderer:is-directory` เดิม แต่ยังไม่ใช่ opaque handle ตามที่ spec ต้องการ)

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

### P1.3 Production Browser Packaging 🟡 เสร็จบางส่วน (static serving + runtime config + reverse proxy base path + Docker image เสร็จแล้ว)

- ✅ Bridge serve production static assets ชุดเดียวกับ API — `bruno-server/src/index.js` auto-detect `bruno-app/dist/index.html` (override ได้ด้วย `BRUNO_SERVER_STATIC_DIR`); ถ้าไม่เจอ build ก็ทำงานเหมือนเดิมทุกอย่าง (API/WS อย่างเดียว, frontend host แยก) — ไม่ใช่ breaking change
- ✅ runtime config endpoint แทน compile-time/hardcoded port — `GET {basePath}/api/runtime-config` คืน `{ basePath }`; ตอน serve static ด้วยตัวเอง ค่าเดียวกันถูก inject ตรงเป็น `window.__BRUNO_RUNTIME_CONFIG__` ใน `index.html` (`static-frontend.js`'s `injectRuntimeConfig`) แทนที่ `window.__BRUNO_SERVER_PORT__` เดิมที่เป็น dead code (ไม่มีจุดไหน set ค่าจริงเลยทั้ง repo)
- ✅ รองรับ reverse proxy base path ผ่าน `BRUNO_SERVER_BASE_PATH` (validate format ใน `config-validation.js`) — prefix ทุก `/api/*` route, WS server (`event-bridge.js`'s `attach(server, basePath)`), static assets, และ SPA fallback ให้ตรงกัน; ฝั่ง frontend (`ipc-transport.js`) อ่าน basePath จาก `window.__BRUNO_RUNTIME_CONFIG__` เวลาสร้าง `BRIDGE_SERVER_URL`/`WS_URL` — ถ้าไม่มี (เช่น dev mode หรือ frontend host แยก) ก็ fallback ไปพฤติกรรมเดิมเป๊ะๆ (root path, ไม่มี prefix) `/health/live`/`/health/ready` ตั้งใจไม่ prefix เพราะ orchestrator ส่วนใหญ่ probe container ตรงๆ ข้าม reverse proxy
- ✅ Docker image แบบ non-root, read-only filesystem และ mount allowed roots แบบ explicit — `packages/bruno-server/Dockerfile` (multi-stage: `deps` → `build` → `runtime`) build image เดียวรวม Bridge + bruno-app static build; runtime stage คัดลอกเฉพาะ workspace package ที่ require() จริง (ตรวจสอบด้วยการ grep import จริง ไม่ใช่แค่ `package.json` เพราะพบว่า under-declare หลายจุด) ไม่ใช่ทั้ง repo; รันเป็น non-root `node` user (uid 1000), รองรับ `--read-only` root filesystem (ทดสอบแล้วด้วย `--tmpfs /tmp` + mount volume ที่ `/home/node/.config/bruno` สำหรับ `USER_DATA_DIR`), มี `HEALTHCHECK` ผูกกับ `/health/live`; default `BRUNO_SERVER_HOST=0.0.0.0` ภายใน container (ต่างจาก bare-metal default `127.0.0.1`) เพราะ network namespace ของ container เองเป็น isolation boundary อยู่แล้ว — ดู `Installation.md` ข้อ 5.7 และ `THREAT_MODEL.md` ข้อ 6 สำหรับรายละเอียดและตัวอย่างคำสั่งเต็ม
- ยังไม่ทำ — HTTPS/WSS สำหรับ non-loopback mode (deployment-topology decision ที่ควรถามผู้ใช้ก่อน)
- ✅ `/health/live`, `/health/ready`, build info และ dependency readiness
- ✅ graceful shutdown ที่ปิด watchers, terminals, sockets และ pending requests (มี ordering fix ยืนยันแล้วว่าไม่ hang รอ timeout)
- ✅ configuration validation ตอน start; invalid config ต้อง fail fast
- ยังไม่ทำ — SBOM, dependency scanning, signed images/artifacts และ provenance (ตอนนี้มี CI pipeline แล้ว — ดู P0.7 — แต่ยังต้องเลือก tool/policy ก่อนถึงจะทำได้ เป็น decision แยก)

### P1.4 Real Secret Storage 🟡 security bug ที่พบระหว่างสำรวจแก้แล้ว (external provider/rotation/lock-unlock ยังไม่ทำ — ตามการตัดสินใจ scope)

ก่อนเริ่มงาน survey พบว่า item นี้จริงๆมีปัญหาสองขนาดปนกันอยู่: (A) bug ด้าน crypto ที่กระทบความปลอดภัยจริงในของที่มีอยู่แล้ว กับ (B) ฟีเจอร์เต็มรูปแบบที่ยังไม่มีเลย (external secret provider interface, rotation, lock/unlock, backup policy) ถามผู้ใช้แล้วตัดสินใจ **ทำเฉพาะ (A) รอบนี้** เก็บ (B) ไว้ทำทีหลัง (pattern เดียวกับที่ P1.5 แยก backend ออกจาก UI)

**บั๊กที่พบและแก้แล้ว:**
- ✅ **zero-IV AES-256-CBC** — `encryption.js`'s `aes256Encrypt` เดิมใช้ IV คงที่เป็นศูนย์เสมอ (`Buffer.alloc(16, 0)`) แปลว่า plaintext เดียวกัน → ciphertext เดียวกันเสมอ (ECB-like leakage, ใครอ่านไฟล์ store ได้จะเห็น pattern ความเท่ากันของค่าลับได้) แก้โดยเปลี่ยนเป็น **AES-256-GCM พร้อม random IV ทุกครั้งที่ encrypt** (`aes256GcmEncrypt`/`aes256GcmDecrypt`, algo tag ใหม่ `$02:`) — ได้ authenticated encryption เป็นของแถมด้วย (tamper/wrong-key detection ผ่าน auth tag) เก็บ decrypt path เดิม (`$01:`, zero-IV) ไว้เป็น **decrypt-only** เพื่ออ่าน ciphertext เก่าที่มีอยู่แล้วได้ — เท่ากับ migrate อัตโนมัติทุกครั้งที่ store อ่าน-แก้ไข-เขียนค่ากลับ (encrypt ใหม่จะได้ format ใหม่เสมอ ไม่ต้อง migration script แยก)
- ✅ **master key เก็บข้าง ciphertext** — `store/cookies.js` เดิม generate random passkey แล้วเก็บ `encryptedPasskey` ไว้ใน `electron-store` ไฟล์เดียวกับ (`cookies`) ที่เก็บ ciphertext ของ cookie values เอง ตรงข้ามกับ requirement ข้อนี้โดยตรง แก้โดยแยก master key ไปเก็บใน store คนละไฟล์ (`cookies-master-key`) พร้อม one-time migration logic (ย้าย key เก่าไปไฟล์ใหม่แล้วลบออกจากไฟล์เดิม เพื่อไม่ให้ cookie ที่เข้ารหัสไว้แล้วถอดรหัสไม่ได้)
- ✅ **Bridge ใช้ shared machine-wide key โดยไม่ได้ตั้งใจ** — `safeStorage` shim เดิมใน `bruno-server/src/index.js` คืนค่า `isEncryptionAvailable() => false` เสมอ (เป็น dead-code stub ทั้งก้อน) ทำให้ path `encryptString()`/`encryptStringSafe()` ทุกที่ (AI keys, OAuth2 tokens, secret env vars, ฯลฯ) ตกไปที่ fallback `machineIdSync()`-derived key เสมอเมื่อรันผ่าน Bridge — เป็น key เดียวใช้ร่วมกันทั้ง process ไม่มีการแยกต่อ deployment ไม่มีการ manage ใดๆ แก้โดยสร้าง **`security/master-key.js`**: generate random 32-byte key ครั้งแรกที่ deploy เก็บไว้ในไฟล์แยก (`~/.config/bruno/.keys/bridge-master.key`, permission `0600`, directory `0700`) ไม่ปนกับไฟล์ ciphertext ใดๆ, override ได้ผ่าน `BRUNO_SERVER_MASTER_KEY` (hex, สำหรับ deployment ที่ inject key ผ่าน secrets manager) แล้วเอา key นี้ไป implement `safeStorage`-shaped shim จริง (AES-256-GCM) แทน stub เดิม — `encryption.js` ฝั่ง call site ไม่ต้องแก้อะไรเลยเพราะเดินผ่าน `isEncryptionAvailable()` code path เดิมที่มีอยู่แล้ว
- ✅ Base64 fallback — สำรวจแล้วไม่พบว่ามีการใช้ Base64 เป็น encryption scheme ที่ไหนเลย (มีแต่ Base64 legitimate สำหรับ HTTP Basic-Auth header/PKCE ที่ไม่เกี่ยวกับ secret-at-rest) — ไม่ใช่ gap ที่ต้องแก้
- Test coverage ใหม่: `master-key.spec.js` (9 tests: key generation/persistence/permissions, env override, GCM round-trip, random-IV proof, wrong-key auth failure), `encryption.spec.js` เพิ่ม 6 tests (algo `$02:` เป็น default, random IV, passkey round-trip, wrong-passkey ล้มเหลว, legacy `$01:` ยัง decrypt ได้, malformed GCM ciphertext ล้มเหลวแบบ graceful), `cookies-store.test.js` ปรับ mock ให้รองรับ `delete()` (สำหรับ migration logic ใหม่)
- Live-verified: บูต Bridge server จริงกับ scratch `$HOME` แล้วตรวจสอบว่า `bridge-master.key` ถูกสร้างที่ path ที่คาดไว้ด้วย permission `0600`

**ยังไม่ทำรอบนี้ (ตัดสินใจแล้ว ไม่ใช่ของที่ลืม):**
- Desktop ยังใช้ OS keychain/safeStorage ตามเดิม (ไม่ได้แตะ — ยังทำงานถูกต้องอยู่แล้ว ไม่มี bug)
- Browser local mode ใช้ keyring backend ของ OS หรือ encrypted vault แยกต่างหาก — ยังไม่ทำ
- remote/server mode รองรับ external secret provider ผ่าน interface (เช่น Vault, AWS Secrets Manager) — ยังไม่ทำ ต้องออกแบบ interface shape ก่อน เป็น architecture decision ที่ต้องคุยกับผู้ใช้แยกรอบ
- key rotation, lock/unlock concept, backup policy — greenfield ทั้งหมด ยังไม่ทำ ("ล็อค" หมายถึงอะไรสำหรับ headless server ก็ยังไม่ได้ตัดสินใจ)

### P1.5 Browser-Compatible OAuth 2.1 Flow 🟡 backend/API เสร็จแล้ว (UI ยังไม่ทำ — ตามการตัดสินใจ scope)

- ✅ loopback callback endpoint ที่ Bridge — `GET /api/oauth2/callback` (`routes/oauth2.js`), ไม่ผ่าน `requireAuth` เพราะ IdP redirect ไม่มี session cookie/CSRF token อยู่แล้ว (เหมือน desktop custom-protocol handler เดิม)
- ✅ PKCE และ state validation — PKCE (S256) มีอยู่แล้วใน `oauth2.js`; state validation ทำผ่าน `oauth2-protocol-handler.js`'s `pendingRequests` Map (keyed by state) เหมือน desktop เดิม, route ใหม่เรียก `resolveOauth2AuthorizationRequest`/`rejectOauth2AuthorizationRequest` โดยตรง
- ✅ exact redirect URI registry — `app.browserBridge.oauth2CallbackUrl` (คำนวณจาก `BRUNO_SERVER_HOST`/`PORT`, override ได้ผ่าน `BRUNO_SERVER_OAUTH2_CALLBACK_URL`) ถูกบังคับใช้เป็น `redirect_uri` เสมอเมื่อรันผ่าน Bridge — ไม่สนใจ `callbackUrl` ที่ผู้ใช้ตั้งไว้ (breaking change เทียบกับ desktop โดยตั้งใจ ตามที่ตัดสินใจไว้)
- ✅ callback routing กลับ session ที่เริ่ม flow — ไม่ต้องเขียน routing code ใหม่เลย: ขาไป (`oauth2:authorization-required` event) ใช้ WindowShim's session-vs-broadcast routing ที่มีอยู่แล้ว (AsyncLocalStorage); ขากลับใช้กลไก HTTP request/response ธรรมดา — `POST /api/ipc/renderer:fetch-oauth2-credentials` เดิมค้าง pending อยู่จนกว่า callback route จะ resolve มัน แล้ว response ก็กลับไปหา browser tab เดิมเอง
- 🟡 timeout/cancel — timeout (5 นาที) และ cancel (`renderer:cancel-oauth2-authorization-request`) มีอยู่แล้วและใช้งานได้ผ่าน Bridge โดยไม่ต้องแก้; นอกจากนี้แก้ IPC proxy's global 30s timeout ที่จะ kill flow นี้ก่อนเวลาด้วย per-channel timeout override ใหม่ (`ipc-limits.js`'s `LONG_RUNNING_CHANNEL_TIMEOUTS_MS`, override ได้ผ่าน `BRUNO_SERVER_IPC_OAUTH2_TIMEOUT_MS`) — **popup-blocked fallback UI ยังไม่ทำ** เพราะ scope นี้เป็น backend/API only ตามการตัดสินใจ
- ✅ redact authorization code/token จาก logs — `logOauth2Callback({state, outcome})` ใน `audit-log.js` log เฉพาะ state + outcome เท่านั้น ไม่เคย log `code`
- ✅ test parallel OAuth flows จากสอง sessions — mechanism เดิม (`pendingRequests` keyed by state, isolation ต่อ session) มี test coverage อยู่แล้วใน `oauth2-protocol-handler.spec.js`; เพิ่ม test ใหม่สำหรับ `resolveOauth2AuthorizationRequest`/`rejectOauth2AuthorizationRequest` ที่ route ใหม่เรียกใช้โดยตรง
- **out of scope ในรอบนี้ (ตัดสินใจแล้ว)**: implicit grant ถูก reject อย่างชัดเจนเมื่อรันผ่าน Bridge (`getOAuth2TokenUsingImplicitGrant`) เพราะ browser ไม่ส่ง URL hash fragment ไปที่ server ได้ — ไม่มีทางแก้ทาง technical, และ OAuth 2.1 เองก็ deprecate implicit grant อยู่แล้ว; frontend popup UI (เปิด popup, จัดการ popup-blocked, ปิด popup อัตโนมัติหลัง callback) เป็น follow-up แยกต่างหาก

### P1.6 Runtime and Dependency Modernization ✅ เสร็จแล้ว (step 1-5); step 6 เป็น process decision แยกต่างหาก

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
6. กำหนด quarterly dependency upgrade window และ SLA สำหรับ security patches — ยังไม่ทำ (เป็น process/policy decision ของทีม ไม่ใช่โค้ด ต้องตัดสินใจร่วมกับผู้ใช้/ทีม)

อย่า upgrade ทุก dependency ใน PR เดียว ควรแยก runtime, build tooling และ UI libraries เพื่อลด blast radius — ข้อ 3-5 ทำแยก commit ต่อ major/dependency ตามหลักการนี้แล้ว (Electron แยก 6 commit ทีละ major, Express และ React แยกกันคนละ commit) — **ข้อ 6 เหลือเป็นข้อเดียวที่ยังไม่ทำ**: เป็น process/policy decision ที่ต้องคุยกับทีมก่อน ไม่ใช่สิ่งที่ทำเองได้ฝ่ายเดียว

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

