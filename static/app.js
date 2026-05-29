// Real-time Dual-Engine Soniox & Local ASR Transcription Web Client

let audioContext1 = null;
let audioContext2 = null;
let mediaStream = null;
let processorNode1 = null;
let processorNode2 = null;
let socket1 = null;
let socket2 = null;
let isRecording = false;
let streamStartTime = null;

let pingInterval1 = null;
let pingInterval2 = null;

let latestLocalRtt1 = null;
let latestLocalRtt2 = null;
let latestCloudRtt1 = null;
let latestCloudRtt2 = null;
let latestTotalLatency1 = null;
let latestTotalLatency2 = null;
let latencyHistory1 = [];
let latencyHistory2 = [];

// Audio Visualizer Level Tracking
const visualizerBars = document.querySelectorAll(".wave-bar");

// UI Elements
const btnStart = document.getElementById("btn-start");
const btnStop = document.getElementById("btn-stop");
const btnCopy = document.getElementById("btn-copy");
const btnClear = document.getElementById("btn-clear");

const transcriptBox1 = document.getElementById("transcript-box-1");
const transcriptBox2 = document.getElementById("transcript-box-2");

const statusDot = document.querySelector(".indicator-dot");
const statusText = document.getElementById("status-text");

const selectEngine1 = document.getElementById("select-engine-1");
const selectEngine2 = document.getElementById("select-engine-2");

const sessionModelValue1 = document.getElementById("session-model-value-1");
const sessionModelValue2 = document.getElementById("session-model-value-2");

const modelInfoCard1 = document.getElementById("model-info-card-1");
const modelInfoCard2 = document.getElementById("model-info-card-2");

const transcriptLabel1 = document.getElementById("transcript-label-1");
const transcriptLabel2 = document.getElementById("transcript-label-2");

// Cache for transcripts
let currentFinalText1 = "";
let currentInterimText1 = "";
let currentFinalText2 = "";
let currentInterimText2 = "";

// Event Listeners
if (btnStart) btnStart.addEventListener("click", startRecording);
if (btnStop) btnStop.addEventListener("click", stopRecording);
if (btnCopy) btnCopy.addEventListener("click", copyTranscript);
if (btnClear) btnClear.addEventListener("click", clearTranscript);

const modelMetadata = {
    "soniox": {
        label: "stt-rt-v4 (Cloud)",
        desc: "☁️ <strong>Soniox Cloud Premium:</strong> High-fidelity real-time transcription powered by Soniox Speech AI. Optimized for multi-speaker, complex vocabulary, and premium clarity."
    },
    "elevenlabs": {
        label: "Scribe v2 Realtime (Cloud)",
        desc: "☁️ <strong>ElevenLabs Scribe v2:</strong> Premium real-time Speech-to-Text streaming powered by Scribe v2 Realtime. Engineered for ultra-low latency (~150ms) with automated silence-based commit."
    },
    "local": {
        label: "Qwen3 ASR 0.6B (Local MLX)",
        desc: "🚀 <strong>Local Qwen3 ASR (0.6B MLX):</strong> Swift-native multilingual model running entirely offline on your Mac's GPU via MLX. Extremely responsive (~13ms model delay)."
    },
    "local-coreml": {
        label: "Qwen3 ASR 0.6B (Local CoreML)",
        desc: "⚡ <strong>Local Qwen3 ASR (0.6B CoreML):</strong> Encoder accelerated by Apple's Neural Engine (ANE) via CoreML for maximum energy efficiency, keeping your Mac cool."
    },
    "local-1.7b": {
        label: "Qwen3 ASR 1.7B (Local MLX)",
        desc: "💎 <strong>Local Qwen3 ASR (1.7B MLX):</strong> Premium 1.7B model. 3x larger neural network for superior spelling accuracy, punctuation, and contextual understanding."
    },
    "local-nemotron": {
        label: "Nemotron 0.6B (Local CoreML)",
        desc: "🎯 <strong>NVIDIA Nemotron (0.6B Streaming):</strong> CoreML streaming model designed specifically for real-time dictation with integrated End-of-Utterance (EOU) boundary detection."
    },
    "local-parakeet": {
        label: "Parakeet TDT v3 (Local)",
        desc: "🦅 <strong>NVIDIA Parakeet TDT v3 ASR:</strong> Active Multilingual Mode with <strong>Automatic Language Detection</strong> (25 European languages!). Blazing fast Neural Engine inference with native punctuation and casing."
    },
    "local-whisperkit": {
        label: "WhisperKit Turbo (Local)",
        desc: "🌀 <strong>WhisperKit Large v3 Turbo:</strong> Premium offline speech-to-text running natively on the <strong>Apple Neural Engine (ANE)</strong> via CoreML. Matches cloud quality at ~2.2% WER with sub-200ms latency."
    },
    "local-moonshine": {
        label: "Moonshine Tiny (Local)",
        desc: "🌙 <strong>Moonshine Streaming Tiny:</strong> Quantized on-device ONNX model optimized for low-latency voice agents. Sub-100ms processing delay using stateful sliding-window token generation."
    }
};

