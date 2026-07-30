# Find Bug and Improvement

> ตรวจสอบ ณ วันที่ 30 กรกฎาคม 2026
> ขอบเขต: โค้ดที่เปลี่ยนใน 3 commits ล่าสุด (dataset iterations, runner results UI, network handling) และไฟล์ที่เกี่ยวข้อง
> วิธีตรวจ: อ่านโค้ดไล่ flow จริง (renderer → IPC → runner loop → script runtime), รัน test เดิม และ eslint

## สรุปผู้บริหาร

พบบัค **12 รายการ** — ในจำนวนนี้มี **2 รายการระดับสูง (B1, B2)** อยู่ในฟีเจอร์ dataset iterations ที่เพิ่งเพิ่ม ทั้งคู่เกิดจากการสร้าง `currentEnvVars` แบบ merge copy ต่อ request ใน runner loop ควรแก้ B1–B2 ก่อนเริ่มงานตาม `Improvement.md` เพราะเป็น correctness ของฟีเจอร์ที่เพิ่ง ship และแก้ตอนนี้ถูกกว่าแก้หลัง refactor

สถานะที่ตรวจแล้ว:

- ✅ `runner-dataset.spec.js` ผ่าน 5/5
- ✅ `timeline-routing.spec.js` ผ่าน 12/12
- ✅ eslint ไฟล์ที่เปลี่ยนล่าสุด ไม่มี error
- ❌ ยังไม่มี test ครอบคลุม env-var persistence ข้าม request ใน runner (จุดที่ B1 พัง)

---

## 1. บัคที่พบ (เรียงตามความรุนแรง)

| # | ระดับ | ไฟล์ | อาการ |
|---|---|---|---|
| B1 | 🔴 สูง | `packages/bruno-electron/src/ipc/network/index.js:1670-1673` | `bru.setEnvVar()` ใน script ไม่ persist ไป request ถัดไปใน runner |
| B2 | 🔴 สูง | `network/index.js:1670-1673` + `network/index.js:517-532` | ค่า dataset/runtime variables รั่วเข้า environment ของ UI |
| B3 | 🟠 กลาง | `bruno-app/src/components/RunnerResults/index.jsx:499-616` | ปุ่ม Filter (Passed/Failed/Skipped) ไม่มีผลใน Table view ซึ่งเป็น view เริ่มต้น |
| B4 | 🟠 กลาง | `RunnerResults/index.jsx:100,196-209,278,525,806` | Table view/Data modal อ่าน dataset จาก local state ไม่ใช่ข้อมูลของ run จริง |
| B5 | 🟠 กลาง | `RunnerResults/index.jsx:235-258` | Run Again บังคับ `recursive: true` เสมอ ไม่ใช้ค่า `runnerInfo.isRecursive` ของ run เดิม |
| B6 | 🟡 ต่ำ | `collections/index.js:3309-3318` | error ใน `testrun-ended` ถูก reducer ทิ้ง ผู้ใช้ไม่เห็นสาเหตุที่รันล้มเหลว |
| B7 | 🟡 ต่ำ | `bruno-app/src/utils/common/parseDataFile.js` | Dead code + CSV parser พฤติกรรมต่างจากตัวจริงฝั่ง electron |
| B8 | 🟡 ต่ำ | `bruno-electron/src/ipc/filesystem.js:48-78` | `renderer:load-runner-dataset` รับ path string ใด ๆ จาก renderer → อ่านไฟล์นอก workspace ได้ (เกี่ยวข้อง P0.3 ใน Improvement.md) |
| B9 | 🟡 ต่ำ | `network/index.js:2190-2193` | `bru.runner.stopExecution()` ใน iteration เดียว หยุดทุก dataset iterations ที่เหลือ |
| B10 | 🟡 ต่ำ | `network/index.js:1991` | 4xx/5xx response ไม่ส่งต่อ flag `__brunoDisableParsingResponseJson` ให้ `parseDataFromResponse` |
| B11 | 🟡 ต่ำ | `RunnerResults/index.jsx:99,319` | Delay input เป็น controlled input ที่ค่าเริ่มต้นเป็น `null` (React warning) และ `status === 'cancelled'` ที่เช็คไว้ไม่มีวันเกิด |
| B12 | 🟡 ต่ำ | `network/index.js:2143-2144` | testError fallback ใช้ `envVars`/`runtimeVariables` ตัวเดิมแทน `currentEnvVars`/`currentRuntimeVars` (ไม่สอดคล้องกับที่ส่งเข้า runtime) |

---

## 2. รายละเอียดบัคระดับสูง

### B1 — `bru.setEnvVar` หายระหว่าง request ใน Runner (regression)

**ตำแหน่ง:** `packages/bruno-electron/src/ipc/network/index.js:1670-1673`

