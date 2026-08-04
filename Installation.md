# Bruno Installation Guide / คู่มือการติดตั้ง Bruno

เอกสารนี้อธิบายการติดตั้งและใช้งาน Bruno จาก source code สองรูปแบบอย่างชัดเจน:

1. **Browser** — React UI ทำงานในเว็บเบราว์เซอร์ และติดต่อ Bruno Bridge Server ผ่าน HTTP/WebSocket
2. **Desktop** — React UI ทำงานใน Electron และใช้ native desktop integration

This guide explains how to install and run Bruno from source in two distinct modes:

1. **Browser** — the React UI runs in a web browser and communicates with Bruno Bridge Server over HTTP/WebSocket.
2. **Desktop** — the React UI runs in Electron with native desktop integration.

---

# ภาษาไทย

## 1. เลือกรูปแบบการใช้งาน

| หัวข้อ             | Browser                                                       | Desktop                                                  |
| ------------------ | ------------------------------------------------------------- | -------------------------------------------------------- |
| หน้าจอ             | Chrome, Edge, Firefox หรือ Safari                             | Electron application                                     |
| Process ที่ต้องรัน | Web UI และ Bridge Server                                      | Electron และ Web dev server ในโหมดพัฒนา                  |
| การเข้าถึงไฟล์     | ใช้ path บนเครื่องที่รัน Bridge Server                        | ใช้ native file dialog ของระบบปฏิบัติการ                 |
| Port เริ่มต้น      | Web UI มักเป็น `3000` หรือ port ว่างถัดไป; Bridge เป็น `4000` | Web dev server จะเลือก port และส่งให้ Electron อัตโนมัติ |
| เหมาะสำหรับ        | ใช้งานผ่าน browser, remote development, ทดสอบ Browser UI      | การใช้งานแบบ desktop เต็มรูปแบบและสร้าง installer        |

> [!IMPORTANT]
> Browser Bridge มีสิทธิ์อ่าน/เขียน filesystem และเรียก network จากเครื่องที่รัน server อย่าเปิด port `4000` สู่ Internet สาธารณะ และควรใช้งานเฉพาะเครื่องหรือเครือข่ายที่เชื่อถือได้

## 2. ความต้องการของระบบ

- Git
- Node.js **24.x** หรือ Node.js LTS รุ่นล่าสุดที่เข้ากันได้
- npm ซึ่งติดมากับ Node.js
- สิทธิ์อ่าน/เขียนในโฟลเดอร์ source และโฟลเดอร์ collection
- สำหรับการ build Desktop อาจต้องมี native build tools ของแต่ละระบบ

ตรวจสอบเวอร์ชัน:

```text
node --version
npm --version
git --version
```

ควรเห็น Node.js เป็น `v24.x.x` หากใช้ Node เวอร์ชันอื่นแล้วพบปัญหา native module ให้เปลี่ยนเป็น Node 24 และติดตั้ง dependencies ใหม่

## 3. เตรียมเครื่องตามระบบปฏิบัติการ

### Windows

เปิด PowerShell แบบปกติ:

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
```

ปิดและเปิด PowerShell ใหม่ แล้วตรวจสอบ:

```powershell
node --version
npm --version
git --version
```

หาก native module ต้อง compile ให้ติดตั้ง Visual Studio Build Tools และเลือก workload **Desktop development with C++** รวมทั้ง Windows SDK

### macOS

ถ้ามี Homebrew:

```bash
brew install git node@24
```

หรือใช้ nvm:

```bash
nvm install 24
nvm use 24
```

ติดตั้ง compiler tools สำหรับ native modules:

```bash
xcode-select --install
```

### Linux

Ubuntu/Debian:

```bash
sudo apt update
sudo apt install -y git build-essential python3 pkg-config
```

Fedora/RHEL:

```bash
sudo dnf install -y git gcc-c++ make python3 pkgconf-pkg-config
```

ติดตั้ง Node.js 24 ด้วย package manager ที่เชื่อถือได้หรือ nvm:

```bash
nvm install 24
nvm use 24
```

## 4. ดาวน์โหลด source และติดตั้ง dependencies

แทน `<REPOSITORY_URL>` ด้วย URL ของ repository ที่มี Browser Bridge ชุดนี้

### Windows PowerShell

```powershell
git clone <REPOSITORY_URL> bruno
Set-Location bruno
npm run setup
```

### macOS และ Linux

```bash
git clone <REPOSITORY_URL> bruno
cd bruno
npm run setup
```

`npm run setup` จะดำเนินการดังนี้:

- ล้าง `node_modules` เดิมใน workspace
- ติดตั้ง dependencies ด้วย `npm i --legacy-peer-deps`
- ติดตั้ง native `node-pty` package ให้ตรงกับระบบปฏิบัติการและ CPU
- build shared packages ที่ Bruno ใช้
- bundle JavaScript sandbox libraries

หากติดตั้ง dependencies ไว้แล้วและไม่ต้องการให้ setup ล้าง `node_modules` สามารถใช้:

```text
npm install --legacy-peer-deps
```

จากนั้นต้อง build shared packages ตามรายการใน `contributing.md` ก่อนเริ่มใช้งาน

---

## 5. ติดตั้งและใช้งานแบบ Browser

### 5.1 เริ่ม Browser แบบ Development — วิธีแนะนำ

คำสั่งเดียวกันใช้ได้บน Windows PowerShell, macOS และ Linux:

```text
npm run dev:browser
```

คำสั่งนี้รันพร้อมกันสอง process:

- Bruno Bridge Server: `http://localhost:4000`
- React development server: โดยทั่วไป `http://localhost:3000`; ถ้า port ถูกใช้งาน ระบบอาจเลือก `3001` หรือ port ถัดไป