function updateModelUI(slot) {
    const selectEngine = slot === 1 ? selectEngine1 : selectEngine2;
    const sessionModelValue = slot === 1 ? sessionModelValue1 : sessionModelValue2;
    const modelInfoCard = slot === 1 ? modelInfoCard1 : modelInfoCard2;
    const transcriptLabel = slot === 1 ? transcriptLabel1 : transcriptLabel2;
    
    if (!selectEngine || !sessionModelValue) return;
    const val = selectEngine.value;
    const meta = modelMetadata[val] || modelMetadata["local"];
    sessionModelValue.textContent = meta.label;
    if (modelInfoCard) {
        modelInfoCard.innerHTML = meta.desc;
    }
    if (transcriptLabel) {
        // Render a clean engine text label
        const cleanName = meta.label.split(" (")[0];
        transcriptLabel.textContent = cleanName;
    }
}

if (selectEngine1 && sessionModelValue1) {
    selectEngine1.addEventListener("change", () => updateModelUI(1));
    updateModelUI(1);
}
if (selectEngine2 && sessionModelValue2) {
    selectEngine2.addEventListener("change", () => updateModelUI(2));
    updateModelUI(2);
}

const sliderFontSize = document.getElementById("slider-font-size");
const labelFontSize = document.getElementById("label-font-size");

// Set initial size matching the slider default value
if (sliderFontSize) {
    if (transcriptBox1) transcriptBox1.style.fontSize = `${sliderFontSize.value}px`;
    if (transcriptBox2) transcriptBox2.style.fontSize = `${sliderFontSize.value}px`;
    
    sliderFontSize.addEventListener("input", (e) => {
        const size = e.target.value;
        if (transcriptBox1) transcriptBox1.style.fontSize = `${size}px`;
        if (transcriptBox2) transcriptBox2.style.fontSize = `${size}px`;
        labelFontSize.textContent = `${size}px`;
    });
}

function updateStatus(state) {
    statusDot.className = "indicator-dot " + state;
    if (state === "connected") {
        statusText.textContent = "Listening";
    } else if (state === "connecting") {
        statusText.textContent = "Connecting...";
    } else {
        statusText.textContent = "Disconnected";
    }
}