```js
const currentRuntimeVars = runtimeVariables;
const currentEnvVars = currentRuntimeVars
  ? { ...envVars, ...currentRuntimeVars }
  : envVars;
```

**กลไกที่พัง:** script runtime (`bruno-js/src/bru.js:213`) mutate `this.envVariables` แบบ in-place บน object ที่ถูกส่งเข้ามา — พฤติกรรมเดิมของ runner คือส่ง `envVars` ตัวเดียวกันทุก request ทำให้ mutation persist ข้าม request แต่ตอนนี้ทุก request สร้าง `currentEnvVars` เป็น **spread copy ใหม่** แล้วส่ง copy เข้า `runPreRequest`/`runPostResponse`/`runTests` — script เขียนค่าลง copy แล้ว copy ถูกทิ้ง request ถัดไป rebuild จาก `envVars` ตัวเดิมที่ไม่เคยถูกอัปเดต

**Repro:** Request 1 มี post-response script `bru.setEnvVar('token', res.body.token)` → Request 2 ใช้ `{{token}}` หรือ `bru.getEnvVar('token')` → ได้ค่าเดิม/undefined (flow login → authenticated request ที่ใช้กันทั่วไปพังทั้งหมด)

**หมายเหตุ:** `bru.setVar` (runtime variable) ยัง persist เพราะ `currentRuntimeVars` เป็น reference เดียวกับ `runtimeVariables` — ทำให้บัคนี้สังเกตยากขึ้นเพราะพังเฉพาะฝั่ง env var

**แนวทางแก้:** เลิก merge — ส่ง `envVars` ตัวจริงกลับไปเหมือนเดิม การ interpolation มี precedence `runtimeVars > envVars` อยู่แล้ว (ดู comment ที่ `network/index.js:389`) ดังนั้น dataset row ที่ถูก merge เข้า `runtimeVariables` ต่อ iteration ก็ override ได้ครบโดยไม่ต้องยัดเข้า envVars ถ้าต้องการให้ `bru.getEnvVar` เห็นค่า dataset ให้ทำใน bru layer ไม่ใช่ปน object กัน

### B2 — Dataset variables รั่วเข้า Environment ใน UI

**ตำแหน่ง:** ต้นเหตุเดียวกับ B1 + `sendVariableUpdates` (`network/index.js:526-532`)

`result.envVariables` ที่ script runtime คืนมา คือ `currentEnvVars` ที่มี dataset row + runtime vars ปนอยู่ และถูกส่งผ่าน `main:script-environment-update` ไปอัปเดต environment ใน redux ฝั่ง renderer → คอลัมน์จากไฟล์ CSV/JSON กลายเป็น environment variables ใน UI และเสี่ยงถูกบันทึกลงไฟล์ environment จริงถ้าผู้ใช้กด save

**Repro:** รัน collection ด้วย dataset ที่มีคอลัมน์ `username` และมี request ที่มี script (อะไรก็ได้ที่ trigger variable update) → เปิดหน้า environment จะเห็น `username` โผล่เป็น env var

**แนวทางแก้:** แก้ B1 แล้วบัคนี้หายเอง (envVariables ที่ส่งกลับจะเป็น environment ล้วน ๆ)

---

## 3. รายละเอียดบัคระดับกลาง/ต่ำ

### B3 — Filter ไม่ทำงานใน Table view

Table view (view เริ่มต้น) ใช้ `items` ตรง ๆ ที่ `RunnerResults/index.jsx:513-519` ขณะที่ `filteredItems` ถูกใช้เฉพาะ List view — กดปุ่ม Passed/Failed แล้วตัวเลข count เปลี่ยนแต่แถวในตารางไม่เปลี่ยน **แก้:** filter `iterItems` ด้วย `activeFilterConfig.predicate` หรือซ่อน filter bar เมื่ออยู่ใน table view

### B4 — Table view ผูกกับ local `dataset` state แทนข้อมูล run จริง

- `useState(() => get(collection, 'runnerConfiguration.dataset', null))` อ่านครั้งเดียวตอน mount และ useEffect ที่ sync config (`index.jsx:196-209`) sync เฉพาะ `delay/iterations/runInParallel` **ไม่ sync dataset**
- ถ้าเริ่มรันจาก sidebar (`RunCollectionItem` ซึ่งเก็บ dataset ใน state ของตัวเอง) ขณะที่ RunnerResults ถูก mount อยู่แล้ว → คอลัมน์ "Data" ใน table แสดง "No dataset data" ทั้งที่รันด้วย dataset จริง
- `iterationCount` ที่ใช้ pad แถว iteration (`index.jsx:278,514`) มาจาก local state ไม่ใช่ `runnerInfo.iterationCount` ของ run จริง

**แก้:** เก็บ dataset rows (หรือ row ต่อ iteration) ไว้ใน `runnerResult.info` ตอน `testrun-started` แล้วให้ UI อ่านจาก runnerResult เท่านั้น — จะทำให้ Run Again และ Data modal ตรงกับ run จริงเสมอ

