# Soniox vs. Local ASR Real-Time Comparison Dashboard

A high-performance, real-time comparison dashboard that captures a single microphone stream in your browser, resamples it concurrently in parallel Web Audio contexts, and transcribes the audio simultaneously to:
1. **Soniox Cloud ASR (stt-rt-v4)**: Premium, high-fidelity cloud-based speech-to-text.
2. **Local On-Device ASR (Soniqo)**: Apple Silicon Neural Engine-accelerated dictation and streaming models (like **NVIDIA Parakeet TDT v3** with Automatic Language Detection).

---

## System Requirements
* **Operating System**: macOS 13.0+ (Ventura or later)
* **Processor**: Apple Silicon (M1/M2/M3/M4 chip family) for Neural Engine (ANE) hardware acceleration
* **Software**: 
  * Python 3.9 or higher
  * Homebrew package manager

---

## Step-by-Step Setup on a New Mac

### 1. Install Soniqo Local Speech Toolkit
The local ASR engines run via the native macOS `speech` CLI and server toolkit.
Open your terminal and run:

```bash
# Add the Soniqo Homebrew tap
brew tap soniqo/tap

# Install the speech CLI companion
brew install speech
```

### 2. Pre-cache Local Speech Models (NVIDIA Parakeet v3)
Download and pre-warm the high-fidelity NVIDIA Parakeet CoreML model so it runs locally on your Mac's Neural Engine:

```bash
# Soniqo will automatically download, compile, and cache the model under:
# ~/Library/Application Support/Onit/Models/parakeet-tdt-0.6b-v3-coreml
speech download --model parakeet-tdt-0.6b-v3-coreml
```

### 3. Clone and Initialize the Repository
Clone the project repository to your new machine:

```bash
cd ~/Downloads # Or your preferred development directory
git clone <your-github-repo-url>
cd soniox-feedback
```

### 4. Create and Activate the Virtual Environment
Isolate python packages inside a virtual environment:

```bash
# Create the virtual environment
python3 -m venv venv

# Activate the virtual environment
source venv/bin/activate

# Upgrade pip and install standard dependencies
pip install --upgrade pip
pip install fastapi uvicorn websockets soniox python-dotenv
```

### 5. Securely Configure Your Soniox API Key
To protect your active Soniox API Key from leaking to GitHub, **never hardcode secrets in source files**. The project is designed to automatically check the `SONIOX_API_KEY` environment variable.

You can configure this in two ways:

#### Option A: Set via your Terminal Session (Recommended for ephemeral runs)
```bash
export SONIOX_API_KEY="your_actual_soniox_api_key"
```

#### Option B: Use a Local Environment File (Recommended for persistency)
Create a file named `.env` in the root of the project (which is securely ignored by our `.gitignore`):

```text
SONIOX_API_KEY=your_actual_soniox_api_key
```

---

## Launching the Services

To run the dashboard, you need to launch both the **Soniqo Local ASR Server** and the **FastAPI Web Server** in parallel.

### Step 1: Start Soniqo Local ASR Server
Open a new terminal window, activate the local environment, and launch the local WebSocket socket:

```bash
speech-server --port 8090
```
*This exposes the local real-time audio endpoint on port `8090`.*

### Step 2: Start the FastAPI Web Application
In your original terminal window (where `venv` is active and `SONIOX_API_KEY` is loaded), run:

```bash
python3 app.py --port 8000
```
*This boots the web server at `http://127.0.0.1:8000`.*

---

## Operating the Dashboard
1. Open your web browser and navigate to **`http://127.0.0.1:8000`**.
2. Select **Soniox Cloud** in the **Speech Engine 1** dropdown and **Local NVIDIA Parakeet TDT v3** in the **Speech Engine 2** dropdown.
3. Click **Start Transcribing** and grant the browser microphone access.
4. Dictate into your microphone! 
   * The browser will resample the microphone audio into both **16kHz** (for Soniox) and **24kHz** (for Soniqo) streams in parallel.
   * Transcripts will render side-by-side concurrently in real time.
   * Parakeet v3 operates with **Automatic Language Detection** — you can speak in English, French, Spanish, Russian, German, or any of the 25 supported languages, and it will decode automatically!