async function startRecording() {
    if (isRecording) return;
    
    currentFinalText1 = "";
    currentInterimText1 = "";
    currentFinalText2 = "";
    currentInterimText2 = "";
    latencyHistory1 = [];
    latencyHistory2 = [];
    
    updateStatus("connecting");
    
    if (selectEngine1) selectEngine1.disabled = true;
    if (selectEngine2) selectEngine2.disabled = true;
    
    // 1. Initialize WebSockets
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const engine1 = selectEngine1 ? selectEngine1.value : "soniox";
    const engine2 = selectEngine2 ? selectEngine2.value : "local";
    
    const wsUrl1 = `${protocol}//${window.location.host}/ws/transcribe?engine=${engine1}`;
    const wsUrl2 = `${protocol}//${window.location.host}/ws/transcribe?engine=${engine2}`;
    
    let socket1Connected = false;
    let socket2Connected = false;
    
    const checkConnections = async () => {
        if (socket1Connected && socket2Connected) {
            console.log("Both WebSockets connected.");
            updateStatus("connected");
            
            // 2. Start Microphone capture
            try {
                const sampleRate1 = engine1.startsWith("local") ? (engine1 === "local-moonshine" ? 16000 : 24000) : 16000;
                const sampleRate2 = engine2.startsWith("local") ? (engine2 === "local-moonshine" ? 16000 : 24000) : 16000;
                await initAudio(sampleRate1, sampleRate2);
                isRecording = true;
                btnStart.classList.add("hidden");
                btnStop.classList.remove("hidden");
            } catch (err) {
                console.error("Failed to initialize microphone:", err);
                alert("Could not access microphone. Please grant permission and try again.");
                stopRecording();
            }
        }
    };
    
    try {
        // Connect Socket 1
        socket1 = new WebSocket(wsUrl1);
        socket1.binaryType = "arraybuffer";
        
        socket1.onopen = () => {
            console.log("WebSocket 1 connected.");
            socket1Connected = true;
            
            // Launch periodic pings to calculate network latency components
            pingInterval1 = setInterval(() => {
                if (socket1 && socket1.readyState === WebSocket.OPEN) {
                    socket1.send(JSON.stringify({
                        type: "ping",
                        client_time: performance.now()
                    }));
                }
            }, 2000);
            
            checkConnections();
        };
        
        socket1.onmessage = (event) => {
            const data = JSON.parse(event.data);
            
            // Intercept ping-pong latency payloads
            if (data.type === "pong") {
                latestLocalRtt1 = performance.now() - data.client_time;
                latestCloudRtt1 = data.cloud_rtt;
                updateLatencyBreakdownUI(1);
                return;
            }
            
            currentFinalText1 = data.final_text || "";
            currentInterimText1 = data.interim_text || "";
            
            // Calculate dynamic latency if data has latest_start_ms
            if (data.latest_start_ms > 0 && streamStartTime) {
                const wordStartSystemTime = streamStartTime + data.latest_start_ms;
                latestTotalLatency1 = Math.max(30, Date.now() - wordStartSystemTime);
                latencyHistory1.push(latestTotalLatency1);
                updateLatencyUI(1, latestTotalLatency1);
                updateLatencyBreakdownUI(1);
            }
            
            renderTranscript(1);
        };
        
        socket1.onclose = () => {
            console.log("WebSocket 1 disconnected.");
            stopRecording();
        };
        
        socket1.onerror = (err) => {
            console.error("WebSocket 1 error:", err);
            stopRecording();
        };
        
        // Connect Socket 2
        socket2 = new WebSocket(wsUrl2);
        socket2.binaryType = "arraybuffer";
        
        socket2.onopen = () => {
            console.log("WebSocket 2 connected.");
            socket2Connected = true;
            
            // Launch periodic pings to calculate network latency components
            pingInterval2 = setInterval(() => {
                if (socket2 && socket2.readyState === WebSocket.OPEN) {
                    socket2.send(JSON.stringify({
                        type: "ping",
                        client_time: performance.now()
                    }));
                }
            }, 2000);
            
            checkConnections();
        };
        
        socket2.onmessage = (event) => {
            const data = JSON.parse(event.data);
            
            // Intercept ping-pong latency payloads
            if (data.type === "pong") {
                latestLocalRtt2 = performance.now() - data.client_time;
                latestCloudRtt2 = data.cloud_rtt;
                updateLatencyBreakdownUI(2);
                return;
            }
            
            currentFinalText2 = data.final_text || "";
            currentInterimText2 = data.interim_text || "";
            
            // Calculate dynamic latency if data has latest_start_ms
            if (data.latest_start_ms > 0 && streamStartTime) {
                const wordStartSystemTime = streamStartTime + data.latest_start_ms;
                latestTotalLatency2 = Math.max(30, Date.now() - wordStartSystemTime);
                latencyHistory2.push(latestTotalLatency2);
                updateLatencyUI(2, latestTotalLatency2);
                updateLatencyBreakdownUI(2);
            }
            
            renderTranscript(2);
        };
        
        socket2.onclose = () => {
            console.log("WebSocket 2 disconnected.");
            stopRecording();
        };
        
        socket2.onerror = (err) => {
            console.error("WebSocket 2 error:", err);
            stopRecording();
        };
        
    } catch (e) {
        console.error("Connection failed:", e);
        stopRecording();
    }
}

async function initAudio(sampleRate1, sampleRate2) {
    mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true
        }
    });

    streamStartTime = Date.now();

    // 1. Initialize AudioContext 1 (Resampling handles natively in browser)
    audioContext1 = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: sampleRate1
    });
    const source1 = audioContext1.createMediaStreamSource(mediaStream);
    processorNode1 = audioContext1.createScriptProcessor(512, 1, 1);
    
    processorNode1.onaudioprocess = (e) => {
        if (!isRecording) return;
        
        const floatData = e.inputBuffer.getChannelData(0);
        
        // We only animate the visualizer using the first stream (since audio content is identical)
        animateVisualizer(floatData);
        
        const pcm16 = floatTo16BitPCM(floatData);
        if (socket1 && socket1.readyState === WebSocket.OPEN) {
            socket1.send(pcm16.buffer);
        }
    };
    source1.connect(processorNode1);
    processorNode1.connect(audioContext1.destination);

    // 2. Initialize AudioContext 2
    audioContext2 = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: sampleRate2
    });
    const source2 = audioContext2.createMediaStreamSource(mediaStream);
    processorNode2 = audioContext2.createScriptProcessor(512, 1, 1);
    
    processorNode2.onaudioprocess = (e) => {
        if (!isRecording) return;
        
        const floatData = e.inputBuffer.getChannelData(0);
        const pcm16 = floatTo16BitPCM(floatData);
        if (socket2 && socket2.readyState === WebSocket.OPEN) {
            socket2.send(pcm16.buffer);
        }
    };
    source2.connect(processorNode2);
    processorNode2.connect(audioContext2.destination);
}

function floatTo16BitPCM(input) {
    const buffer = new ArrayBuffer(input.length * 2);
    const view = new DataView(buffer);
    let offset = 0;
    
    for (let i = 0; i < input.length; i++, offset += 2) {
        let s = Math.max(-1, Math.min(1, input[i]));
        // Convert float32 [-1, 1] to signed int16 [-32768, 32767]
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true); // Little endian
    }
    
    return new Int16Array(buffer);
}