### B5 — Run Again ไม่ตรงกับ run เดิม

`runAgain` (`index.jsx:246-257`) ส่ง `recursive: true` แบบ hardcode ทั้งที่ `runnerInfo.isRecursive` มีเก็บไว้ — run แบบ non-recursive จาก sidebar เมื่อกด Run Again จะกลายเป็น recursive และ `savedSelectedItems` อาจเป็นของ configure-run ครั้งก่อนที่ไม่เกี่ยวกับ run ล่าสุด

### B6 — Error ตอนจบ run หายเงียบ

Runner ฝั่ง electron catch error ระดับ run แล้วส่ง `testrun-ended` พร้อม field `error` (`network/index.js:2230-2236`) แต่ reducer (`collections/index.js:3309-3318`) อ่านเฉพาะ `runCompletionTime`/`statusText` — UI เห็นแค่ "ended" ไม่รู้สาเหตุ และเนื่องจาก handler catch ไว้แล้ว `invoke()` resolve ปกติ toast ฝั่ง actions ก็ไม่ขึ้น

### B7 — `parseDataFile.js` เป็น dead code ที่พฤติกรรมต่างจาก parser จริง

เพิ่มมาใน commit ล่าสุด (9f84aa8) แต่ไม่มีที่ไหน import (ทั้ง browser path ก็ส่ง raw content ให้ server parse ด้วย `parseRunnerDataset` อยู่แล้ว) และตัว parser เองมีปัญหา: split บรรทัดก่อน parse (quoted field ที่มี newline พัง), ปน `\t` เป็น delimiter, trim ค่าใน quotes, ไม่มี `__proto__` guard, ไม่มี row/size limit, ตรวจ JSON จาก content ที่ขึ้นต้นด้วย `[` ทับ extension **แก้:** ลบไฟล์ทิ้ง หรือถ้าจะรองรับ parse ฝั่ง client จริงให้ย้าย `runner-dataset.js` ไป shared package เดียว

### B8 — `renderer:load-runner-dataset` รับ absolute path ใด ๆ

`filesystem.js:61-77` — เมื่อ argument เป็น string จะอ่านไฟล์ path นั้นตรง ๆ (จำกัดแค่ 10MB + นามสกุล .json/.csv) ผ่าน browser bridge นี่คือ primitive อ่านไฟล์ .csv/.json ใด ๆ บนเครื่อง host เช่น ไฟล์ config ที่เป็น JSON array ตรงเงื่อนไขนี้ตรงกับช่องโหว่กลุ่ม Filesystem boundary ที่ `Improvement.md` ระบุไว้แล้ว (P0.3) — เพิ่มน้ำหนักว่าควรเริ่ม P0 security เร็ว

### B9 — `stopExecution` ตัดทุก iterations

`terminateRunnerExecution` break ออกจาก while ทั้งก้อน (`network/index.js:2190-2193`) — ถ้า design ตั้งใจให้หยุดทั้ง run ก็ควร document ไว้; ถ้าอิงพฤติกรรมแบบ Postman ควรหยุดเฉพาะ iteration ปัจจุบันแล้วไปต่อ iteration ถัดไป

### B10–B12

- **B10:** `parseDataFromResponse(error.response)` ที่ `network/index.js:1991` ไม่ส่ง `request.__brunoDisableParsingResponseJson` ต่างจาก success path ที่ `:1951`
- **B11:** `value={delay}` เริ่มที่ `null` → React controlled-input warning; และเงื่อนไข `runnerInfo?.status === 'cancelled'` ที่ `index.jsx:213` ไม่มีทางจริงเพราะ reducer set ได้แค่ `started`/`ended`
- **B12:** fallback ของ `testResults` เมื่อ test พัง (`network/index.js:2143-2144`) อ้าง `envVars`/`runtimeVariables` ตัวนอก ไม่ใช่ `currentEnvVars`/`currentRuntimeVars` — inconsistency เฉย ๆ แต่ควรเก็บให้ตรงตอนแก้ B1

---

## 4. ควร Improve อะไรก่อน (ลำดับแนะนำ)

### ขั้นที่ 1 — แก้บัคก่อนเริ่ม roadmap (ทำทันที, ~2-3 วัน)

1. **แก้ B1+B2+B12 พร้อมกัน** — ยกเลิกการ merge `currentEnvVars` ให้กลับไปใช้ `envVars` shared reference (dataset ยังทำงานผ่าน `runtimeVariables` ครบ)
2. **เพิ่ม regression test**: run 2 requests ที่ request แรก `setEnvVar` แล้ว request สองต้องเห็นค่า / dataset column ต้องไม่โผล่ใน `main:script-environment-update`
3. **แก้ B3** (filter ใน table view) และ **B6** (แสดง error ของ testrun-ended) — งานเล็ก impact ชัด
4. **ลบ `parseDataFile.js`** (B7)

