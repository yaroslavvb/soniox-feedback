#!/usr/bin/env python3
import os
import sys
import argparse
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass
import asyncio
import json
import time
import base64
import websockets
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse
from soniox import AsyncSonioxClient
from soniox.types import RealtimeSTTConfig
from soniox.utils import render_tokens

app = FastAPI(title="Soniox Real-Time Live Transcriber")

# Cloud RTT dynamic measurement
latest_cloud_rtt = 50.0  # Fallback default RTT in milliseconds

async def measure_cloud_rtt():
    try:
        t0 = time.perf_counter()
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection("api.soniox.com", 443),
            timeout=2.0
        )
        writer.close()
        await writer.wait_closed()
        rtt = (time.perf_counter() - t0) * 1000.0
        return rtt
    except Exception as e:
        print(f"⚠️ Error measuring cloud RTT: {e}")
        return 0.0

async def cloud_rtt_loop():
    global latest_cloud_rtt
    while True:
        rtt = await measure_cloud_rtt()
        if rtt > 0:
            latest_cloud_rtt = rtt
        await asyncio.sleep(5.0)

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(cloud_rtt_loop())

# Parse command line arguments
def parse_arguments():
    parser = argparse.ArgumentParser(
        description="FastAPI server for real-time live microphone transcription with Soniox Speech AI."
    )
    parser.add_argument(
        "--api-key",
        type=str,
        default=os.environ.get("SONIOX_API_KEY"),
        help="Soniox API Key (defaults to SONIOX_API_KEY env var)"
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8000,
        help="Port to run the local server on (default: 8000)"
    )
    parser.add_argument(
        "--model",
        type=str,
        default="stt-rt-v4",
        help="Soniox real-time model to use (default: stt-rt-v4)"
    )
    return parser.parse_args()

args = parse_arguments()

# Store configured API key globally
CONFIG_API_KEY = args.api_key or os.environ.get("SONIOX_API_KEY")

@app.get("/")
async def get_index():
    """Serve the index.html page directly at the root URL."""
    return FileResponse("static/index.html")

@app.get("/style.css")
async def get_style():
    """Serve style.css explicitly to avoid root wildcard mounting issues."""
    return FileResponse("static/style.css")

@app.get("/app.js")
async def get_js():
    """Serve app.js explicitly to avoid root wildcard mounting issues."""
    return FileResponse("static/app.js")