function animateVisualizer(audioData) {
    // Compute root-mean-square (RMS) level
    let sum = 0;
    for (let i = 0; i < audioData.length; i++) {
        sum += audioData[i] * audioData[i];
    }
    const rms = Math.sqrt(sum / audioData.length);
    const db = 20 * Math.log10(rms || 0.001); // Decibel level
    
    // Map db range [-40, 0] to dynamic bar heights [8px, 60px]
    const normalized = Math.max(0, Math.min(1, (db + 40) / 40));
    
    visualizerBars.forEach((bar, index) => {
        // Add slight random phase variation to give wave effect
        const delay = Math.sin(Date.now() * 0.01 + index * 0.5) * 0.15;
        const heightVal = Math.max(8, normalized * 60 + delay * 20);
        bar.style.height = `${heightVal}px`;
    });
}

function renderTranscript(slot) {
    const box = slot === 1 ? transcriptBox1 : transcriptBox2;
    const placeholderId = slot === 1 ? "transcript-placeholder-1" : "transcript-placeholder-2";
    const currentFinalText = slot === 1 ? currentFinalText1 : currentFinalText2;
    const currentInterimText = slot === 1 ? currentInterimText1 : currentInterimText2;
    
    if (!box) return;
    
    // Clear placeholder
    const placeholder = document.getElementById(placeholderId);
    if (placeholder) {
        placeholder.remove();
    }
    
    let htmlContent = "";
    
    if (currentFinalText) {
        htmlContent += `<span class="final-text">${escapeHtml(currentFinalText)}</span>`;
    }
    
    if (currentInterimText) {
        // Add a separating space if we have finalized text
        const space = currentFinalText ? " " : "";
        htmlContent += `${space}<span class="interim-text">${escapeHtml(currentInterimText)}</span>`;
    }
    
    if (!currentFinalText && !currentInterimText) {
        // Re-inject placeholder if empty
        box.innerHTML = `
            <div class="transcript-placeholder" id="${placeholderId}">
                <span class="placeholder-icon">🎙️</span>
                <p>Engine ${slot} is active. Speak into your microphone.</p>
            </div>
        `;
        return;
    }
    
    box.innerHTML = htmlContent;
    
    // Autoscroll to bottom
    box.scrollTop = box.scrollHeight;
}

function stopRecording() {
    if (!isRecording) return;
    cleanup();
}

function cleanup() {
    isRecording = false;
    updateStatus("disconnected");
    
    if (selectEngine1) selectEngine1.disabled = false;
    if (selectEngine2) selectEngine2.disabled = false;
    
    btnStop.classList.add("hidden");
    btnStart.classList.remove("hidden");
    
    // Stop mic stream
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
    }
    
    // Close Audio Nodes 1
    if (processorNode1) {
        processorNode1.disconnect();
        processorNode1 = null;
    }
    if (audioContext1) {
        audioContext1.close();
        audioContext1 = null;
    }
    
    // Close Audio Nodes 2
    if (processorNode2) {
        processorNode2.disconnect();
        processorNode2 = null;
    }
    if (audioContext2) {
        audioContext2.close();
        audioContext2 = null;
    }
    
    // Close Sockets
    if (socket1) {
        if (socket1.readyState === WebSocket.OPEN || socket1.readyState === WebSocket.CONNECTING) {
            socket1.close();
        }
        socket1 = null;
    }
    if (socket2) {
        if (socket2.readyState === WebSocket.OPEN || socket2.readyState === WebSocket.CONNECTING) {
            socket2.close();
        }
        socket2 = null;
    }
    
    // Reset visualizer bars
    visualizerBars.forEach(bar => {
        bar.style.height = "8px";
    });

    // Clear ping intervals
    if (pingInterval1) {
        clearInterval(pingInterval1);
        pingInterval1 = null;
    }
    if (pingInterval2) {
        clearInterval(pingInterval2);
        pingInterval2 = null;
    }
    
    // Reset latency variables and UI metrics for Engine 1
    latestLocalRtt1 = null;
    latestCloudRtt1 = null;
    latestTotalLatency1 = null;
    resetLatencyUI(1);
    resetLatencyBreakdownUI(1);

    // Reset latency variables and UI metrics for Engine 2
    latestLocalRtt2 = null;
    latestCloudRtt2 = null;
    latestTotalLatency2 = null;
    resetLatencyUI(2);
    resetLatencyBreakdownUI(2);
}

function copyTranscript() {
    const text1 = currentFinalText1 + (currentInterimText1 ? " " + currentInterimText1 : "");
    const text2 = currentFinalText2 + (currentInterimText2 ? " " + currentInterimText2 : "");
    
    if (!text1 && !text2) return;
    
    const engine1Name = selectEngine1 ? selectEngine1.options[selectEngine1.selectedIndex].text : "Engine 1";
    const engine2Name = selectEngine2 ? selectEngine2.options[selectEngine2.selectedIndex].text : "Engine 2";
    
    const textToCopy = `=== Engine 1 (${engine1Name}) ===\n${text1 || "(No transcript)"}\n\n=== Engine 2 (${engine2Name}) ===\n${text2 || "(No transcript)"}`;
    
    navigator.clipboard.writeText(textToCopy)
        .then(() => {
            if (btnCopy) {
                const originalText = btnCopy.innerHTML;
                btnCopy.innerHTML = "<span class='tool-icon'>✔️</span> Copied Both!";
                setTimeout(() => {
                    btnCopy.innerHTML = originalText;
                }, 2000);
            }
        })
        .catch(err => {
            console.error("Failed to copy transcript: ", err);
        });
}

