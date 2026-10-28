# MCBE ProxVC Wiki Documentation

This document is a compilation of the MCBE ProxVC Wiki.
It contains setup guides, troubleshooting steps, and feature documentation.
Target version: Latest
Generated on: 2026-01-17T11:11:16.692Z

# Introduction

### What is MCBE ProxVC?
- Software designed for Minecraft Bedrock Edition (MCBE). It cannot be used with the Java Edition.
- Enables proximity voice chat in Minecraft using 3D audio (spatial audio), allowing for more immersive communication.
- Configuration can be done via the WEB and is very simple; it is basically ready to use out of the box.
- Supports many platforms, allowing you to enjoy it in various environments. [(Supported Platforms List)](../condition/)

### Notice
- Creator: kkr1212
- Version: 3.0.9
- [Terms of Service](../../terms/)
- [Privacy Policy](../../policy/)
- [GitHub](https://github.com/kkrkun/MCBE-ProxVC/releases/latest)
- Updated: 2025/11/20

---

# Prerequisites
Before using this software, please read the [Terms of Service](../../../terms/) and [Privacy Policy](../../../policy/) carefully.
By using this software, you are deemed to have agreed to the [Terms of Service](../../../terms/) and [Privacy Policy](../../../policy/).

## Supported Platforms
✅: Supported
⚠️: Possible, but requires knowledge
❌: Not Supported

| **Platform** | **WEB Setup** | **Local Setup** | **Minecraft Bedrock** |
|:----------:|:-----------:|:------------:|:------------:|
| Windows | ✅ | ✅ | ✅ |
| Linux | ✅ | ⚠️ | ❌ |
| macOS | ✅ | ⚠️ | ❌ |
| Android | ✅ | ⚠️ | ✅ |
| iOS | ✅ | ⚠️ | ✅ |
| Switch | ⚠️ | ❌ | ✅ |
| PS5 | ✅ | ❌ | ✅ |
| PS4 | ✅ | ❌ | ✅ |
| Xbox | ✅ | ❌ | ✅ |

---

# Setup Guide (Host Only)

### Super Easy! Web Setup
1. <a href="../../../setup/web/" target="_blank" rel="noopener noreferrer">Access Here</a>
2. Choose your preferred settings and just press the start button!!
[Advanced Settings Here](../advanced/)
By downloading the configuration file, you can start with the same settings next time.
#### ⇒ Next: [Connect to Minecraft](../../mc/)
![img](start.png)

---

## Setup on Windows
<details>
<summary>Setup Procedure</summary>

#### ① Download and Unzip `proximity_vc.zip` from <a href="https://github.com/kkrkun/MCBE-ProxVC/releases/latest" target="_blank">GitHub</a>

Once unzipped, you will find files as shown in the image.
[![](https://minecraft-mcworld.com/wp-content/uploads/スクリーンショット-2025-01-23-185641-58d80803.png)](https://minecraft-mcworld.com/wp-content/uploads/スクリーンショット-2025-01-23-185641-58d80803.png)

#### ② Pattern 1: Edit on the Website (Recommended)
Configure your settings on <a href="../../../setup/web/" target="_blank" rel="noopener noreferrer">this site</a>, download the configuration file, and overwrite `config.json`.
<a href="../advanced/" target="_blank" rel="noopener noreferrer">Advanced Settings Here</a>
![image.png](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/3907132/3155eaa2-d4ae-47df-a30f-eeb0486319c1.png)

#### ② Pattern 2: Edit `config.json` Directly
Open `config.json` and change it to your preferred settings. ([Settings List](../../functions/settings))
![image.png](../../config_json.png)

#### ③ Run `setup.cmd`

Run `setup.cmd` as **Administrator**.
*Note: It will close immediately, but this is the correct behavior.*
[![](https://minecraft-mcworld.com/wp-content/uploads/スクリーンショット-90-c877d99b.png)](https://minecraft-mcworld.com/wp-content/uploads/スクリーンショット-90-c877d99b.png)
#### Setup is now complete.
</details>

<details>
<summary>How to Start</summary>

#### Run `start.cmd`
![start.png](./start.png)
#### ⇒ Next: [Connect to Minecraft](../../mc/)
</details>

---

## Setup on Android
<details>
<summary>Setup Procedure</summary>

### 1. Preparation and Editing Config File
1. Install the app "Termux" from [Google Play](https://play.google.com/store/apps/details?id=com.termux&hl=ja).
2. Download `proximity_vc.zip` from <a href="https://github.com/kkrkun/MCBE-ProxVC/releases/latest" target="_blank">GitHub</a> and unzip it.
Once unzipped, you will find files as shown in the image.
[![](https://minecraft-mcworld.com/wp-content/uploads/スクリーンショット-2025-01-23-185641-58d80803.png)](https://minecraft-mcworld.com/wp-content/uploads/スクリーンショット-2025-01-23-185641-58d80803.png)
3. **Edit `config.json`** (Choose one of the following methods)
* **Method A: Edit on Website (Recommended)**
Configure settings on <a href="../../../setup/web/" target="_blank" rel="noopener noreferrer">this site</a>, download the configuration file, and overwrite `config.json`.
<a href="../advanced/" target="_blank" rel="noopener noreferrer">Advanced Settings Here</a>
![image.png](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/3907132/3155eaa2-d4ae-47df-a30f-eeb0486319c1.png)
* **Method B: Edit Directly**
Open `config.json` and change it to your preferred settings. ([Settings List](../../functions/settings))
![image.png](../../config_json.png)

### 2. Environment Setup and Installation on Termux
4. **Termux Initial Setup**
Launch Termux and enter the following commands in order:
![image.png](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/3907132/803557a6-7904-537e-0815-9760c0a1cea4.png)
```bash
pkg update
pkg upgrade
pkg i openssh
```
If asked `Continue? [Y/n]`, type `y` and press Enter.
Next, install Node.js.
```bash
pkg i nodejs-lts
```
Type `node -v`. If the version is displayed, it is OK.

5. **Changing Permissions and Settings**
Grant storage access permissions.
```bash
termux-setup-storage
```
![Screenshot](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/3907132/7ec9ea0a-08c5-6554-5e43-4ab329286c29.jpeg)

**Allow Background Execution**:
Go to Settings → Apps → Termux → Battery Usage → Enable "Allow Background Activity" (Note: Location may vary depending on the device).
![IMG](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/3907132/20ee8a2e-163e-83c8-2ed2-1c6e1e6d0dbd.png)

6. **Moving Files and Installation**
Move the files from the download folder to inside Termux and complete the setup.
```bash
# Move files (Change [unzipped folder name] to the actual name)
cp -r /storage/emulated/0/Download/[unzipped folder name] ~/proximity_vc

# Move to folder and install
cd proximity_vc
npm i
```
Setup is now complete.

</details>
<details>
<summary>How to Start</summary>

### ① Run the following commands
```bash
cd proximity_vc
node index.js
```
![start.png](./start.png)
#### ⇒ Next: [Connect to Minecraft](../../mc/)
</details>

---

# Advanced Settings
## TCP Exposer Settings
Used when you want to fix the Room ID for Minecraft `/connect` or VC connection.
<details>
<summary>How to</summary>

1. Register and log in to <a href="https://www.tcpexposer.com/register/" target="_blank">TCPExposer</a> (Remember your password as you will use it later).
2. Go to My Page → Sub Domain.
3. Get your preferred sub domain from "New Sub Domain".
![image.png](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/3907132/2294c811-6c7a-965b-51f7-2673d5777dd9.png)
4. Enter the TCP Exposer information respectively.
![image.png](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/3907132/4182cbb0-48c5-4780-8616-2fc1b3945c4a.png)
</details>

---
## SkyWay Settings
Allows use of SkyWay noise cancelling, etc.
<details>
<summary>How to</summary>

1. Register and log in to <a href="https://console.skyway.ntt.com" target="_blank">SkyWay</a>.
2. Log in and create an application according to the guide displayed.
3. A page like the one shown in the image will appear.
![c0152789-90b0-2190-cc64-9a8dc961509c.png](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/3907132/fa46524e-6c1c-4a0c-bcfa-cea0b757c4fe.png)
4. Enter the Application ID and Secret Key respectively.
![image.png](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/3907132/e098584a-281e-4a6e-8c1a-2a660c3db67a.png)
</details>

---

# Connecting to Minecraft (Host Only)

## Connecting to a Normal World
*For version 1.21.60 or later, the world host must turn ON "Enable WebSocket".*
*Please turn OFF "Require Encrypted WebSocket".*
![image.png](../websocket.png)
Execute the displayed command in Minecraft.
![image.png](../command.png)
If a chat message like the one below appears, it is successful.
![image.png](../success.png)

---

## Connecting to a Server
Open `server.properties` in the server file and set `op-permission-level=4`.
*Note: OP holders will be able to stop the server via command.*
![image.png](./op.png)
*For version 1.21.60 or later, the world host must turn ON "Enable WebSocket".*
*Please turn OFF "Require Encrypted WebSocket".*
![image.png](../websocket.png)
Execute the displayed command in Minecraft.
![image.png](../command.png)
If a chat message like the one below appears, it is successful.
![image.png](../success.png)

---

## Permanent Connection (Always-On)
You can keep the Proximity VC connected at all times.
Also, you can change Proximity VC settings from functions or command blocks.
### Introduction
- This can only be used with Minecraft Bedrock Server. Please set up your own server. We do not provide support for setting up servers.
- Download `proximity_vc.zip` and `Server_Proximity_Voice_Chat.mcpack` from <a href="https://github.com/kkrkun/MCBE-ProxVC/releases/latest" target="_blank">GitHub</a>.
<details>
<summary>Setup</summary>

#### ① Unzip `proximity_vc.zip`

You will find files as shown in the image.
[![](https://minecraft-mcworld.com/wp-content/uploads/スクリーンショット-2025-01-23-185641-58d80803.png)](https://minecraft-mcworld.com/wp-content/uploads/スクリーンショット-2025-01-23-185641-58d80803.png)

#### ② Register on SkyWay & Create Project and Application

<a href="https://console.skyway.ntt.com" target="_blank">Register on SkyWay</a>.
After registration, log in and create an application following the guide.
A page like the one shown in the image will appear.
*Note: You will use the Application ID and Secret Key later.*
![c0152789-90b0-2190-cc64-9a8dc961509c.png](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/3907132/fa46524e-6c1c-4a0c-bcfa-cea0b757c4fe.png)

#### ③ Preparation for Exposing Localhost

1. Register and log in to <a href="https://www.tcpexposer.com/register/" target="_blank">TCPExposer</a> (Remember your password).
2. Go to My Page → Sub Domain.
3. Get your preferred sub domain from "New Sub Domain".
*Note: If Proximity VC and Minecraft Server are on the same device, one domain is sufficient.*
[![](https://minecraft-mcworld.com/wp-content/uploads/TCP_Exposer-74e42f74.png)](https://minecraft-mcworld.com/wp-content/uploads/TCP_Exposer-74e42f74.png)

#### ④ Pattern 1: Edit on Website (Recommended)
Configure settings on <a href="../../../setup/web/" target="_blank" rel="noopener noreferrer">this site</a>, download the configuration file, and overwrite `config.json`.
*Make sure to enter Advanced Settings as well.*
![image.png](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/3907132/3155eaa2-d4ae-47df-a30f-eeb0486319c1.png)

#### ④ Pattern 2: Edit `config.json`
Open `config.json`.
Enter SkyWay credentials in lines 2-3.
Enter TCP Exposer username and subdomain in lines 5-8.
*Note: If Proximity VC and Minecraft Server are on the same device, `sub_domain2` is not used, so you don't need to fill it in.*
Also, change other settings to your preference at this time. ([Settings List](../../functions/settings))
![image.png](../../config_json.png)

#### ⑤ Run `setup.cmd`

Run `setup.cmd` as **Administrator**.
*Note: It will close immediately, but this is normal behavior.*
[![](https://minecraft-mcworld.com/wp-content/uploads/スクリーンショット-90-c877d99b.png)](https://minecraft-mcworld.com/wp-content/uploads/スクリーンショット-90-c877d99b.png)

#### ⑥ Apply `Server_Proximity_Voice_Chat` to the `World within the Server`
*Enable Beta APIs.*
![image.png](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/3907132/91df0092-4b36-4509-94e8-dc1d190b9473.png)

#### ⑦ Change Server Settings
Open `config/default/permissions.json` and add `"@minecraft/server-net"`.
![image.png](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/3907132/d9d66a8b-7f64-4ab2-802f-92b6e0a80aba.png)
#### Setup is now complete.
</details>
<details>
<summary>How to Start</summary>

#### ① Run `start.cmd`
![start.png](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/3907132/d5534c44-b0e2-429b-a2e1-bf328bc1041b.png)
#### ② Execute the command starting with `/pvc:` in Minecraft
Connection is complete when a chat like this appears.
![image.png](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/3907132/5654fae5-9fbe-425a-8155-fd13b3b9d4f7.png)

</details>

---

# Voice Chat (All Participants)

## Connect to VC
1. <a href="../../../connect/" target="_blank" rel="noopener noreferrer">Access Here</a>
[<a href="https://github.com/kkrkun/MCBE-ProxVC/releases/latest" target="_blank">*Android App version here</a>]
If you access the URL displayed during setup, the Room ID will be entered automatically.
![img.png](./web_url.png)
2. Enter Room ID and Gamertag, then connect.
**Room ID**
Enter the Room ID displayed during setup.
![img.png](./web_roomid.png)
**Gamertag**
Basically your Gamertag, but it might be slightly different.
Example: Japanese -> Romaji, Space -> _
*You can check both by typing `!name` in Minecraft.*
#### If you see this screen, the connection is complete.
![img.png](./web_success.png)

---

# Background Calls
<details>
<summary class="summary-h2">For Android</summary>

#### Use the <a href="https://github.com/kkrkun/MCBE-ProxVC/releases/latest" target="_blank">Android App</a>
*Make sure to allow notifications.*
Reference Video
<video src="./android.mp4" controls="true"></video>
</details>
<details>
<summary class="summary-h2">For iPhone</summary>

#### ① Open Minecraft
#### ② Move Minecraft to background once and connect to VC from browser
#### ③ Open Minecraft again and go to the world
Reference Video
<video src="./iphone.mp4" controls="true"></video>
</details>

---

# Functions & Settings

## Settings
| Setting Name | Description | Type | Default | Required/Optional |
| --- | --- | --- | --- | --- |
| app_id | SkyWay Application ID | string | "" | Optional |
| secret_key | SkyWay Secret Key | string | "" | Optional |
| username | TCP Exposer Username | string | "" | Optional |
| sub_domain | TCP Exposer Subdomain | string | "" | Optional |
| sub_domain2 | TCP Exposer Subdomain (2) | string | "" | Optional |
| ssh_password | TCP Exposer Password | string | "" | Optional |
| port | Port number used for Minecraft integration | number | 19132 | Required |
| web_port | Port number used for Web integration | number | 8000 | Required |
| proximity | Enable Proximity VC | boolean | true | Required |
| spectator | Separate VC for Spectator Mode players | boolean | true | Required |
| specListen | Allow Spectators to listen to other modes | boolean | true | Required |
| specDim | Separate Spectator chat by dimension | boolean | false | Required |
| verify | Require auth code when connecting to Proximity VC | boolean | false | Required |
| distance | Max block distance for voice audibility | number | 10 | Required |
| lang | Display Language | "en"/"ja" | "en" | Required |

---

# In-Game Commands
<details>
<summary class="summary-h2">During Normal Connection (/connect)</summary>

| Command | Description | Type | Permission |
| --- | --- | --- | --- |
| !help | Show help | None | All |
| !name | Check Gamertag for VC | None | All |
| !pvc | Toggle Proximity VC | boolean | Host Only |
| !verify | Toggle Auth Code requirement | boolean | Host Only |
| !dis | Max block distance for voice | number | Host Only |
| !spectator | Separate VC for Spectators | boolean | Host Only |
| !specListen | Allow Spectators to listen to others | boolean | Host Only |
| !specDim | Separate Spectator chat by dimension | boolean | Host Only |
| !lang | Display Language | "en"/"ja" | Host Only |
</details>

<details>
<summary class="summary-h2">During Permanent Connection (/pvc:connect)</summary>

| Command | Description | Argument | Permission |
| --- | --- | --- | --- |
| /pvc:help | Show help | None | All |
| /pvc:name | Check Gamertag for VC | None | All |
| /pvc:connect | Start connection | string | OP Only |
| /pvc:disconnect | Disconnect | None | OP Only |
| /pvc:proximity | Toggle Proximity VC | boolean | OP Only |
| /pvc:verify | Toggle Auth Code requirement | boolean | OP Only |
| /pvc:distance | Max block distance for voice | number | OP Only |
| /pvc:spectator | Separate VC for Spectators | boolean | OP Only |
| /pvc:specListen | Allow Spectators to listen to others | boolean | OP Only |
| /pvc:specDim | Separate Spectator chat by dimension | boolean | OP Only |
| /pvc:lang | Display Language | "en"/"ja" | OP Only |
</details>

---

# Troubleshooting

## Setup Related

<details>
<summary class="summary-h4">Can I setup on iOS or Linux?</summary>

Linux is possible using Terminal. iOS is unknown.
There is no guide, so please try if you have knowledge.
Here is a rough method:
1. Install Node.js (v18 or higher)
2. Install modules
3. Launch
Execute the following commands:
```
node index.js
```
</details>

<details>
<summary class="summary-h4">URL is different from TCPExposer</summary>

You have mistaken the subdomain, username, or password.
Please check the method [here](../../setup/advanced/).
</details>

<details>
<summary class="summary-h4">Error occurs during npm install</summary>

#### Common Causes and Solutions

**1. Node.js version is old**
- Ensure Node.js v18+ is installed.
- Check with `node --version`.

**2. Network Error**
- Check internet connection.
- Corporate networks or firewalls might be the cause.

**3. Permission Error (Windows)**
- Try running Command Prompt as Administrator.

**4. Cache Issue**
- Clear npm cache:
```
npm cache clean --force
```
Then run `npm install` again.

</details>

<details>
<summary class="summary-h4">Blocked by Firewall/Security Software</summary>

#### Windows Firewall Settings

1. Open Windows Security.
2. Select "Firewall & network protection".
3. Click "Allow an app through firewall".
4. Add Node.js or the relevant program to the allowed list.

#### Security Software (Antivirus)

- Add program folder or Node.js to exclusion list in your security software settings.
- Temporarily disabling it to check operation is also effective (Enable it back afterwards).
</details>

<details>
<summary class="summary-h4">Terminated with an Error</summary>

Please restart.
It usually fixes most things.
![error.png](./error.png)

#### If not resolved
1. Reinstall Node.js.
2. Re-download program files.
3. Re-run `npm install`.
</details>

<details>
<summary class="summary-h4">Config.json Load Error</summary>

Check if JSON format is correct.

- Forgot commas or extra commas?
- Are there any full-width characters?
</details>

---

## Minecraft Connection Related

<details>
<summary class="summary-h4">Can I use it on Realms?</summary>
Impossible.
</details>

<details>
<summary class="summary-h4">Commands do not respond</summary>

Check Settings > General > Is "Enable WebSocket" **ON**?

- For Server
Check if `op-permission-level=4` exists in `server.properties`.

- For Permanent Connection
Check if `"@minecraft/server-net"` exists in `config/default/permissions.json`.
</details>

<details>
<summary class="summary-h4">Cannot Connect</summary>
#### Checklist
1. Is it within 5 minutes of startup?
To save memory, it automatically shuts down if there is no connection within 5 minutes.
Please restart.
2. Internet Connection
If internet is unstable, connection may be unstable.
#### For Local Environment

1. **IP Address and Port**
Check if the entered IP and Port are correct.

2. **Network Connection**
Check if connected to the same Wi-Fi network.

</details>

<details>
<summary class="summary-h4">Crash after /connect</summary>

Check Settings > General > Is "Require Encrypted WebSocket" **OFF**?
</details>

<details>
<summary class="summary-h4">Suddenly says "Connection Disconnected"</summary>

Cause is under investigation. Please perform setup on Windows instead of Web Setup.
</details>

---

## VC Connection Related

### Functions not working correctly
<details>
<summary class="summary-h4">Cannot connect</summary>

Check if Gamertag is correct using command ([Command List](../../functions/commands/)).
</details>

<details>
<summary class="summary-h4">Distance Attenuation / 3D Audio not working</summary>
**Limitations on some devices like iOS**
If using earphones where both input and output are on the same device, distance attenuation and 3D audio may not apply (The feature where voice becomes inaudible by distance still works).
</details>

### Microphone Permission Issues

<details>
<summary class="summary-h4">Browser doesn't ask for Mic Permission</summary>

#### Chrome/Edge

1. Click 🔒 (Lock) or ℹ️ on address bar.
2. Select "Site Settings".
3. Change Microphone to "Allow".
4. Reload page.

#### Firefox

1. Click ℹ️ on address bar.
2. Click ">" on "Connection Security".
3. Click "More Information".
4. In "Permissions" tab, set Microphone to "Allow".
5. Reload page.

#### Safari (Mac)

1. Safari > Preferences > Websites.
2. Select "Microphone" from left menu.
3. Set relevant site to "Allow".
</details>

<details>
<summary class="summary-h4">Mic denied at Windows OS Level</summary>

1. Open Windows Settings.
2. Privacy & security > Microphone.
3. Ensure "Microphone access" is ON.
4. Turn ON "Let desktop apps access your microphone".
5. Ensure browser is listed.
</details>

---

### Audio Device Issues

<details>
<summary class="summary-h4">Microphone not recognized</summary>

#### Checklist

1. **Physical Connection**
- Check if mic is connected properly.
- Try another USB port if using USB.

2. **Windows Sound Settings**
- Right-click speaker icon on taskbar.
- Open "Sound settings".
- Ensure correct mic is selected in "Input devices".
- Check if voice is detected in mic test.

3. **Device Manager**
- Open Device Manager.
- Check "Audio inputs and outputs".
- Check for ! or × marks.
- Try updating drivers.
</details>

<details>
<summary class="summary-h4">Wrong Microphone Selected</summary>

Select correct microphone in browser or settings.

#### Common Mic Names
- Headset: "Headset Microphone" or Product Name
- Laptop Built-in: "Internal Microphone"
- USB Mic: Product Name
- Bluetooth: Device Name

If multiple mics exist, try each one.
</details>

---

### Sound Issues

<details>
<summary class="summary-h4">My voice doesn't reach others</summary>

#### Checklist

1. **Mic Mute Check**
- Check if muted in app.
- Check physical mute switch.

2. **Input Level Check**
- Check mic input level in Windows Sound Settings.
- If too low, raise volume (50-100% recommended).

3. **Microphone Boost**
- Sound Settings > Input Device > Device Properties.
- Click "Additional device properties".
- Adjust Mic Boost in "Levels" tab (+10dB to +20dB).

4. **Exit and Reconnect VC**
- Press Exit button.
- Re-enter Room ID and Gamertag to join again.

5. **Restart Browser**
- Completely close and restart browser.
- Access page again.
</details>

<details>
<summary class="summary-h4">Cannot hear others</summary>

#### Checklist

1. **System Volume Check**
- Check Windows volume level.
- Ensure not muted.

2. **Output Device Check**
- Check if correct Speaker/Headphone is selected.
- Check if sound works in other apps (YouTube, etc.).

3. **Browser Site Volume**
- If speaker icon is on browser tab, click it.
- Ensure site is not muted.

4. **Exit and Reconnect VC**
- Press Exit button.
- Re-enter Room ID and Gamertag to join again.

5. **Possibility of Peer Issue**
- Ask peer if their mic is working.
</details>

<details>
<summary class="summary-h4">Hearing someone's voice constantly</summary>

1. **If only you hear it**
- Exit and rejoin VC.

2. **If everyone hears specific person**
- That person should exit and rejoin VC.

3. **If everyone hears everyone constantly**
- Restart MCBE ProxVC itself.
- Reconnect to Minecraft.
- Everyone exit and rejoin VC.
</details>

<details>
<summary class="summary-h4">Echo / Howling / Feedback</summary>

#### Solution

1. **Use Headphones/Earphones**
- Use headphones instead of speakers.
- This is the most effective solution.

2. **Distance Speakers and Mic**
- Place mic away from speakers.

3. **Lower Volume**
- Lower volume of speakers/mic.

4. **Echo Cancellation**
- Enable echo cancellation in Windows Sound Settings if available.
</details>

<details>
<summary class="summary-h4">Voice cuts out / Robotic voice</summary>

#### Causes and Solutions

**1. Network Bandwidth**
- Stop other downloads/streaming.
- Switch to wired LAN if on Wi-Fi.
- Move closer to router.

**2. High CPU/Memory Load**
- Close unnecessary apps.
- Reduce browser tabs.
- Check Task Manager.

**3. Mic/Speaker Settings**
- Adjust Sample Rate (Usually 44.1kHz or 48kHz).
- Sound Settings > Device Properties > Advanced.

**4. Bluetooth Latency**
- Consider wired devices if using Bluetooth.
</details>

---

### Browser Compatibility

<details>
<summary class="summary-h4">Recommended Browsers</summary>

This system is confirmed to work on:

#### Recommended
- **Google Chrome** (Latest)
- **Microsoft Edge** (Latest)
- **Firefox** (Latest)
- **Safari** (Latest)

#### Not Recommended / No Guarantee
- Internet Explorer
- Old versions
</details>