เปิด URL ที่แสดงหลังข้อความ `Local:` ใน terminal

### 5.2 เริ่ม Browser แยก Terminal

เหมาะสำหรับตรวจ log แยกระหว่าง frontend และ bridge

Terminal 1 — Bridge Server:

```text
npm run dev:server
```

Terminal 2 — Web UI:

```text
npm run dev:web
```

### 5.3 ตรวจสอบ Bridge Server

Windows PowerShell:

```powershell
Invoke-RestMethod http://localhost:4000/api/health
Invoke-RestMethod http://localhost:4000/api/ipc/channels
```

macOS/Linux:

```bash
curl http://localhost:4000/api/health
curl http://localhost:4000/api/ipc/channels
```

Health response ต้องมี `"status":"ok"` และ `"mode":"bridge-server"`

### 5.4 รัน Browser จาก Production Build

Build frontend ก่อน:

```text
npm run build:web
```

จากนั้นเปิดสอง terminal

Terminal 1:

```text
npm run start --workspace=packages/bruno-server
```

Terminal 2:

```text
npm run preview --workspace=packages/bruno-app
```

เปิด URL ที่ preview server แสดงใน terminal ห้ามเปิด `packages/bruno-app/dist/index.html` โดยตรงด้วย `file://` เพราะ routing และ static assets ต้องทำงานผ่าน HTTP server

### 5.5 การเลือก Collection, Workspace และไฟล์ใน Browser

Browser ไม่สามารถเปิด native file picker แล้วส่ง absolute path ของเครื่อง Bridge Server ได้อย่างปลอดภัย ดังนั้น Bruno จะขอให้กรอก path ของเครื่องที่รัน Bridge Server

ตัวอย่าง Windows:

```text
C:\Users\alice\Documents\bruno\MyCollection
```

ตัวอย่าง macOS:

```text
/Users/alice/Documents/bruno/MyCollection
```

ตัวอย่าง Linux:

```text
/home/alice/Documents/bruno/MyCollection
```

สำหรับหลาย path ให้แยกแต่ละ path ด้วยบรรทัดใหม่ จากนั้น Bridge จะตรวจสอบว่าไฟล์หรือโฟลเดอร์มีอยู่จริงก่อนใช้งาน

### 5.6 ข้อมูลและ Preferences ของ Browser Bridge

Browser Bridge ใช้โฟลเดอร์ข้อมูลต่อไปนี้:

- Windows: `%USERPROFILE%\.config\bruno`
- macOS: `~/.config/bruno`
- Linux: `~/.config/bruno`

Collections และ Workspaces ยังอยู่ในตำแหน่งที่ผู้ใช้เลือก ไม่ได้ถูกย้ายเข้าโฟลเดอร์ config

### 5.7 รัน Browser Bridge ด้วย Docker

`packages/bruno-server/Dockerfile` build image เดียวที่มีทั้ง Bridge API/WebSocket และ bruno-app production build (static frontend) รวมกัน ไม่ต้องรันสอง process แยกแบบข้อ 5.4

Build context ต้องเป็น root ของ monorepo (ไม่ใช่ `packages/bruno-server`) เพราะ Bridge ต้อง require โมดูลจาก `packages/bruno-electron` โดยตรง:

```text
docker build -f packages/bruno-server/Dockerfile -t bruno-bridge .
```

รัน container โดยกำหนด `BRUNO_SERVER_ALLOWED_ROOTS` ให้ตรงกับโฟลเดอร์ collection ที่ mount เข้ามา และ mount volume ให้ `USER_DATA_DIR` (`/home/node/.config/bruno` ภายใน container ซึ่งตรงกับข้อ 5.6) เพื่อให้ preferences/master key อยู่รอดข้าม container restart:

```text
docker run -d --name bruno-bridge \
  -p 4000:4000 \
  -v bruno-bridge-data:/home/node/.config/bruno \
  -v /home/alice/Documents/bruno:/collections \
  -e BRUNO_SERVER_ALLOWED_ROOTS=/collections \
  bruno-bridge
```

Image ออกแบบให้รันแบบ non-root (`node` user, uid 1000) และรองรับ read-only root filesystem — ถ้าต้องการความปลอดภัยเพิ่ม สามารถเพิ่ม `--read-only --tmpfs /tmp` ได้โดยไม่ต้องปรับ image (ตรวจสอบแล้วว่า container ยังผ่าน `HEALTHCHECK` และให้บริการ API/WebSocket/static frontend ได้ปกติภายใต้ flag นี้)

Environment variable ที่เกี่ยวข้อง (ดู `packages/bruno-server/THREAT_MODEL.md` สำหรับรายละเอียดเต็ม):

- `BRUNO_SERVER_ALLOWED_ROOTS` — allowlist ของ path ที่ Bridge อนุญาตให้เปิดเป็น collection (บังคับตั้งใน container เพราะไม่มี native file picker ยืนยันผู้ใช้)
- `BRUNO_SERVER_REQUIRE_AUTH` — บังคับ authentication ก่อนเรียก API
- `BRUNO_SERVER_ALLOWED_ORIGINS` — allowlist origin สำหรับ CORS
- `BRUNO_SERVER_BASE_PATH` — path prefix เมื่อ mount Bridge ไว้หลัง reverse proxy (เช่น `/bridge`) แทน origin root
- `BRUNO_SERVER_MASTER_KEY` / `BRUNO_SERVER_MASTER_KEY_PATH` — master key สำหรับเข้ารหัสข้อมูลที่ rest
- `BRUNO_SERVER_TLS_CERT_FILE` / `BRUNO_SERVER_TLS_KEY_FILE` — เปิด HTTPS/WSS แบบ bring-your-own certificate (ต้องตั้งคู่กันทั้งสองตัว ไม่งั้น server จะ fail fast ตอน start); ไม่ตั้งค่าทั้งคู่ก็ยังรันเป็น plain HTTP/WS เหมือนเดิม (ดูข้อ 5.7.1)
- `BRUNO_SERVER_TLS_CA_FILE` — certificate chain/intermediate เพิ่มเติม (optional, ใช้เมื่อ cert ไม่ใช่ self-signed และ client ต้องการ chain เต็ม)
- `BRUNO_SERVER_TLS_PASSPHRASE` — passphrase สำหรับ private key ที่เข้ารหัสไว้ (optional)

ค่า default ของ image ตั้ง `BRUNO_SERVER_HOST=0.0.0.0` (ต่างจาก default `127.0.0.1` ตอนรันแบบ bare-metal) เพราะขอบเขตความปลอดภัยของ container คือ network namespace ของตัว container เอง — จะเข้าถึงได้ก็ต่อเมื่อ operator เปิด port ออกมาอย่างชัดเจนด้วย `-p`/`--expose` เท่านั้น

#### 5.7.1 เปิด HTTPS/WSS (bring-your-own certificate)

Bridge รองรับ TLS แบบ opt-in — ไม่ตั้งค่าอะไรก็ยังรันเป็น plain HTTP/WS เหมือนเดิม (เหมาะกับตอนที่มี TLS-terminating reverse proxy อยู่ด้านหน้าอยู่แล้ว) ถ้าต้องการให้ Bridge เอง terminate TLS โดยตรง ให้ตั้ง `BRUNO_SERVER_TLS_CERT_FILE`/`BRUNO_SERVER_TLS_KEY_FILE` เป็น path ของไฟล์ certificate/private key (ต้องตั้งคู่กันทั้งสองตัว) WebSocket (`/ws/events`) จะกลายเป็น WSS โดยอัตโนมัติเพราะใช้ HTTP(S) server object เดียวกัน ไม่ต้องตั้งค่าเพิ่ม:

```text
docker run -d --name bruno-bridge \
  -p 4000:4000 \
  -v bruno-bridge-data:/home/node/.config/bruno \
  -v /home/alice/Documents/bruno:/collections \
  -v /home/alice/certs:/certs:ro \
  -e BRUNO_SERVER_ALLOWED_ROOTS=/collections \
  -e BRUNO_SERVER_TLS_CERT_FILE=/certs/fullchain.pem \
  -e BRUNO_SERVER_TLS_KEY_FILE=/certs/privkey.pem \
  bruno-bridge
```