function clearTranscript() {
    currentFinalText1 = "";
    currentInterimText1 = "";
    currentFinalText2 = "";
    currentInterimText2 = "";
    
    if (transcriptBox1) {
        transcriptBox1.innerHTML = `
            <div class="transcript-placeholder" id="transcript-placeholder-1">
                <span class="placeholder-icon">🎙️</span>
                <p>Engine 1 is ready. Click "Start Transcribing" to begin.</p>
            </div>
        `;
    }
    if (transcriptBox2) {
        transcriptBox2.innerHTML = `
            <div class="transcript-placeholder" id="transcript-placeholder-2">
                <span class="placeholder-icon">🎙️</span>
                <p>Engine 2 is ready. Click "Start Transcribing" to begin.</p>
            </div>
        `;
    }
    resetLatencyUI(1);
    resetLatencyUI(2);
    resetLatencyBreakdownUI(1);
    resetLatencyBreakdownUI(2);
}

function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, function(m) { return map[m]; });
}

function updateLatencyUI(slot, latency) {
    const metricLatency = document.getElementById(`metric-latency-${slot}`);
    const metricLatencyStatus = document.getElementById(`metric-latency-status-${slot}`);
    
    if (!metricLatency || !metricLatencyStatus) return;
    
    // Display the latency
    metricLatency.textContent = `${latency}ms`;
    
    // Color-code the status based on performance
    if (latency < 280) {
        metricLatency.style.color = "var(--color-success)";
        metricLatencyStatus.textContent = "Excellent (Real-Time)";
        metricLatencyStatus.style.color = "var(--color-success)";
    } else if (latency < 550) {
        metricLatency.style.color = "hsl(45, 100%, 51%)"; // Warm yellow
        metricLatencyStatus.textContent = "Good (Low Latency)";
        metricLatencyStatus.style.color = "hsl(45, 100%, 51%)";
    } else {
        metricLatency.style.color = "var(--color-danger)";
        metricLatencyStatus.textContent = "Delayed";
        metricLatencyStatus.style.color = "var(--color-danger)";
    }
}

function resetLatencyUI(slot) {
    const metricLatency = document.getElementById(`metric-latency-${slot}`);
    const metricLatencyStatus = document.getElementById(`metric-latency-status-${slot}`);
    if (metricLatency) {
        metricLatency.textContent = "--";
        metricLatency.style.color = "";
    }
    if (metricLatencyStatus) {
        metricLatencyStatus.textContent = "Waiting...";
        metricLatencyStatus.style.color = "";
    }
}

function updateLatencyBreakdownUI(slot) {
    const selectEngine = slot === 1 ? selectEngine1 : selectEngine2;
    const engine = selectEngine ? selectEngine.value : "soniox";
    const captureDelay = engine.startsWith("local") ? 21 : 32;
    
    const breakdownCapture = document.getElementById(`breakdown-capture-${slot}`);
    const breakdownLocal = document.getElementById(`breakdown-local-${slot}`);
    const breakdownCloud = document.getElementById(`breakdown-cloud-${slot}`);
    const breakdownModel = document.getElementById(`breakdown-model-${slot}`);
    
    const latestLocalRtt = slot === 1 ? latestLocalRtt1 : latestLocalRtt2;
    const latestCloudRtt = slot === 1 ? latestCloudRtt1 : latestCloudRtt2;
    const latestTotalLatency = slot === 1 ? latestTotalLatency1 : latestTotalLatency2;
    
    if (breakdownCapture) {
        breakdownCapture.textContent = `${captureDelay}ms`;
    }
    
    let oneWayLocal = 0;
    if (latestLocalRtt !== null) {
        oneWayLocal = latestLocalRtt / 2;
        if (breakdownLocal) {
            breakdownLocal.textContent = `${Math.round(oneWayLocal)}ms`;
        }
    } else {
        if (breakdownLocal) breakdownLocal.textContent = "--";
    }
    
    let oneWayCloud = 0;
    if (latestCloudRtt !== null) {
        oneWayCloud = latestCloudRtt / 2;
        if (breakdownCloud) {
            breakdownCloud.textContent = `${Math.round(oneWayCloud)}ms`;
        }
    } else {
        if (breakdownCloud) breakdownCloud.textContent = "--";
    }
    
    if (latestTotalLatency !== null) {
        // Model Delay = Total Latency - Capture Buffer - One-way Local - One-way Cloud
        const modelDelay = Math.max(10, latestTotalLatency - captureDelay - oneWayLocal - oneWayCloud);
        if (breakdownModel) {
            breakdownModel.textContent = `${Math.round(modelDelay)}ms`;
        }
    } else {
        if (breakdownModel) breakdownModel.textContent = "--";
    }
}