@app.websocket("/ws/transcribe")
async def websocket_transcribe(websocket: WebSocket):
    """
    WebSocket endpoint that receives raw PCM audio bytes from the browser,
    proxies them either to Soniox Real-Time STT WebSocket or the local
    on-device speech-server (port 8090), and streams transcripts back.
    """
    await websocket.accept()
    
    # Check selected engine (default is soniox)
    query_params = websocket.query_params
    engine = query_params.get("engine", "soniox")
    
    print(f"🔌 Browser connected via WebSocket. Engine: {engine}")

    if engine.startswith("local"):
        # Connect to Soniqo local speech-server
        try:
            local_ws = await websockets.connect("ws://127.0.0.1:8090/v1/realtime")
            print("🚀 Connected to Soniqo Local speech-server.")
        except Exception as e:
            print(f"❌ Error connecting to local speech-server: {e}")
            await websocket.send_json({
                "final_text": "❌ Failed to connect to local speech-server on port 8090! Make sure it is running via 'speech-server --port 8090'.",
                "interim_text": ""
            })
            await websocket.close()
            return

        try:
            # Read and discard the initial session.created message
            init_msg = await local_ws.recv()
            print(f"Local ASR initialized: {init_msg}")

            # Send session.update to configure language and behavior
            try:
                if "parakeet" in engine:
                    # Enable Automatic Language Detection / Multilingual transcription for Parakeet
                    update_event = {
                        "type": "session.update",
                        "session": {
                            "modalities": ["audio", "text"],
                            "instructions": "Transcribe the audio in its native language. Automatically detect the spoken language and transcribe it accurately. Output native letters and punctuation. Ignore quiet background noises."
                        }
                    }
                    await local_ws.send(json.dumps(update_event))
                    update_resp = await local_ws.recv()
                    print(f"🚀 Configured Automatic Language Detection on local speech-server: {update_resp}")
                else:
                    # Enforce strict English-only decoding for other local models
                    update_event = {
                        "type": "session.update",
                        "session": {
                            "modalities": ["audio", "text"],
                            "language": "english",
                            "instructions": "Transcribe strictly in English. Only output English text. Do not output any Chinese, Russian, or other foreign characters. Ignore quiet background noises, hums, and throat-clearing fillers."
                        }
                    }
                    await local_ws.send(json.dumps(update_event))
                    update_resp = await local_ws.recv()
                    print(f"🚀 Configured English-only mode on local speech-server: {update_resp}")
            except Exception as e:
                print(f"⚠️ Failed to send session.update: {e}")

            # Keep track of active streaming status to auto-commit
            is_streaming_active = False
            last_commit_time = 0.0
            last_processing_time_ms = 80.0  # Neural net inference time tracking

            async def commit_ticker():
                """Task to send input_audio_buffer.commit periodically (every 500ms) to force fast real-time ASR."""
                nonlocal is_streaming_active, last_commit_time
                try:
                    while True:
                        await asyncio.sleep(0.5)
                        if is_streaming_active:
                            last_commit_time = time.time()
                            await local_ws.send(json.dumps({"type": "input_audio_buffer.commit"}))
                except asyncio.CancelledError:
                    pass
                except Exception as e:
                    print(f"⚠️ Error in local commit ticker: {e}")

            async def receive_from_browser():
                """Task to read PCM bytes from the browser and append to local server input audio buffer."""
                nonlocal is_streaming_active
                try:
                    while True:
                        message = await websocket.receive()
                        if message["type"] == "websocket.disconnect":
                            raise WebSocketDisconnect(message.get("code", 1000))
                        
                        if "bytes" in message:
                            data = message["bytes"]
                            if data:
                                is_streaming_active = True
                                # Encode to base64 and append to local server buffer
                                base64_audio = base64.b64encode(data).decode('utf-8')
                                append_event = {
                                    "type": "input_audio_buffer.append",
                                    "audio": base64_audio
                                }
                                await local_ws.send(json.dumps(append_event))
                        elif "text" in message:
                            text_data = message["text"]
                            try:
                                payload = json.loads(text_data)
                                if payload.get("type") == "ping":
                                    await websocket.send_json({
                                        "type": "pong",
                                        "client_time": payload.get("client_time"),
                                        "cloud_rtt": 0.1  # Zero cloud RTT for local running model
                                    })
                            except Exception as e:
                                print(f"⚠️ Error parsing client text message: {e}")
                except WebSocketDisconnect:
                    print("🔌 Browser disconnected.")
                    is_streaming_active = False
                except Exception as e:
                    print(f"⚠️ Error receiving from browser (local): {e}")

            # Define overlap deduplication logic at internal block level to keep modularity
            def clean_and_append_transcript(completed_list, new_text):
                new_text = new_text.strip()
                if not new_text:
                    return
                
                if "parakeet" in engine:
                    # Bypass the English-only character validator for multilingual ASR
                    new_words = new_text.split()
                else:
                    # Strict English-only filter to guarantee only English letters, digits, and punctuation
                    def is_english_word(word):
                        # Strip standard punctuation first to check the core word content
                        core = word.strip(".,?!;:-_\"'()[]{}«»“”‘’")
                        if not core:
                            return True  # It's pure punctuation
                        
                        for char in core:
                            val = ord(char)
                            if not (
                                (97 <= val <= 122) or  # a-z
                                (65 <= val <= 90) or   # A-Z
                                (48 <= val <= 57) or   # 0-9
                                val == 45 or           # - (hyphen)
                                val == 39 or           # ' (standard apostrophe)
                                val == 0x2019          # ’ (curly apostrophe)
                            ):
                                return False
                        return True
                    
                    new_words = [w for w in new_text.split() if is_english_word(w)]
                if not new_words:
                    return
                
                if not completed_list:
                    completed_list.extend(new_words)
                    return
                
                max_overlap = 0
                completed_len = len(completed_list)
                new_len = len(new_words)
                
                for size in range(1, min(completed_len, new_len, 10) + 1):
                    end_slice = completed_list[-size:]
                    start_slice = new_words[:size]
                    
                    end_words_clean = [w.lower().strip(".,?!;:-_\"'") for w in end_slice]
                    start_words_clean = [w.lower().strip(".,?!;:-_\"'") for w in start_slice]
                    
                    if end_words_clean == start_words_clean:
                        max_overlap = size
                        
                non_overlapping = new_words[max_overlap:]
                completed_list.extend(non_overlapping)

            async def send_to_browser():
                """Task to receive events from local speech-server and send transcription JSON back to browser."""
                completed_words = []
                start_time = time.time()
                nonlocal last_commit_time, last_processing_time_ms
                
                try:
                    async for msg in local_ws:
                        data = json.loads(msg)
                        event_type = data.get("type")
                        
                        if event_type == "conversation.item.input_audio_transcription.completed":
                            # Record true model processing speed
                            if last_commit_time > 0:
                                last_processing_time_ms = (time.time() - last_commit_time) * 1000.0
                            
                            transcript = data.get("transcript", "").strip()
                            if transcript:
                                clean_and_append_transcript(completed_words, transcript)
                            
                            final_text = " ".join(completed_words)
                            elapsed_ms = int((time.time() - start_time) * 1000)
                            
                            # Estimate latest_start_ms taking into account the measured processing latency
                            latest_start_ms = max(0, elapsed_ms - int(last_processing_time_ms) - 30)
                            
                            await websocket.send_json({
                                "final_text": final_text,
                                "interim_text": "",
                                "latest_start_ms": latest_start_ms,
                                "latest_end_ms": elapsed_ms
                            })
                except Exception as e:
                    print(f"⚠️ Error sending to browser (local): {e}")

            # Run all three tasks concurrently (500ms ticker, browser receive, ASR listener)
            browser_recv_task = asyncio.create_task(receive_from_browser())
            browser_send_task = asyncio.create_task(send_to_browser())
            ticker_task = asyncio.create_task(commit_ticker())

            # Wait until either task finishes or encounters disconnect/error
            done, pending = await asyncio.wait(
                [browser_recv_task, browser_send_task, ticker_task],
                return_when=asyncio.FIRST_COMPLETED
            )

            # Cancel remaining pending tasks
            for task in pending:
                task.cancel()

        except Exception as e:
            print(f"❌ Soniqo Local real-time session error: {e}")
        finally:
            try:
                await local_ws.close()
            except Exception:
                pass
            print("🔌 Soniqo Local client closed and connection cleaned up.")

    else:
        # Soniox Cloud pipeline
        api_key = CONFIG_API_KEY
        if not api_key:
            print("❌ Error: Soniox API Key is missing!")
            await websocket.send_json({"final_text": "❌ Error: Soniox API Key is missing on the server! Please configure it."})
            await websocket.close()
            return

        # Initialize Async Client
        client = AsyncSonioxClient(api_key=api_key)

        config = RealtimeSTTConfig(
            model=args.model,
            audio_format="pcm_s16le",
            sample_rate=16000,
            num_channels=1
        )

        try:
            # Establish WebSocket connection to Soniox
            async with client.realtime.stt.connect(config=config) as session:
                print("🚀 Connected to Soniox Real-Time API.")

                async def receive_from_browser():
                    """Task to read data from the browser and send them to Soniox, or handle ping-pong."""
                    try:
                        while True:
                            message = await websocket.receive()
                            if message["type"] == "websocket.disconnect":
                                raise WebSocketDisconnect(message.get("code", 1000))
                            
                            if "bytes" in message:
                                data = message["bytes"]
                                if data:
                                    # Safely handle both sync and async send_byte_chunk
                                    res = session.send_byte_chunk(data)
                                    if asyncio.iscoroutine(res):
                                        await res
                            elif "text" in message:
                                text_data = message["text"]
                                try:
                                    payload = json.loads(text_data)
                                    if payload.get("type") == "ping":
                                        await websocket.send_json({
                                            "type": "pong",
                                            "client_time": payload.get("client_time"),
                                            "cloud_rtt": latest_cloud_rtt
                                        })
                                except Exception as e:
                                    print(f"⚠️ Error parsing client text message: {e}")
                    except WebSocketDisconnect:
                        print("🔌 Browser disconnected.")
                    except Exception as e:
                        print(f"⚠️ Error receiving from browser: {e}")

                async def send_to_browser():
                    """Task to receive events from Soniox and send transcription JSON back to browser."""
                    final_tokens = []
                    non_final_tokens = []
                    try:
                        async for event in session.receive_events():
                            non_final_tokens.clear()
                            latest_start_ms = 0
                            latest_end_ms = 0
                            for token in event.tokens:
                                if token.is_final:
                                    final_tokens.append(token)
                                else:
                                    non_final_tokens.append(token)
                                
                                # Track timing of the latest word
                                if token.start_ms > latest_start_ms:
                                    latest_start_ms = token.start_ms
                                    latest_end_ms = token.end_ms

                            # Render confirmed and provisional text
                            final_text = render_tokens(final_tokens, [])
                            interim_text = render_tokens([], non_final_tokens)

                            # Send to browser
                            await websocket.send_json({
                                "final_text": final_text,
                                "interim_text": interim_text,
                                "latest_start_ms": latest_start_ms,
                                "latest_end_ms": latest_end_ms
                            })
                    except Exception as e:
                        print(f"⚠️ Error sending to browser: {e}")

                # Run both proxy tasks concurrently
                browser_recv_task = asyncio.create_task(receive_from_browser())
                browser_send_task = asyncio.create_task(send_to_browser())

                # Wait until either task finishes or encounters disconnect/error
                done, pending = await asyncio.wait(
                    [browser_recv_task, browser_send_task],
                    return_when=asyncio.FIRST_COMPLETED
                )

                # Cancel remaining pending tasks
                for task in pending:
                    task.cancel()

        except Exception as e:
            print(f"❌ Soniox real-time session error: {e}")
            try:
                await websocket.send_json({"final_text": f"❌ Connection Error: {e}"})
            except Exception:
                pass
        finally:
            # Clean up async client
            await client.aclose()
            print("🔌 Soniox client closed and connection cleaned up.")

def run_server():
    import uvicorn
    print(f"🌐 Starting local server at http://127.0.0.1:{args.port}")
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="info")

if __name__ == "__main__":
    run_server()