Bridge ตรวจสอบ path ทั้งสองตอน start (fail fast ถ้าไฟล์อ่านไม่ได้ หรือตั้งค่าแค่ตัวใดตัวหนึ่ง) — ดู `packages/bruno-server/src/config-validation.js` ตัวเดียวกับที่ validate ค่า env var อื่นทั้งหมด รับผิดชอบเฉพาะการ terminate TLS เท่านั้น ไม่รวม certificate provisioning/renewal (ACME, Let's Encrypt ฯลฯ) เป็น decision ที่ตั้งใจปล่อยให้ operator เลือก tool เอง (เช่น reverse proxy ที่ทำ ACME renewal แล้ว mount cert เข้ามาให้ Bridge อ่าน)

### 5.8 หยุด Browser

กด `Ctrl+C` ใน terminal ที่รัน `npm run dev:browser` หรือกด `Ctrl+C` ในทั้งสอง terminal ถ้ารันแยกกัน

---

## 6. ติดตั้งและใช้งานแบบ Desktop

### 6.1 เริ่ม Desktop แบบ Development — วิธีแนะนำ

ใช้ได้บน Windows, macOS และ Linux:

```text
npm run dev
```

คำสั่งนี้จะ:

1. เริ่ม React development server
2. ตรวจจับ port ที่ React ใช้งานจริง
3. เริ่ม Electron พร้อมกำหนด `BRUNO_DEV_PORT` ให้ตรงกับ port นั้น

### 6.2 เริ่ม Desktop แยก Terminal

Terminal 1:

```text
npm run dev:web
```

ดู port จากบรรทัด `Local:` แล้วเปิด Terminal 2

Windows PowerShell ตัวอย่างเมื่อ frontend ใช้ port `3000`:

```powershell
$env:BRUNO_DEV_PORT = "3000"
npm run dev:electron
```

macOS/Linux:

```bash
BRUNO_DEV_PORT=3000 npm run dev:electron
```

หากไม่กำหนด `BRUNO_DEV_PORT` Electron จะใช้ port `3000` เป็นค่าเริ่มต้น

### 6.3 ใช้ user data แยกสำหรับการทดสอบ Desktop

Windows PowerShell:

```powershell
$env:ELECTRON_USER_DATA_PATH = "$env:USERPROFILE\Desktop\bruno-test"
npm run dev:electron
```

macOS/Linux:

```bash
ELECTRON_USER_DATA_PATH="$HOME/Desktop/bruno-test" npm run dev:electron
```

ตัวแปรนี้มีผลใน development mode และช่วยป้องกันไม่ให้ test preferences ปะปนกับข้อมูลใช้งานจริง

### 6.4 Build Desktop Installer

ควร build บนระบบปฏิบัติการเป้าหมายโดยตรง เพราะ Electron มี native dependencies และข้อกำหนด signing ต่างกัน

คำสั่งแบบ cross-platform สำหรับ build ระบบปัจจุบัน:

```text
npm run build:web
npm run build:electron
```

ไฟล์ผลลัพธ์อยู่ที่:

```text
packages/bruno-electron/out
```

#### Windows

ใช้ PowerShell หรือ Command Prompt:

```text
npm run build:web
npm run build:electron
```

ผลลัพธ์หลักเป็น NSIS `.exe` สำหรับ `x64` และ/หรือ `arm64` ตาม environment ที่ build เมื่อเปิด installer ผู้ใช้สามารถเลือกตำแหน่งติดตั้ง และระบบจะสร้าง Desktop/Start Menu shortcut

ติดตั้งไฟล์ที่ build แล้วจาก PowerShell:

```powershell
$installer = Get-ChildItem packages\bruno-electron\out\*.exe | Select-Object -First 1
$installer.FullName
Start-Process $installer.FullName
```

#### macOS

```bash
npm run build:web
npm run build:electron:mac
```

ระบบสร้าง `.dmg`, `.pkg` และ `.zip` ตาม Electron Builder configuration สำหรับ `x64` และ `arm64`

เปิด DMG:

```bash
open packages/bruno-electron/out/*.dmg
```

หรือติดตั้ง PKG:

```bash
sudo installer -pkg packages/bruno-electron/out/*.pkg -target /
```

การแจกจ่ายภายนอกเครื่องอาจต้องใช้ Apple Developer certificate, code signing และ notarization หากไม่มี certificate ให้ใช้ development mode หรือปรับ signing configuration สำหรับ local build

#### Linux

AppImage:

```bash
npm run build:web
npm run build:electron:linux
chmod +x packages/bruno-electron/out/*.AppImage
packages/bruno-electron/out/*.AppImage
```

Debian/Ubuntu package:

```bash
npm run build:web
npm run build:electron:deb
sudo apt install ./packages/bruno-electron/out/*.deb
```

Fedora/RHEL package:

```bash
npm run build:web
npm run build:electron:rpm
sudo dnf install ./packages/bruno-electron/out/*.rpm
```

Snap package:

```bash
npm run build:web
npm run build:electron:snap
sudo snap install --dangerous packages/bruno-electron/out/*.snap
```

### 6.5 ติดตั้ง Desktop จากไฟล์ release ที่ build ไว้แล้ว

- Windows: เปิด `.exe` และทำตาม NSIS installer
- macOS: เปิด `.dmg` แล้วลาก Bruno ไปที่ Applications หรือใช้ `.pkg`
- Linux: ใช้ AppImage โดยไม่ต้องติดตั้ง หรือใช้ `.deb`, `.rpm`, `.snap` ให้ตรงกับ distribution

ไม่ต้องรัน Bridge Server สำหรับ Desktop App เพราะ Electron main process ทำหน้าที่แทน Bridge โดยตรง

---

## 7. Troubleshooting ภาษาไทย

### Port `3000`, `3001` หรือ `4000` ถูกใช้งาน

Windows PowerShell:

```powershell
Get-NetTCPConnection -LocalPort 3000,3001,4000 -ErrorAction SilentlyContinue
```

macOS/Linux:

```bash
lsof -i :3000
lsof -i :3001
lsof -i :4000
```

ตรวจสอบ process ให้ถูกต้องก่อนหยุด process นั้น Web UI สามารถเลือก port ถัดไปได้ แต่ Browser transport คาดว่า Bridge Server อยู่ที่ port `4000` ตามค่าเริ่มต้น

### Browser แสดง Loading ค้างหรือไม่พบ Collection

1. ตรวจว่า Bridge health เป็น `ok`
2. ตรวจ browser console และ terminal ของ Bridge
3. Reload หน้าเว็บหลัง Bridge พร้อมทำงาน
4. ตรวจว่า path ที่กรอกเป็น path ของเครื่อง Bridge Server ไม่ใช่ path ของเครื่อง client คนละเครื่อง
5. ตรวจว่า collection มี `bruno.json` หรือ `opencollection.yml`

### ติดตั้ง dependencies ไม่ผ่าน

ตรวจว่าใช้ Node 24 แล้วรัน:

```text
npm run setup
```

คำสั่งนี้จะติดตั้ง dependencies ใหม่ทั้ง workspace หากเป็น Windows และ error กล่าวถึง `node-gyp`, compiler หรือ `node-pty` ให้ตรวจ Visual Studio C++ Build Tools; macOS ให้ตรวจ Xcode Command Line Tools; Linux ให้ตรวจ `build-essential`/`gcc-c++`, `make`, Python 3 และ `pkg-config`

### Build Desktop ไม่ผ่านเพราะ signing

- Windows: local build ไม่ควรต้องมี publisher certificate เมื่อ configuration ปิด signing แต่ security software อาจเตือนไฟล์ unsigned
- macOS: distribution build อาจต้องมี Apple certificate และ notarization; ใช้ `npm run dev` สำหรับ local development
- Linux: ตรวจ package tools และ system libraries ให้ตรงกับ target format

---

# English

## 1. Choose a Runtime Mode

| Area               | Browser                                                              | Desktop                                                 |
| ------------------ | -------------------------------------------------------------------- | ------------------------------------------------------- |
| UI host            | Chrome, Edge, Firefox, or Safari                                     | Electron application                                    |
| Required processes | Web UI and Bridge Server                                             | Electron plus the web dev server during development     |
| File access        | Paths on the machine running Bridge Server                           | Native operating-system file dialogs                    |
| Default ports      | Web UI usually uses `3000` or the next free port; Bridge uses `4000` | The dev server selects a port and passes it to Electron |
| Best suited for    | Browser access, remote development, and Browser UI testing           | Full desktop integration and distributable installers   |

> [!IMPORTANT]
> Browser Bridge can read/write files and make network requests from the machine on which it runs. Do not expose port `4000` to the public Internet. Run it only on a trusted machine or trusted network.

## 2. System Requirements

- Git
- Node.js **24.x**, or a compatible current LTS release
- npm, included with Node.js
- Read/write access to the source, collection, and workspace directories
- Platform-native build tools when building the Desktop application

Verify the tools:

```text
node --version
npm --version
git --version
```

Node should normally report `v24.x.x`. If native modules fail under another Node release, switch to Node 24 and reinstall the dependencies.

## 3. Platform Preparation

### Windows

Open a regular PowerShell window:

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
```

Restart PowerShell and verify:

```powershell
node --version
npm --version
git --version
```

If a native module must be compiled, install Visual Studio Build Tools with the **Desktop development with C++** workload and a Windows SDK.

### macOS

With Homebrew:

```bash
brew install git node@24
```

Or with nvm:

```bash
nvm install 24
nvm use 24
```

Install native compiler tools:

```bash
xcode-select --install
```

### Linux

Ubuntu/Debian:

```bash
sudo apt update
sudo apt install -y git build-essential python3 pkg-config
```

Fedora/RHEL:

```bash
sudo dnf install -y git gcc-c++ make python3 pkgconf-pkg-config
```

Install Node.js 24 using a trusted package source or nvm:

```bash
nvm install 24
nvm use 24
```

## 4. Get the Source and Install Dependencies

Replace `<REPOSITORY_URL>` with the URL of the repository containing this Browser Bridge implementation.

### Windows PowerShell

```powershell
git clone <REPOSITORY_URL> bruno
Set-Location bruno
npm run setup
```

### macOS and Linux

```bash
git clone <REPOSITORY_URL> bruno
cd bruno
npm run setup
```

`npm run setup` performs the following operations:

- Removes existing `node_modules` directories in the workspace
- Installs dependencies with `npm i --legacy-peer-deps`
- Installs the correct native `node-pty` package for the operating system and CPU
- Builds Bruno's shared packages
- Bundles the JavaScript sandbox libraries

If dependencies are already installed and you do not want setup to remove `node_modules`, run:

```text
npm install --legacy-peer-deps
```

You must then build the shared packages listed in `contributing.md` before starting the application.

---

## 5. Browser Installation and Usage

### 5.1 Start Browser Development Mode — Recommended

The same command works in Windows PowerShell, macOS, and Linux:

```text
npm run dev:browser
```

This starts two processes:

- Bruno Bridge Server at `http://localhost:4000`
- React development server, normally at `http://localhost:3000`; it may use `3001` or another free port

Open the URL printed next to `Local:` in the terminal.

### 5.2 Start Browser Components in Separate Terminals

Terminal 1 — Bridge Server:

```text
npm run dev:server
```

Terminal 2 — Web UI:

```text
npm run dev:web
```

This arrangement is useful when inspecting frontend and Bridge logs separately.

### 5.3 Verify the Bridge Server

Windows PowerShell:

```powershell
Invoke-RestMethod http://localhost:4000/api/health
Invoke-RestMethod http://localhost:4000/api/ipc/channels
```

macOS/Linux:

```bash
curl http://localhost:4000/api/health
curl http://localhost:4000/api/ipc/channels
```

The health response must contain `"status":"ok"` and `"mode":"bridge-server"`.

### 5.4 Run the Browser Production Build

Build the frontend:

```text
npm run build:web
```

Then use two terminals.

Terminal 1:

```text
npm run start --workspace=packages/bruno-server
```

Terminal 2:

```text
npm run preview --workspace=packages/bruno-app
```

Open the URL printed by the preview server. Do not open `packages/bruno-app/dist/index.html` directly with `file://`; routing and static assets require an HTTP server.

### 5.5 Selecting Collections, Workspaces, and Files in Browser Mode

A browser cannot safely expose an absolute path from a native file picker to the remote Bridge machine. Bruno therefore asks for a path on the machine running Bridge Server.

Windows example:

```text
C:\Users\alice\Documents\bruno\MyCollection
```

macOS example:

```text
/Users/alice/Documents/bruno/MyCollection
```

Linux example:

```text
/home/alice/Documents/bruno/MyCollection
```

Enter multiple paths on separate lines. Bridge validates that each file or directory exists before using it.

### 5.6 Browser Bridge Data and Preferences

Browser Bridge stores application data in:

- Windows: `%USERPROFILE%\.config\bruno`
- macOS: `~/.config/bruno`
- Linux: `~/.config/bruno`

Collections and workspaces remain in the locations selected by the user; they are not moved into the configuration directory.

### 5.7 Run Browser Bridge with Docker

`packages/bruno-server/Dockerfile` builds a single image that bundles both the Bridge API/WebSocket server and the bruno-app production build (static frontend) — no need to run two separate processes as in section 5.4.

The build context must be the monorepo root (not `packages/bruno-server`), since the Bridge requires bruno-electron's modules directly:

```text
docker build -f packages/bruno-server/Dockerfile -t bruno-bridge .
```

Run the container with `BRUNO_SERVER_ALLOWED_ROOTS` set to match the collection directory you mount in, and a volume for `USER_DATA_DIR` (`/home/node/.config/bruno` inside the container, matching section 5.6) so preferences and the master key survive container restarts:

```text
docker run -d --name bruno-bridge \
  -p 4000:4000 \
  -v bruno-bridge-data:/home/node/.config/bruno \
  -v /home/alice/Documents/bruno:/collections \
  -e BRUNO_SERVER_ALLOWED_ROOTS=/collections \
  bruno-bridge
```

The image runs as a non-root user (`node`, uid 1000) and supports a read-only root filesystem — for extra hardening, add `--read-only --tmpfs /tmp` with no image changes required (verified: the container still passes its `HEALTHCHECK` and serves the API/WebSocket/static frontend normally under this flag).

Relevant environment variables (see `packages/bruno-server/THREAT_MODEL.md` for full details):

- `BRUNO_SERVER_ALLOWED_ROOTS` — allowlist of paths the Bridge may open as a collection (required in a container since there is no native file picker to confirm user intent)
- `BRUNO_SERVER_REQUIRE_AUTH` — require authentication before API calls succeed
- `BRUNO_SERVER_ALLOWED_ORIGINS` — CORS origin allowlist
- `BRUNO_SERVER_BASE_PATH` — path prefix when the Bridge is mounted behind a reverse proxy (e.g. `/bridge`) instead of the origin root
- `BRUNO_SERVER_MASTER_KEY` / `BRUNO_SERVER_MASTER_KEY_PATH` — master key for encrypting data at rest
- `BRUNO_SERVER_TLS_CERT_FILE` / `BRUNO_SERVER_TLS_KEY_FILE` — enable HTTPS/WSS with a bring-your-own certificate (both must be set together, or the server fails fast at startup); leaving both unset keeps plain HTTP/WS behavior (see 5.7.1)
- `BRUNO_SERVER_TLS_CA_FILE` — additional certificate chain/intermediate (optional, for non-self-signed certs where clients need the full chain)
- `BRUNO_SERVER_TLS_PASSPHRASE` — passphrase for an encrypted private key (optional)

The image defaults to `BRUNO_SERVER_HOST=0.0.0.0` (unlike the `127.0.0.1` default for a bare-metal install) because the container's own network namespace is the security boundary — it is only reachable once the operator explicitly publishes the port with `-p`/`--expose`.

#### 5.7.1 Enable HTTPS/WSS (bring-your-own certificate)

TLS is opt-in — with nothing set, the Bridge still runs plain HTTP/WS (the right choice when a TLS-terminating reverse proxy already sits in front of it). To have the Bridge terminate TLS itself, set `BRUNO_SERVER_TLS_CERT_FILE`/`BRUNO_SERVER_TLS_KEY_FILE` to the certificate/private key file paths (both must be set together). The WebSocket endpoint (`/ws/events`) automatically becomes WSS with no extra config, since it shares the same underlying HTTP(S) server object:

```text
docker run -d --name bruno-bridge \
  -p 4000:4000 \
  -v bruno-bridge-data:/home/node/.config/bruno \
  -v /home/alice/Documents/bruno:/collections \
  -v /home/alice/certs:/certs:ro \
  -e BRUNO_SERVER_ALLOWED_ROOTS=/collections \
  -e BRUNO_SERVER_TLS_CERT_FILE=/certs/fullchain.pem \
  -e BRUNO_SERVER_TLS_KEY_FILE=/certs/privkey.pem \
  bruno-bridge
```

The Bridge validates both paths at startup (fails fast if either file is unreadable, or only one of the pair is set) — the same `packages/bruno-server/src/config-validation.js` module that validates every other env var. This covers TLS termination only, not certificate provisioning/renewal (ACME, Let's Encrypt, etc.) — that's intentionally left to the operator's own tooling (e.g. a reverse proxy that handles ACME renewal and mounts the resulting cert for the Bridge to read).

### 5.8 Stop Browser Mode

Press `Ctrl+C` in the terminal running `npm run dev:browser`, or stop both terminals if the components were started separately.

---

## 6. Desktop Installation and Usage

### 6.1 Start Desktop Development Mode — Recommended

This command works on Windows, macOS, and Linux:

```text
npm run dev
```

It performs the following steps:

1. Starts the React development server
2. Detects the actual port selected by the server
3. Starts Electron with `BRUNO_DEV_PORT` set to that port

### 6.2 Start Desktop Components in Separate Terminals

Terminal 1:

```text
npm run dev:web
```

Read the port from the `Local:` line, then open Terminal 2.

Windows PowerShell example for port `3000`:

```powershell
$env:BRUNO_DEV_PORT = "3000"
npm run dev:electron
```

macOS/Linux:

```bash
BRUNO_DEV_PORT=3000 npm run dev:electron
```

Electron defaults to port `3000` when `BRUNO_DEV_PORT` is not set.

### 6.3 Use Isolated Desktop User Data for Testing

Windows PowerShell:

```powershell
$env:ELECTRON_USER_DATA_PATH = "$env:USERPROFILE\Desktop\bruno-test"
npm run dev:electron
```

macOS/Linux:

```bash
ELECTRON_USER_DATA_PATH="$HOME/Desktop/bruno-test" npm run dev:electron
```

This variable is applied in development mode and prevents test preferences from mixing with normal application data.

### 6.4 Build Desktop Installers

Build on the target operating system whenever possible because Electron uses native dependencies and platform-specific signing.

Cross-platform command for the current operating system:

```text
npm run build:web
npm run build:electron
```

Build artifacts are written to:

```text
packages/bruno-electron/out
```

#### Windows

Use PowerShell or Command Prompt:

```text
npm run build:web
npm run build:electron
```

The primary artifact is an NSIS `.exe` for `x64` and/or `arm64`, depending on the build environment. The installer allows the installation directory to be changed and creates Desktop and Start Menu shortcuts.

Install a built artifact from PowerShell:

```powershell
$installer = Get-ChildItem packages\bruno-electron\out\*.exe | Select-Object -First 1
$installer.FullName
Start-Process $installer.FullName
```

#### macOS

```bash
npm run build:web
npm run build:electron:mac
```

Electron Builder produces `.dmg`, `.pkg`, and `.zip` artifacts for `x64` and `arm64` according to the project configuration.

Open a DMG:

```bash
open packages/bruno-electron/out/*.dmg
```

Or install a PKG:

```bash
sudo installer -pkg packages/bruno-electron/out/*.pkg -target /
```

External distribution may require an Apple Developer certificate, code signing, and notarization. Without the required certificate, use development mode or adjust the signing configuration for a local build.

#### Linux

AppImage:

```bash
npm run build:web
npm run build:electron:linux
chmod +x packages/bruno-electron/out/*.AppImage
packages/bruno-electron/out/*.AppImage
```

Debian/Ubuntu package:

```bash
npm run build:web
npm run build:electron:deb
sudo apt install ./packages/bruno-electron/out/*.deb
```

Fedora/RHEL package:

```bash
npm run build:web
npm run build:electron:rpm
sudo dnf install ./packages/bruno-electron/out/*.rpm
```

Snap package:

```bash
npm run build:web
npm run build:electron:snap
sudo snap install --dangerous packages/bruno-electron/out/*.snap
```

### 6.5 Install a Prebuilt Desktop Release

- Windows: run the `.exe` and follow the NSIS installer
- macOS: open the `.dmg` and drag Bruno into Applications, or install the `.pkg`
- Linux: run the AppImage without installation, or install the `.deb`, `.rpm`, or `.snap` appropriate for the distribution

Desktop mode does not require Bruno Bridge Server because the Electron main process provides the same services directly.

---

## 7. English Troubleshooting

### Port `3000`, `3001`, or `4000` Is Already in Use

Windows PowerShell:

```powershell
Get-NetTCPConnection -LocalPort 3000,3001,4000 -ErrorAction SilentlyContinue
```

macOS/Linux:

```bash
lsof -i :3000
lsof -i :3001
lsof -i :4000
```

Verify the owning process before stopping it. The Web UI can select another free port, but Browser transport expects Bridge Server on port `4000` by default.

### Browser Remains on Loading or Does Not Show a Collection

1. Confirm that Bridge health reports `ok`.
2. Inspect the browser console and Bridge terminal.
3. Reload the page after Bridge is ready.
4. Make sure the entered path belongs to the Bridge machine, not a different client machine.
5. Confirm that the collection contains `bruno.json` or `opencollection.yml`.

### Dependency Installation Fails

Confirm that Node 24 is active, then run:

```text
npm run setup
```

This reinstalls dependencies across the workspace. On Windows, errors mentioning `node-gyp`, a compiler, or `node-pty` usually require Visual Studio C++ Build Tools. On macOS, verify Xcode Command Line Tools. On Linux, verify `build-essential`/`gcc-c++`, `make`, Python 3, and `pkg-config`.

### Desktop Build Fails During Signing

- Windows: the current local configuration disables signing, although security software may warn about an unsigned installer.
- macOS: distribution builds may require an Apple certificate and notarization; use `npm run dev` for local development.
- Linux: verify package tooling and system libraries for the selected target format.

---

## Command Summary / สรุปคำสั่ง

| งาน / Task                   | Command                             |
| ---------------------------- | ----------------------------------- |
| ติดตั้งทั้งหมด / Full setup  | `npm run setup`                     |
| Browser development          | `npm run dev:browser`               |
| Browser Bridge only          | `npm run dev:server`                |
| Web UI only                  | `npm run dev:web`                   |
| Browser production build     | `npm run build:web`                 |
| Browser Bridge Docker image  | `docker build -f packages/bruno-server/Dockerfile -t bruno-bridge .` |
| Desktop development          | `npm run dev`                       |
| Electron only                | `npm run dev:electron`              |
| Desktop build for current OS | `npm run build:electron`            |
| macOS installer              | `npm run build:electron:mac`        |
| Windows installer            | `npm run build:electron` on Windows |
| Linux AppImage               | `npm run build:electron:linux`      |
| Linux DEB                    | `npm run build:electron:deb`        |
| Linux RPM                    | `npm run build:electron:rpm`        |
| Linux Snap                   | `npm run build:electron:snap`       |

Run Web UI & Bridge Server: npm run dev:browser
Run Electron Desktop Mode: npm run dev:electron
npm run build:electron:win