function resetLatencyBreakdownUI(slot) {
    const breakdownLocal = document.getElementById(`breakdown-local-${slot}`);
    const breakdownCloud = document.getElementById(`breakdown-cloud-${slot}`);
    const breakdownModel = document.getElementById(`breakdown-model-${slot}`);
    if (breakdownLocal) breakdownLocal.textContent = "--";
    if (breakdownCloud) breakdownCloud.textContent = "--";
    if (breakdownModel) breakdownModel.textContent = "--";
}

// Gettysburg Address First Paragraph Reference Text
const GETTYSBURG_REFERENCE = "Four score and seven years ago our fathers brought forth, upon this continent, a new nation, conceived in liberty, and dedicated to the proposition that all men are created equal.";

// Levenshtein distance based ASR Word Error Rate (WER), Accuracy and detailed Alignment backtracking calculator
function calculateASRAccuracy(referenceText, hypothesisText) {
    const cleanWord = (w) => {
        if (!w) return "";
        return w.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'—–]/g, "").trim();
    };

    const refWords = referenceText.trim().split(/\s+/).filter(w => w.trim().length > 0);
    const cleanRefWords = refWords.map(w => cleanWord(w)).filter(w => w.length > 0);
    
    const hypWords = hypothesisText.trim().split(/\s+/).filter(w => w.trim().length > 0);
    const cleanHypWords = hypWords.map(w => cleanWord(w));

    if (cleanRefWords.length === 0) {
        return {
            wer: cleanHypWords.length === 0 ? 0 : 1,
            accuracy: cleanHypWords.length === 0 ? 100.0 : 0.0,
            refLength: 0,
            hypLength: cleanHypWords.length,
            alignment: [],
            refWords: []
        };
    }

    const n = cleanRefWords.length;
    const m = cleanHypWords.length;

    // DP table initialization
    const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));

    for (let i = 0; i <= n; i++) dp[i][0] = i;
    for (let j = 0; j <= m; j++) dp[0][j] = j;

    // DP table computation
    for (let i = 1; i <= n; i++) {
        for (let j = 1; j <= m; j++) {
            if (cleanRefWords[i - 1] === cleanHypWords[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1];
            } else {
                dp[i][j] = Math.min(
                    dp[i - 1][j] + 1,    // Deletion
                    dp[i][j - 1] + 1,    // Insertion
                    dp[i - 1][j - 1] + 1 // Substitution
                );
            }
        }
    }

    const edits = dp[n][m];
    const wer = edits / n;
    const accuracy = Math.max(0, 1 - wer) * 100.0;

    // Backtracking for detailed alignment
    let i = n, j = m;
    const alignment = [];

    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && cleanRefWords[i - 1] === cleanHypWords[j - 1]) {
            alignment.push({
                type: 'match',
                refIdx: i - 1,
                refWord: refWords[i - 1],
                hypIdx: j - 1,
                hypWord: hypWords[j - 1]
            });
            i--;
            j--;
        } else {
            let substCost = (i > 0 && j > 0) ? dp[i - 1][j - 1] : Infinity;
            let delCost = (i > 0) ? dp[i - 1][j] : Infinity;
            let insCost = (j > 0) ? dp[i][j - 1] : Infinity;

            let minCost = Math.min(substCost, delCost, insCost);

            if (minCost === substCost) {
                alignment.push({
                    type: 'substitution',
                    refIdx: i - 1,
                    refWord: refWords[i - 1],
                    hypIdx: j - 1,
                    hypWord: hypWords[j - 1]
                });
                i--;
                j--;
            } else if (minCost === delCost) {
                alignment.push({
                    type: 'deletion',
                    refIdx: i - 1,
                    refWord: refWords[i - 1],
                    hypIdx: null,
                    hypWord: null
                });
                i--;
            } else {
                alignment.push({
                    type: 'insertion',
                    refIdx: null,
                    refWord: null,
                    hypIdx: j - 1,
                    hypWord: hypWords[j - 1]
                });
                j--;
            }
        }
    }
    alignment.reverse();

    return {
        wer: wer,
        accuracy: accuracy,
        refLength: n,
        hypLength: m,
        alignment: alignment,
        refWords: refWords
    };
}