### ขั้นที่ 2 — เก็บงาน dataset feature ให้จบ (สัปดาห์เดียวกัน)

5. **แก้ B4** — เก็บ dataset rows ใน `runnerResult` ตอน `testrun-started` ให้ UI อ่านจาก run จริง
6. **แก้ B5** — Run Again ใช้ `runnerInfo.isRecursive` และ config ของ run ล่าสุด
7. ตัดสินใจ + document พฤติกรรม `stopExecution` ข้าม iterations (B9)
8. แก้ B10, B11 เก็บตก

### ขั้นที่ 3 — เข้าสู่ roadmap เดิมใน Improvement.md

ลำดับใน `Improvement.md` ยังเหมาะสม ไม่ต้องแก้ — เริ่มที่ **P0.1 (Bridge auth + loopback binding)** และ **P0.3 (Filesystem sandbox)** โดย B8 เป็นหลักฐานเพิ่มว่า P0.3 ควรครอบคลุม handler ทุกตัวที่รับ path จาก renderer รวมถึง `renderer:load-runner-dataset`, `renderer:browse-pac-file`, `renderer:resolve-path`

ข้อเสนอเพิ่มจากการตรวจรอบนี้ (ยังไม่อยู่ใน Improvement.md):

- **Runner variable-flow test suite** — บัค B1 หลุดมาได้เพราะไม่มี test ครอบ env/runtime variable persistence ใน runner loop ควรมี integration test ระดับ `runCollectionFolderHandler` ก่อนเริ่ม refactor ใหญ่ (P0.5 typed RPC) ไม่งั้น refactor จะพังแบบเงียบ ๆ อีก
- **รวม dataset parser เป็น module เดียว** ใน shared package พร้อม limit เดียวกัน (10MB / 10,000 rows / blocked keys) ให้ Desktop, Browser bridge และ CLI ใช้ร่วมกัน — สอดคล้องหลัก "One core, multiple shells"
- **Parallel run ควรระบุ resource limit** — ตอนนี้ `runInParallel` ยิงทุก iteration พร้อมกันไม่มี concurrency cap (dataset 10,000 แถว = 10,000 concurrent chains) ควรมี pool เช่น 5-10 พร้อม config

---

## 4.1 สถานะการ implement Section 9 quick wins (อัปเดตหลังลงมือทำ)

ทำเสร็จแล้วใน `packages/bruno-server`:

- Loopback bind เป็นค่าเริ่มต้น (`BRUNO_SERVER_HOST`, default `127.0.0.1`)
- Origin allowlist สำหรับ HTTP CORS และ WebSocket `verifyClient` — default อนุญาตเฉพาะ loopback origin, ขยายได้ผ่าน `BRUNO_SERVER_ALLOWED_ORIGINS` (`security/origin-policy.js`)
- ปิด `terminal:*` และ git clone/connect/disconnect ตามค่าเริ่มต้น, เปิดผ่าน `BRUNO_SERVER_ENABLE_PRIVILEGED_CHANNELS=true` (`security/privileged-channels.js`)
- WebSocket: `maxPayload` 64KB, heartbeat ping/pong 30s พร้อม terminate connection ค้าง, message rate limit 50 msg/10s
- ลด JSON/urlencoded body limit จาก 100mb → 25mb (`BRUNO_SERVER_JSON_LIMIT`)
- **P0.3 Filesystem Sandbox แบบ coarse (opt-in)** — `security/allowed-roots.js` + unit tests (`security/__tests__/allowed-roots.spec.js`, ครอบ traversal + symlink escape): ปิดอยู่โดยดีฟอลต์ (ไม่กระทบพฤติกรรมเดิม), เปิดผ่าน `BRUNO_SERVER_ALLOWED_ROOTS` แล้วจะสแกน argument ทุกตัวของทุก IPC call (รวม nested object/array ลึก 3 ชั้น) หา absolute path แล้วเช็คว่าอยู่ใน root ที่อนุญาตไหม (resolve ผ่าน ancestor ที่มีจริงก่อน realpath กัน symlink escape)

**ข้อจำกัดที่ตั้งใจปล่อยไว้ (ต้องรู้ก่อนใช้งานจริง):** ตัวสแกนนี้เป็น generic เดาจาก "string ที่หน้าตาเหมือน absolute path" ไม่รู้ semantic รายช่อง — จาก audit พบว่ามี **~85+ handler** ใน `bruno-electron/src/ipc/` ที่รับ path จาก renderer โดยรูปแบบ argument ไม่เหมือนกันเลย (positional, nested ในอ็อบเจ็กต์, array, source/dest คู่) และมีแค่ 5 handler เท่านั้นที่เคย validate path เอง (`validatePathIsInsideCollection` ใน 4 จุด + inline check ใน `renderer:delete-transient-requests`) ตัว sandbox นี้จึงเป็น **safety net เสริม** ไม่ใช่ per-channel validation ที่สมบูรณ์ — มี extension point `CHANNEL_PATH_EXTRACTORS` ในไฟล์เดียวกันสำหรับเพิ่มความแม่นยำทีละ channel ในอนาคตโดยไม่ต้องแก้ chokepoint

