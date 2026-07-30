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

## 5. สิ่งที่ตรวจแล้วไม่พบปัญหา

- `runner-dataset.js` (parser ฝั่ง electron): ป้องกัน `__proto__`, BOM, quoted newline, duplicate header, row limit ครบ — คุณภาพดี
- Cancel flow ของ runner: abort controller ต่อ request + ต่อ run, delay cancellation มี cleanup listener ถูกต้อง
- Reducer routing แบบ `findLast` + `requestUid` รองรับ parallel iterations ถูกต้อง (มี test ครอบ)
- Payload limit ฝั่ง upload dataset (10MB) และ clamp iterations (1–10,000) ทั้ง UI และ actions ตรงกัน