// Renders detailed side-by-side 3-way table
function renderASRScoringTable(mergedRows) {
    let html = `
    <table style="width: 100%; border-collapse: collapse; text-align: left; font-family: var(--font-sans); color: var(--color-text-primary);">
        <thead>
            <tr style="border-bottom: 1px solid var(--color-border); background: var(--color-surface); position: sticky; top: 0; z-index: 10;">
                <th style="padding: 12px; font-size: 0.8rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--color-text-muted); width: 45px;">#</th>
                <th style="padding: 12px; font-size: 0.8rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--color-text-muted); width: 180px;">Expected (Gettysburg)</th>
                <th style="padding: 12px; font-size: 0.8rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--color-accent);" id="table-header-engine-1">Engine 1</th>
                <th style="padding: 12px; font-size: 0.8rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: hsl(270, 100%, 75%);" id="table-header-engine-2">Engine 2</th>
            </tr>
        </thead>
        <tbody>
    `;
    
    let refWordCounter = 0;
    
    mergedRows.forEach((row, idx) => {
        const bg = idx % 2 === 0 ? 'rgba(255, 255, 255, 0.015)' : 'rgba(0, 0, 0, 0.15)';
        
        let numCol = "";
        let refCol = "";
        
        if (row.isInsertion) {
            numCol = '<span style="color: var(--color-text-muted); font-size: 0.75rem;">-</span>';
            refCol = '<span style="color: var(--color-text-muted); font-style: italic; opacity: 0.5;">[extra]</span>';
        } else {
            refWordCounter++;
            numCol = `<span style="color: var(--color-text-muted); font-family: var(--font-mono); font-size: 0.75rem;">${refWordCounter}</span>`;
            refCol = `<strong style="color: var(--color-text-primary); font-weight: 500;">${row.refWord}</strong>`;
        }
        
        const renderCell = (step, expectedWord) => {
            if (!step) {
                if (row.isInsertion) {
                    return '<span style="color: var(--color-text-muted); font-size: 0.75rem;">-</span>';
                }
                return '<span style="color: var(--color-text-muted); font-size: 0.75rem;">-</span>';
            }
            
            if (step.type === 'match') {
                return `<span style="color: var(--color-success); font-weight: 500; display: inline-flex; align-items: center; gap: 4px;">✓ ${step.hypWord}</span>`;
            } else if (step.type === 'substitution') {
                return `
                <div style="display: inline-flex; flex-direction: column; gap: 1px; vertical-align: middle;">
                    <span style="color: var(--color-danger); text-decoration: line-through; font-size: 0.7rem; opacity: 0.65; line-height: 1;">${expectedWord}</span>
                    <span style="color: hsl(38, 100%, 70%); font-weight: 600; font-size: 0.85rem; line-height: 1;">${step.hypWord}</span>
                </div>
                `;
            } else if (step.type === 'deletion') {
                return `<span style="color: var(--color-danger); text-decoration: line-through; font-size: 0.8rem; opacity: 0.65;">[omitted] (${expectedWord})</span>`;
            } else if (step.type === 'insertion') {
                return `
                <span style="background: rgba(147, 51, 234, 0.12); color: hsl(270, 95%, 80%); border: 1px solid rgba(147, 51, 234, 0.25); padding: 1px 6px; border-radius: 4px; font-weight: 500; font-size: 0.8rem; display: inline-block;">
                    ${step.hypWord}
                </span>
                <span style="opacity: 0.5; font-size: 0.65rem; color: var(--color-text-secondary); margin-left: 2px;">(extra)</span>
                `;
            }
            return "-";
        };
        
        const cell1 = renderCell(row.engine1, row.refWord);
        const cell2 = renderCell(row.engine2, row.refWord);
        
        html += `
            <tr style="background: ${bg}; border-bottom: 1px solid rgba(255, 255, 255, 0.03); transition: var(--transition-smooth);" onmouseover="this.style.background='rgba(255,255,255,0.04)'" onmouseout="this.style.background='${bg}'">
                <td style="padding: 8px 12px; vertical-align: middle; width: 45px;">${numCol}</td>
                <td style="padding: 8px 12px; vertical-align: middle; width: 180px;">${refCol}</td>
                <td style="padding: 8px 12px; vertical-align: middle;">${cell1}</td>
                <td style="padding: 8px 12px; vertical-align: middle;">${cell2}</td>
            </tr>
        `;
    });
    
    html += `
        </tbody>
    </table>
    `;
    return html;
}

// UI Event Listeners for Gettysburg Address Scoring Modal
const scoreModal = document.getElementById("score-modal");
const closeScoreModal = document.getElementById("close-score-modal");
const btnCloseScore = document.getElementById("btn-close-score");
const btnScoreGettysburg = document.getElementById("btn-score-gettysburg");