ยังไม่ทำ (เกินขอบเขต quick win): threat model doc (#1), static RPC manifest audit ของ handler ทั้ง 202+ ตัว (#8), UX prototype file explorer (#10)

### P0.1 Bootstrap token + session/CSRF auth — เสร็จแล้ว (opt-in, ปิดเป็นค่าเริ่มต้น)

ทำเสร็จทั้ง server และ frontend:

- **`security/auth.js`** — สร้าง bootstrap token แบบสุ่ม (32 bytes hex) ตอน server start เมื่อ `BRUNO_SERVER_REQUIRE_AUTH=true` เท่านั้น (ดีฟอลต์ปิด = ไม่มี behavior เปลี่ยนเลย), พิมพ์ token ลง console ครั้งเดียว ไม่มีที่อื่น log ซ้ำ; session เก็บใน in-memory Map (TTL 24 ชม.), เทียบ token/CSRF ด้วย `crypto.timingSafeEqual` กัน timing attack
- **`routes/auth.js`** — `GET /api/auth/status` (public, บอกว่า server ต้อง auth ไหม + session ปัจจุบัน valid ไหม), `POST /api/auth/session` (แลก bootstrap token เป็น HttpOnly+SameSite=Strict session cookie + คืน CSRF token ใน body), `DELETE /api/auth/session` (revoke)
- **`requireAuth` middleware** คุม `/api/ipc/*` ทั้งหมด: ไม่มี session → 401; method ที่เปลี่ยน state (ไม่ใช่ GET/HEAD/OPTIONS) ต้องมี header `X-CSRF-Token` ตรงกับ session ด้วย (double-submit pattern) ไม่งั้น 403 — กัน CSRF เพราะ cookie อย่างเดียวไม่ใช่หลักฐาน origin
- **`event-bridge.js`** WebSocket handshake เช็ค session cookie เดียวกันใน `verifyClient` ก่อน origin check ผ่านแล้วค่อย upgrade
- **`ipc-transport.js`** (frontend, `BrowserTransport`): เพิ่ม `ensureBridgeAuth()` เรียก `/api/auth/status` ครั้งแรกก่อน invoke ใดๆ — ถ้า server ไม่ต้อง auth ก็ผ่านทันทีไม่มีผลกระทบ; ถ้าต้อง auth จะ `window.prompt()` ขอ token แล้วแลก session, เก็บ CSRF token ไว้ใน `sessionStorage` (รอด reload หน้าโดยไม่ต้องถามใหม่ตราบใด cookie ยังไม่หมดอายุ), แนบ `X-CSRF-Token` + `credentials:'include'` ทุก request; ถ้าเจอ 401 กลางทาง (session หมดอายุ) จะ prompt ใหม่แล้ว retry คำขอนั้นอีกครั้งเดียว
- **Unit tests**: `security/__tests__/auth.spec.js` (14 เคส — token verify, session TTL/expiry ผ่าน mocked `Date.now`, middleware ทั้ง GET/POST/CSRF ผิดถูก, WS cookie check, cookie parsing)
- **Live verification ผ่าน curl**: บูต server ปิด auth → `/api/ipc/channels` ยัง 200 เหมือนเดิมทุกอย่าง, ไม่มี banner token ขึ้น; บูต server เปิด auth → `/api/ipc/*` ไม่มี cookie = 401, token ผิด = 401, token ถูกแลกได้ csrfToken + cookie, GET ด้วย cookie อย่างเดียวผ่าน, POST ไม่มี/ผิด CSRF = 403, POST ที่มี CSRF ถูกต้อง = 200, WS handshake ไม่มี cookie = 401 / มี cookie = 101 Switching Protocols

**ทำไมถึงเลือก opt-in แทนบังคับเปิดเป็นค่าเริ่มต้น**: การเปิด auth เปลี่ยน UX ของฟีเจอร์ที่ shipped ไปแล้ว (ผู้ใช้ browser mode ทุกคนจะโดน 401 จนกว่าจะไปคัดลอก token จาก console มาใส่) — ต่างจาก control อื่นๆ ใน P0 quick wins ที่ปลอดภัยแบบ transparent อยู่แล้ว ผู้ใช้เลือกให้สร้างโครงสร้างไว้ครบสมบูรณ์แต่ปิดไว้ก่อน (`BRUNO_SERVER_REQUIRE_AUTH=true` เพื่อเปิด) แทนที่จะบังคับ breaking change ทันที

### P0.6 Playwright browser-bridge project (#7) — เสร็จแล้ว

ก่อนหน้านี้ e2e suite ทั้งหมด (`playwright/index.ts` fixtures) รัน Electron จริงเท่านั้น — ไม่เคยมี test ไหนเดิน path ของ Browser Bridge (`bruno-app` ผ่าน browser จริงคุยกับ `bruno-server` ผ่าน HTTP/WS) เลยแม้แต่ครั้งเดียว ทั้งที่ P0.1/P0.3/origin-allowlist/privileged-channels ที่เพิ่งทำเสร็จทั้งหมดอยู่บน path นี้

- **`playwright.config.ts`** — เพิ่ม project ใหม่ `browser-bridge` (`testDir: ./tests/browser-bridge`, `baseURL: http://localhost:3000`, ไม่ใช้ `playwright/index.ts` fixtures เพราะไม่ใช่ Electron) และเพิ่ม `webServer` entry ที่สาม รัน `npm run dev:server` (bruno-server พอร์ต 4000) — เป็น idle process เฉย ๆ สำหรับ project อื่นที่ไม่แตะ bridge
- **`tests/browser-bridge/boot.spec.ts`** — บูตหน้า `bruno-app` จริงใน Chromium ธรรมดา (ไม่มี Electron preload) รอ `[data-app-state="loaded"]` แล้วเช็คว่า `window.ipcRenderer.isElectron === false` ยืนยันว่า `BrowserTransport` ถูกเลือกจริงตาม fallback logic
- **`tests/browser-bridge/api-surface.spec.ts`** — ยิง HTTP ตรงใส่ `bruno-server` (ไม่ผ่าน browser page): `GET /api/health`, `GET /api/ipc/channels`, IPC round-trip จริงผ่าน `POST /api/ipc/renderer:open-about`, unknown channel → 404
- **`tests/browser-bridge/security-defaults.spec.ts`** — regression guard สำหรับ default ที่ทำไว้ใน P0 ทั้งหมด บน fresh install (ไม่ตั้ง env var ใดๆ): origin allowlist reflect เฉพาะ loopback origin, privileged channel (`terminal:create`) โดนบล็อก 403, auth ปิดอยู่โดยดีฟอลต์ (`authRequired:false`, IPC เรียกได้ไม่ต้อง session), filesystem sandbox ปิดอยู่โดยดีฟอลต์ (path นอก sandbox ไม่โดน 403)
- เพิ่ม script `test:e2e:browser-bridge` ใน root `package.json`

**ผลรัน (verified จริง ไม่ใช่แค่ typecheck)**: 9/9 เทสต์ผ่านทั้งหมด — `api-surface.spec.ts` (4/4) และ `security-defaults.spec.ts` (4/4) ผ่านตรง ๆ ในรันแรกที่ `baseURL` ชี้ไปที่พอร์ต webServer จริง; `boot.spec.ts` ล้มเหลวครั้งแรกในรันร่วมเพราะพอร์ต 3000 ใน sandbox นี้ถูกใช้โดย service อื่นที่ไม่เกี่ยวข้องอยู่ก่อนแล้ว (`reuseExistingServer` เลยไม่สั่ง `dev:web` และ test ไปเจอหน้า login ของแอปอื่น) — ยืนยันว่าไม่ใช่บั๊กของโค้ดหรือ test โดยรัน `dev:web` แยกบนพอร์ตว่าง แล้วรัน `boot.spec.ts` เดี่ยว ๆ ชี้ `baseURL` ไปที่พอร์ตนั้นแทน ผ่าน 1/1 ยืนยันว่า test ถูกต้อง ปัญหาอยู่ที่ sandbox มี process อื่นจับพอร์ต 3000 ไว้ก่อน ไม่ใช่ปัญหาที่จะเกิดในเครื่อง dev/CI ปกติที่พอร์ต 3000 ว่าง

**ขอบเขตที่ตั้งใจไม่ครอบคลุม**: เป็น smoke test ระดับ boot + API surface + security default เท่านั้น ยังไม่ครอบคลุม UI-driven flow เต็มรูปแบบ (สร้าง/ส่ง request จริงผ่านฟอร์ม, runner, collection tree) ผ่าน Browser Bridge — ยังต้องพึ่ง Electron e2e suite เดิมสำหรับ UI flow เหล่านั้น เพราะ browser mode กับ Electron mode ใช้ UI component เดียวกัน ต่างกันแค่ transport layer ซึ่ง 4 ไฟล์นี้ครอบ transport layer นั้นโดยเฉพาะ

### P0.2 Channel Policy — rate limit/concurrency/timeout (เสร็จแล้ว, เปิดเป็นค่าเริ่มต้น) + capability taxonomy/payload limit/schema validation (เสร็จส่วนที่ทำได้อย่างปลอดภัย)

**Increment แรก (เสร็จแล้ว)** — "เพิ่ม rate limit, concurrency limit และ execution timeout" เพราะเป็นช่องโหว่ availability ที่ชัดเจนที่สุดที่ยังไม่มี guard เลย: `/api/ipc/:channel` ก่อนหน้านี้รับ request ได้ไม่จำกัดจำนวน/พร้อมกัน และไม่มี timeout ทำให้ handler ที่ค้าง (เช่น I/O แขวน) จะกัน HTTP response ไว้ตลอดไปและใช้ resource ฝั่ง server ไม่จำกัด

- **`security/ipc-limits.js`** — sliding-window rate limit (`BRUNO_SERVER_IPC_RATE_LIMIT`, default 200 req/`BRUNO_SERVER_IPC_RATE_WINDOW_MS` default 10s), concurrency slot ต่อ client (`BRUNO_SERVER_IPC_MAX_CONCURRENT`, default 40), execution timeout (`BRUNO_SERVER_IPC_TIMEOUT_MS`, default 30s) — คีย์ client ด้วย session ID เมื่อเปิด auth (P0.1) ไม่งั้น fallback เป็น IP เหมือน WS rate limiter เดิม
- ผูกเข้า `routes/ipc-proxy.js`: เกิน rate limit หรือ concurrency slot เต็ม → `429`, handler ไม่ตอบทันเวลา → `504` (release concurrency slot ใน `finally` เสมอ ไม่ว่า success/error/timeout)
- ค่าเริ่มต้นตั้งใจให้กว้าง (ไม่กระทบการใช้งานปกติ) ต่างจาก auth (P0.1) ที่เป็น breaking change — อันนี้เป็น availability safety net ล้วนๆ เลยเปิดเป็นค่าเริ่มต้นได้โดยไม่ต้องถามผู้ใช้ก่อนเหมือน P0.1

**Increment ที่สอง (เสร็จแล้ว)** — capability taxonomy ต่อ channel, payload limit รายcapability, และ schema validation extension-point:

- **`handler-registry.js`**: เพิ่ม `_captureSourceFile()` เดินตาม call stack ตอน bruno-electron เรียก `ipcMain.handle()`/`on()` ผ่าน shim เพื่อจับไฟล์ต้นทางจริงของแต่ละ channel (mechanically-derived ไม่ใช่เดาจาก prefix ชื่อ channel) เก็บใน `_channelSource` map เข้าถึงผ่าน `getChannelSource(channel)` — เจอบั๊ก basename collision ระหว่าง `ipc/network/index.js` กับ `src/index.js` ของ bruno-server เอง (ทั้งคู่ basename เป็น `index.js`) แก้โดยเก็บ path segment พ่อแม่ไว้ 1 ชั้น (`network/index.js` vs `src/index.js`) ยืนยันด้วยการรัน server จริงแล้ว dump ผลเทียบ
- **`security/channel-capabilities.js`** (ใหม่) — `SOURCE_TO_CAPABILITY` map ไฟล์ต้นทาง → 1 ใน 13 capability (`collections`, `workspace`, `environments`, `git`, `filesystem`, `preferences`, `system`, `notifications`, `apispec`, `terminal`, `network`, `ai`, `ui`) + `CHANNEL_CAPABILITY_OVERRIDES` สำหรับ channel ที่ capability จริงไม่ตรงกับไฟล์ที่มันอยู่ (เช่น `renderer:connect/disconnect-collection-from-git` อยู่ใน `ipc/workspace.js` แต่ควรเป็น `git`) — `getCapability(channel, sourceFile)` เป็น entry point
- **`security/channel-policy.js`** (ใหม่) — `getMaxPayloadBytes()` จำกัด payload เข้มกว่า global `BRUNO_SERVER_JSON_LIMIT` (25mb) เฉพาะ capability ที่พิสูจน์ได้ว่าไม่ควรมี payload ใหญ่จริง ๆ (`ui`/`system`/`notifications` = 8-16KB) ส่วน capability อื่น (collections/filesystem/network/git/ai ฯลฯ) ปล่อยผ่าน global limit เดิม เพราะมันมีเหตุผลที่ต้องรับไฟล์/request body ขนาดใหญ่จริง ตัดสินใจแบบนี้เพื่อไม่เดาตัวเลขที่อาจไปพังการอัปโหลด/import จริง; `validateArgs()` เช็ค `args` ต้องเป็น array เสมอ (400 ถ้าไม่ใช่) + `CHANNEL_SCHEMAS` extension point ที่ใส่ schema จริงให้กลุ่มความเสี่ยงสูงที่ตรวจสอบ signature มาแล้ว: `renderer:clone-git-repository`, `renderer:connect-collection-to-git`, `renderer:disconnect-collection-from-git`, `terminal:create/input/resize/kill/list-sessions`
- ผูกทั้งสองเข้า `routes/ipc-proxy.js`: payload เกิน cap ต่อ capability → `413`, args ไม่ใช่ array หรือไม่ตรง schema ที่ลงทะเบียนไว้ → `400` (เช็คก่อน allowed-roots/privileged-channel gate เดิม) และ `GET /api/ipc/channels` ตอนนี้คืน `capabilities: [{channel, capability}, ...]` ให้เห็นว่า channel ไหนอยู่ capability ไหน เผื่อใช้ต่อฝั่ง frontend ในอนาคต
- **Unit tests**: `security/__tests__/channel-capabilities.spec.js` (4 เคส — สำคัญที่สุดคือเทียบกับ fixture `real-channel-sources.json` ซึ่งเป็น snapshot ของ channel→sourceFile จริงจากการรัน server จริงแล้ว dump ยืนยันว่าไม่มี channel จริงตัวไหน resolve เป็น `'unknown'` และทุก capability ทั้ง 13 ตัวมีอย่างน้อย 1 channel จริงใช้งานอยู่), `security/__tests__/channel-policy.spec.js` (11 เคส — payload cap ต่อ capability, args-array validation, schema pass/fail ครบทุก schema ที่ลงทะเบียน) — suite รวมทั้งแพ็กเกจตอนนี้ 45/45 ผ่าน
- **Live verification ผ่าน curl กับ server จริง** (`BRUNO_SERVER_ENABLE_PRIVILEGED_CHANNELS=true`): payload 20KB ไปที่ `renderer:open-about` (capability `ui`, cap 8KB) → `413` ตรงตามคาด, `args` เป็น object แทน array ไปที่ `renderer:save-file` → `400`, string แทน object ไปที่ `renderer:clone-git-repository` argument 0 → `400`, string แทน object ไปที่ `terminal:resize` argument 1 → `400`, `renderer:open-about` args ว่างปกติ → `200`, `renderer:exists-sync` (capability `filesystem`, ไม่มี extra cap) → `200` ปกติ, `renderer:connect-collection-to-git` ที่ argument ถูก shape ทั้งหมดผ่าน validation ไปเจอ error จริงจาก git handler (`500` ไม่ใช่ `400`) ยืนยันว่า schema check ไม่ block การใช้งานที่ถูกต้อง — `GET /api/ipc/channels` ยืนยัน unknown count = 0 ตรงกับที่ unit test เช็ค

**ยังไม่ทำ (ตั้งใจเว้นไว้)**:
- **Capability grant flow / confirmation UX** สำหรับ action เสี่ยงสูง (เช่น terminal, git mutate) — ยังไม่ทำ เพราะเป็นการตัดสินใจ product/UX จริง ๆ คล้ายคำถาม bootstrap token ของ P0.1 (ต้องถามผู้ใช้ก่อน) การใส่ grant step ให้ capability ทั้งหมดรวมถึง core CRUD ปกติ (collections/workspace write) จะเป็น breaking UX change ใหญ่ ไม่ตรงกับเหตุผลที่ `privileged-channels.js` เดิมเขียนไว้แล้วว่า channel เหล่านี้คือ "การใช้งานแก้ไขปกติในแอป ไม่ใช่ capability tier แยก" — 403 gate ของ privileged channels เดิม (terminal + git-mutate 3 ตัว) ยังทำงานเหมือนเดิม แค่ตอนนี้อธิบายได้ในเชิง capability model แล้ว
- **Schema validation ครบทั้ง ~203 handler** — ยังไม่ทำ เพราะเขียน/เทสต์ schema ทีละตัวโดยไม่ verify signature จริงของแต่ละตัวก่อน มีความเสี่ยงสูงที่จะพังการใช้งานจริงมากกว่าจะช่วยจับบั๊ก (false positive 400) — `CHANNEL_SCHEMAS` เป็น extension point ที่เพิ่ม schema ทีละตัวได้ปลอดภัยเมื่อ verify signature แล้ว, ไม่ใช่ all-or-nothing

---

## 5. สิ่งที่ตรวจแล้วไม่พบปัญหา

- `runner-dataset.js` (parser ฝั่ง electron): ป้องกัน `__proto__`, BOM, quoted newline, duplicate header, row limit ครบ — คุณภาพดี
- Cancel flow ของ runner: abort controller ต่อ request + ต่อ run, delay cancellation มี cleanup listener ถูกต้อง
- Reducer routing แบบ `findLast` + `requestUid` รองรับ parallel iterations ถูกต้อง (มี test ครอบ)
- Payload limit ฝั่ง upload dataset (10MB) และ clamp iterations (1–10,000) ทั้ง UI และ actions ตรงกัน