if (btnScoreGettysburg && scoreModal) {
    btnScoreGettysburg.addEventListener("click", () => {
        // Collect full hypothesis texts (Finalized + Interim)
        const hypText1 = ((currentFinalText1 || "") + " " + (currentInterimText1 || "")).trim();
        const hypText2 = ((currentFinalText2 || "") + " " + (currentInterimText2 || "")).trim();
        
        // Calculate WER metrics and alignment steps
        const res1 = calculateASRAccuracy(GETTYSBURG_REFERENCE, hypText1);
        const res2 = calculateASRAccuracy(GETTYSBURG_REFERENCE, hypText2);
        
        // Update Modal Labels
        const lbl1 = document.getElementById("score-engine-label-1");
        const lbl2 = document.getElementById("score-engine-label-2");
        const name1 = (selectEngine1 && modelMetadata[selectEngine1.value]?.label.split(" (")[0]) || "Engine 1";
        const name2 = (selectEngine2 && modelMetadata[selectEngine2.value]?.label.split(" (")[0]) || "Engine 2";
        
        if (lbl1) lbl1.textContent = name1;
        if (lbl2) lbl2.textContent = name2;
        
        // Update Table Headers dynamically with engine names
        const th1 = document.getElementById("table-header-engine-1");
        const th2 = document.getElementById("table-header-engine-2");
        if (th1) th1.textContent = name1;
        if (th2) th2.textContent = name2;
        
        // Render Accuracy Metrics
        document.getElementById("score-accuracy-1").textContent = `${res1.accuracy.toFixed(1)}%`;
        document.getElementById("score-wer-1").textContent = `Word Error Rate: ${(res1.wer * 100.0).toFixed(1)}%`;
        document.getElementById("score-stats-1").textContent = `Words matched: ${res1.hypLength} / ${res1.refLength}`;
        
        document.getElementById("score-accuracy-2").textContent = `${res2.accuracy.toFixed(1)}%`;
        document.getElementById("score-wer-2").textContent = `Word Error Rate: ${(res2.wer * 100.0).toFixed(1)}%`;
        document.getElementById("score-stats-2").textContent = `Words matched: ${res2.hypLength} / ${res2.refLength}`;
        
        document.getElementById("reference-word-count").textContent = `${res1.refLength} Words`;

        // Anchor-based alignment group helper
        const assignAnchors = (alignment, n) => {
            let currentAnchor = n;
            const stepsWithAnchor = [];
            for (let i = alignment.length - 1; i >= 0; i--) {
                const step = alignment[i];
                if (step.refIdx !== null) {
                    currentAnchor = step.refIdx;
                }
                stepsWithAnchor.push({ step, anchor: currentAnchor });
            }
            stepsWithAnchor.reverse();
            
            const byAnchor = Array.from({ length: n + 1 }, () => []);
            for (const item of stepsWithAnchor) {
                byAnchor[item.anchor].push(item.step);
            }
            return byAnchor;
        };

        const A1_by_anchor = assignAnchors(res1.alignment, res1.refLength);
        const A2_by_anchor = assignAnchors(res2.alignment, res2.refLength);
        
        const mergedRows = [];
        const n = res1.refLength;
        const refWords = res1.refWords;
        
        for (let a = 0; a <= n; a++) {
            const ins1 = A1_by_anchor[a].filter(step => step.type === 'insertion');
            const ins2 = A2_by_anchor[a].filter(step => step.type === 'insertion');
            
            const maxIns = Math.max(ins1.length, ins2.length);
            for (let idx = 0; idx < maxIns; idx++) {
                mergedRows.push({
                    isInsertion: true,
                    refWord: "-",
                    engine1: ins1[idx] || null,
                    engine2: ins2[idx] || null
                });
            }
            
            if (a < n) {
                const e1_step = A1_by_anchor[a].find(step => step.refIdx === a);
                const e2_step = A2_by_anchor[a].find(step => step.refIdx === a);
                
                mergedRows.push({
                    isInsertion: false,
                    refWord: refWords[a],
                    engine1: e1_step || null,
                    engine2: e2_step || null
                });
            }
        }
        
        // Dynamic Table Injection
        const tableContainer = document.getElementById("score-table-container");
        if (tableContainer) {
            tableContainer.innerHTML = renderASRScoringTable(mergedRows);
        }

        // Calculate and Render Delay Aggregations
        const getLatencyStats = (history) => {
            if (!history || history.length === 0) {
                return "Avg Delay: --";
            }
            const sum = history.reduce((a, b) => a + b, 0);
            const avg = Math.round(sum / history.length);
            const max = Math.round(Math.max(...history));
            return `Avg Delay: ${avg}ms (Max: ${max}ms, n=${history.length})`;
        };

        document.getElementById("score-delay-1").textContent = getLatencyStats(latencyHistory1);
        document.getElementById("score-delay-2").textContent = getLatencyStats(latencyHistory2);

        // Slide/Fade Modal in
        scoreModal.style.pointerEvents = "auto";
        scoreModal.style.opacity = "1";
        scoreModal.querySelector(".modal-content").style.transform = "scale(1)";
    });
}

function hideScoreModal() {
    if (scoreModal) {
        scoreModal.style.pointerEvents = "none";
        scoreModal.style.opacity = "0";
        scoreModal.querySelector(".modal-content").style.transform = "scale(0.9)";
    }
}

if (closeScoreModal) closeScoreModal.addEventListener("click", hideScoreModal);
if (btnCloseScore) btnCloseScore.addEventListener("click", hideScoreModal);

